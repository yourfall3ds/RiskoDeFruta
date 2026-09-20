/**
 * O MULTIJOGADOR COMO PRODUTO.
 *
 * Este é o contrato entre o MENU e a rede. O menu (`MenuShell`) não sabe o que é Colyseus, seed,
 * porta ou `?online=1` — ele pede "criar sala", "entrar nesta sala", "guarde meu nome", e é aqui
 * que isso vira endereço, semente e recarga. A separação não é estética: `MenuShell` roda em
 * testes de DOM sem servidor, e importar o SDK lá dentro obrigaria a suíte de interface a subir
 * uma sala (o mesmo motivo que já existe em `LobbyLink`).
 *
 * O caminho de URL (`?online=1&seed=…`) continua intacto ao lado deste: ver `OnlineIntent`.
 */

import type { RoomBrowserLink, RoomRow } from './RoomBrowser';
import { DEFAULT_COOP_PORT, decodeRoomCode, generateRoomPart, roomPart, seedForCode } from './RoomCode';
import { loadPlayerName, savePlayerName } from './PlayerName';
import { clearOnlineIntent, readCoopNotice, readOnlineIntent, writeCoopNotice, writeOnlineIntent, type OnlineIntent } from './OnlineIntent';

export interface MultiplayerPort {
  /** O nome salvo, ou `''` na primeira vez — é isso que decide se a pergunta aparece. */
  savedName(): string;
  saveName(name: string): string;
  /** Abre a listagem ao vivo. Quem abre é quem descarta. */
  browse(): RoomBrowserLink;
  /** Cria a sala e entra nela. `roomName` vazio deixa o servidor batizar pelo anfitrião. */
  create(name: string, roomName: string): void;
  /** Entra numa sala listada. Devolve o motivo da recusa, ou `''` se foi. */
  joinRow(row: RoomRow, name: string): string;
  /** Entra por código digitado. Devolve o motivo da recusa, ou `''` se foi. */
  joinCode(code: string, name: string): string;
  /** Volta ao menu (saiu, foi expulso, a sala encerrou), com o motivo para mostrar na lista. */
  backToMenu(notice: string): void;
  /** O recado que sobreviveu à recarga. Lido uma vez. */
  notice(): string;
  /** A sala em que esta aba está, se está em alguma. */
  currentRoom(): string;
}

export { DEFAULT_COOP_PORT };

/**
 * O endereço do servidor de salas, deduzido de onde a página veio.
 *
 * Quem hospeda abre `localhost`, quem entra abre o IP da LAN do anfitrião — nos dois casos o
 * servidor Colyseus está na MESMA máquina que serviu a página. Deduzir em vez de perguntar é o que
 * permite a promessa da tela: o jogador nunca digita nem lê endereço nenhum.
 */
export function coopServerUrl(href: string, port = DEFAULT_COOP_PORT): string {
  try {
    const url = new URL(href);
    const explicit = url.searchParams.get('server');
    if (explicit) return explicit;
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.hostname || '127.0.0.1'}:${port}`;
  } catch { return `ws://127.0.0.1:${port}`; }
}

/** Uma sala que ainda não está em uso entre as visíveis. */
export function pickRoomPart(taken: readonly string[] = [], random: () => number = Math.random): string {
  const used = new Set(taken.map(code => roomPart(code)).filter(Boolean));
  for (let attempt = 0; attempt < 64; attempt++) {
    const room = generateRoomPart(random);
    if (!used.has(room)) return room;
  }
  return generateRoomPart(random);
}

/**
 * A entrada de fato: grava a intenção e recarrega numa URL LIMPA.
 *
 * Recarregar é deliberado. A sessão de rede é montada no construtor da cena (`PlayerScene`), junto
 * com o mundo, a colisão e a horda — abrir uma sala com a cena já de pé significaria reconstruir
 * tudo isso vivo, que é justamente a cirurgia de gameplay que este trabalho não pode fazer. O
 * jogador vê a tela de carregamento do jogo, que ele já conhece, e não uma URL.
 */
export function startOnline(intent: OnlineIntent, target: { assign(url: string): void; pathname: string } = location): void {
  writeOnlineIntent(intent);
  target.assign(target.pathname);
}

export function browserMultiplayer(): MultiplayerPort {
  return {
    savedName: () => loadPlayerName(),
    saveName: (name: string) => savePlayerName(name),
    browse(): RoomBrowserLink {
      /**
       * O SDK entra por `import()` e não no topo do arquivo: quem abre o jogo no single-player —
       * a esmagadora maioria — não deve baixar nem avaliar o cliente de rede para ver o menu.
       */
      let live: RoomBrowserLink | undefined;
      let disposed = false;
      const listeners = new Set<() => void>();
      let failure = '';
      const link: RoomBrowserLink = {
        get rooms() { return live?.rooms ?? []; },
        get error() { return failure; },
        onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        dispose() { disposed = true; listeners.clear(); live?.dispose(); live = undefined; },
      };
      void (async () => {
        const { ColyseusRoomBrowser } = await import('./RoomBrowser');
        if (disposed) return;
        const browser = new ColyseusRoomBrowser(coopServerUrl(location.href));
        live = browser;
        browser.onChange(() => { failure = browser.error ? 'NÃO CONSEGUI FALAR COM O SERVIDOR DE SALAS' : ''; for (const listener of listeners) listener(); });
        await browser.connect();
        failure = browser.error ? 'NÃO CONSEGUI FALAR COM O SERVIDOR DE SALAS' : '';
        for (const listener of listeners) listener();
      })();
      return link;
    },
    create(name: string, roomName: string): void {
      const room = pickRoomPart();
      // Quem cria fala com o servidor da PRÓPRIA máquina; o endereço que o amigo precisa é outro, e
      // quem o diz é o servidor, na boas-vindas (`LobbyLink.address`). Só depois disso o código
      // completo existe — e é por isso que a tela da sala o mostra quando ele chega, não antes.
      startOnline({ code: room, seed: seedForCode(room), name, server: coopServerUrl(location.href), roomName });
    },
    joinRow(row: RoomRow, name: string): string {
      if (row.full) return 'ESSA SALA ESTÁ CHEIA';
      if (!row.seed) return 'NÃO CONSEGUI FALAR COM A SALA';
      // A sala listada é desta rede, então o servidor é o mesmo da listagem.
      startOnline({ code: row.code, seed: row.seed, name, server: coopServerUrl(location.href), roomName: row.roomName });
      return '';
    },
    joinCode(code: string, name: string): string {
      const decoded = decodeRoomCode(code);
      if (!decoded) return 'CÓDIGO INVÁLIDO';
      // O endereço sai do CÓDIGO: é o que faz o convidado falar com a máquina do anfitrião em vez
      // de com a dele mesma. Código de mesma origem (`S`) cai no servidor de onde a página veio.
      startOnline({ code: decoded.room, seed: decoded.seed, name, server: decoded.server || coopServerUrl(location.href), roomName: '' });
      return '';
    },
    backToMenu(notice: string): void {
      clearOnlineIntent();
      if (notice) writeCoopNotice(notice);
      location.assign(location.pathname);
    },
    notice: () => readCoopNotice(),
    currentRoom: () => readOnlineIntent()?.code ?? '',
  };
}

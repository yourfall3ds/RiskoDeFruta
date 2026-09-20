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
import { configuredServerUrl, hasSharedServer, serverUrlFor } from './ServerAddress';
import { relaunch } from './Relaunch';
import { logger } from '../core/Log';

const log = logger('menu');

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
 * O endereço do servidor de salas, em três camadas: `?server=`, `VITE_SERVER` e o host da página.
 *
 * A resolução mora em `ServerAddress` — aqui ficou só o nome pelo qual o menu já a conhecia. A
 * camada do meio é a que faz a LISTA valer alguma coisa: sem um servidor comum, cada jogador só
 * enxerga as salas da própria máquina. Ver `.env.example`.
 */
export function coopServerUrl(href: string, port = DEFAULT_COOP_PORT): string {
  return serverUrlFor(href, configuredServerUrl(), port);
}

/** `true` quando este build aponta para um servidor compartilhado. A tela diz isso ao jogador. */
export function sharedServerConfigured(): boolean { return hasSharedServer(); }

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
 * A entrada de fato: grava a intenção e relança o jogo.
 *
 * "Relançar" era, até aqui, `location.assign()` — uma recarga de página inteira, e a maior parte
 * dos ~40 s que o jogador esperava para entrar numa sala. A cena PRECISA ser reconstruída (o mapa
 * fora do co-op é o planeta e dentro é a fazenda; ver `Relaunch`), mas a página não: o motor, os
 * shaders e os módulos já avaliados podem ficar de pé.
 *
 * Por isso a ordem: primeiro pergunta se alguém sabe relançar em processo (`Application` sabe) e,
 * só se não houver ninguém, recarrega como sempre. A queda importa — é ela que mantém o caminho de
 * URL (`?online=1&seed=`) e os testes funcionando sem nada registrado.
 */
export function startOnline(intent: OnlineIntent, target: { assign(url: string): void; pathname: string } = location): void {
  writeOnlineIntent(intent);
  log.info('entrando na sala', { codigo: intent.code, servidor: intent.server, sala: intent.roomName });
  if (relaunch('entrar')) return;
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
        browser.onChange(() => { failure = browser.error ? 'NÃO CONSEGUI FALAR COM O SERVIDOR' : ''; for (const listener of listeners) listener(); });
        await browser.connect();
        failure = browser.error ? 'NÃO CONSEGUI FALAR COM O SERVIDOR' : '';
        if (failure) log.aviso('servidor de salas fora do ar', { servidor: browser.url, motivo: browser.error });
        else log.info('listagem de salas aberta', { servidor: browser.url, salas: browser.rooms.length });
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
      log.info('voltando ao menu', { motivo: notice || 'sem motivo' });
      // Mesma economia da entrada: a cena volta a ser a do menu sem a página inteira recarregar.
      if (relaunch('sair')) return;
      location.assign(location.pathname);
    },
    notice: () => readCoopNotice(),
    currentRoom: () => readOnlineIntent()?.code ?? '',
  };
}

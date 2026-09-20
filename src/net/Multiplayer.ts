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
import { closeRoom, openRoom } from './RoomSession';
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
  /**
   * Volta ao menu VINDO DA PARTIDA (saiu, foi expulso, a sala encerrou). A cena é do mundo da
   * fazenda, então ela precisa mesmo ser refeita no mundo de fora — é a única saída que ainda
   * atravessa uma tela de carregamento, e é legítima.
   */
  backToMenu(notice: string): void;
  /**
   * Sai da sala AINDA NO MENU. Nada é reconstruído: o lobby é menu, e a cena que está de pé
   * continua de pé. É o caminho de quem criou uma sala, olhou e desistiu.
   */
  exitRoom(notice: string): void;
  /**
   * A PARTIDA COMEÇOU. Aqui, e só aqui, a cena é refeita no mundo da fazenda — a sala já está
   * aberta e será adotada pela cena nova, então o jogador não volta para o fim da fila.
   */
  enterMatch(): void;
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
 * A ENTRADA NA SALA, que deixou de ser uma entrada na PARTIDA.
 *
 * Este era o ponto mais caro do jogo. `startOnline` gravava a intenção e mandava relançar: a cena
 * inteira ia abaixo e voltava no outro mundo, e o jogador esperava trinta e poucos segundos de
 * `[planeta] mapa … 35783 ms` para chegar a uma tela de LOBBY — onde ainda ia escolher personagem,
 * esperar os amigos e talvez desistir. Montava-se um mapa para ninguém pisar nele.
 *
 * Agora a sala abre onde o jogador está: `openRoom` conecta por fora da cena e o menu passa a
 * mostrar o roster sobre a cena que já estava de pé. Nenhum mundo é construído aqui. Quem constrói
 * é `enterMatch`, quando a sala de fato largar.
 *
 * A ordem de queda continua a mesma e pelo mesmo motivo: sem quem conecte fora da cena, relança a
 * cena; sem quem relance, recarrega a página. É a queda que mantém `?online=1&seed=` e
 * `jogar-coop.ps1` valendo palavra por palavra.
 */
export function startOnline(intent: OnlineIntent, target: { assign(url: string): void; pathname: string } = location): void {
  writeOnlineIntent(intent);
  log.info('entrando na sala', { codigo: intent.code, servidor: intent.server, sala: intent.roomName });
  if (openRoom(intent)) return;
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
        /**
         * No aplicativo instalado a lista é a SOMA dos anfitriões da rede local; no navegador é o
         * servidor único de sempre. Quem decide é a existência da ponte do Electron, e as duas
         * pontas são o mesmo `RoomBrowserLink` — por isso nada abaixo daqui muda.
         */
        const { NavegadorDaLan, ponteLan } = await import('./LanBrowser');
        if (disposed) return;
        const local = coopServerUrl(location.href);
        const browser = ponteLan()
          ? new NavegadorDaLan(local, url => new ColyseusRoomBrowser(url))
          : new ColyseusRoomBrowser(local);
        live = browser;
        browser.onChange(() => { failure = browser.error ? 'NÃO CONSEGUI FALAR COM O SERVIDOR' : ''; for (const listener of listeners) listener(); });
        await browser.connect();
        failure = browser.error ? 'NÃO CONSEGUI FALAR COM O SERVIDOR' : '';
        if (failure) log.aviso('servidor de salas fora do ar', { servidor: local, motivo: browser.error });
        else log.info('listagem de salas aberta', { servidor: local, salas: browser.rooms.length });
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
      // O servidor sai da LINHA, não do endereço desta página: com a descoberta na LAN a lista
      // mistura salas de máquinas diferentes, e usar `coopServerUrl` aqui mandaria o convidado ao
      // servidor dele mesmo. `server` vazio continua significando "o servidor desta página", que é
      // o caminho de navegador de sempre.
      startOnline({ code: row.code, seed: row.seed, name, server: row.server || coopServerUrl(location.href), roomName: row.roomName });
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
      // A sala morre ANTES de a cena ser refeita: a cena nova nasce no mundo de fora e não pode
      // adotar uma sala que o jogador acabou de abandonar.
      closeRoom();
      if (notice) writeCoopNotice(notice);
      log.info('voltando ao menu vindo da partida', { motivo: notice || 'sem motivo' });
      // Mesma economia da entrada: a cena volta a ser a do menu sem a página inteira recarregar.
      if (relaunch('sair')) return;
      location.assign(location.pathname);
    },
    exitRoom(notice: string): void {
      clearOnlineIntent();
      log.info('saindo da sala ainda no menu', { motivo: notice || 'sem motivo' });
      // Nada de `relaunch`, nada de `writeCoopNotice`: não há recarga nenhuma para o recado
      // atravessar, e a cena de fora é justamente a que continua de pé. O motivo viaja com o
      // fechamento e chega ao menu pelo mesmo turno.
      closeRoom(notice);
    },
    enterMatch(): void {
      log.info('a partida começou: construindo o mundo da fazenda');
      // A ÚNICA tela de carregamento que sobrou no caminho do co-op — e a única que o jogador pediu.
      if (relaunch('entrar')) return;
      location.assign(location.pathname);
    },
    notice: () => readCoopNotice(),
    currentRoom: () => readOnlineIntent()?.code ?? '',
  };
}

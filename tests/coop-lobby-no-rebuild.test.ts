import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { browserMultiplayer, startOnline } from '../src/net/Multiplayer';
import { setRelaunchHandler, type RelaunchReason } from '../src/net/Relaunch';
import { closeRoom, currentRoom, onRoomChange, openRoom, setRoomConnector, type RoomConnection } from '../src/net/RoomSession';
import type { OnlineIntent } from '../src/net/OnlineIntent';
import type { LobbyPhase, LobbyPlayer } from '../src/net/LobbyLink';

/**
 * O LOBBY É MENU, E MENU NÃO CONSTRÓI MAPA.
 *
 * ## O que estava medido
 *
 * Abrir MULTIPLAYER, criar sala e sair da sala reconstruíam a cena inteira, uma vez cada:
 * `[planeta] mapa (manifesto + casca + colisão + destrutíveis): 35783 ms` no console do jogo, e
 * outros `30881 ms` ao entrar. O jogador atravessava duas telas de carregamento para montar um
 * mundo em que não ia pisar — e só depois chegava ao lobby, onde ainda podia desistir.
 *
 * ## O que este arquivo prova
 *
 * A reconstrução da cena tem UM ponto de entrada (`Relaunch`), e ele é observável. Então a
 * promessa vira contagem: criar sala, ver o roster, escolher personagem, dar PRONTO e SAIR somam
 * ZERO relançamentos. O contador só sai do zero quando a PARTIDA começa — uma vez, que é a única
 * tela de carregamento que o caminho do co-op ainda tem, e a única que o jogador pediu.
 *
 * Tudo isto roda sem servidor e sem browser: `setRoomConnector` troca quem abre a sala por uma
 * sala de mentira com a mesma superfície, e `setRelaunchHandler` põe o contador no lugar onde
 * `Application` normalmente refaz a cena.
 */

/** A sala de mentira, com a superfície de `RoomConnection` mais os contadores que o teste afirma. */
type FakeRoom = RoomConnection & {
  connects: number; disposes: number; phase: LobbyPhase; players: LobbyPlayer[];
  chosen: string[]; readies: boolean[]; left: number; emit(): void; close(reason: string): void;
};

/**
 * Uma sala de mentira com a superfície de `RoomConnection`, e nada por baixo.
 *
 * Os métodos falam por `sala.` e não por `this.`: a versão anterior fechava o objeto com
 * `as never`, e isso tipava o `this` de dentro de cada método como `never` — `this.connects++`
 * virava erro de compilação num arquivo que, no vitest, passava. Nomear a variável elimina o `this`
 * do problema e dispensa a asserção.
 */
function fakeRoom(url = 'ws://127.0.0.1:2567'): FakeRoom {
  const changed = new Set<() => void>();
  const closed = new Set<(reason: string) => void>();
  const sala: FakeRoom = {
    url, connects: 0, disposes: 0, phase: 'lobby' as LobbyPhase, players: [] as LobbyPlayer[],
    chosen: [] as string[], readies: [] as boolean[], left: 0,
    isHost: true, address: '192.168.15.42:2567', roomName: 'SALA DE LUCAS', failure: '', mapId: '',
    async connect() { sala.connects++; },
    dispose() { sala.disposes++; changed.clear(); closed.clear(); },
    onChange(listener: () => void) { changed.add(listener); return () => changed.delete(listener); },
    onClosed(listener: (reason: string) => void) { closed.add(listener); return () => closed.delete(listener); },
    chooseClass(id: string) { sala.chosen.push(id); },
    setReady(ready: boolean) { sala.readies.push(ready); },
    setSetting() { /* sem servidor não há ajuste para guardar */ },
    rename() { /* idem */ },
    selectMap() { /* idem: quem troca mapa é a sala, e aqui não há sala */ },
    kick() { /* idem */ },
    closeRoom() { /* idem */ },
    leaveRoom() { sala.left++; },
    emit() { for (const listener of [...changed]) listener(); },
    close(reason: string) { for (const listener of [...closed]) listener(reason); },
  };
  return sala;
}

const INTENT: OnlineIntent = { code: 'X7K2', seed: 'sala-x7k2', name: 'Lucas', server: 'ws://192.168.15.42:2567', roomName: 'SALA DE LUCAS' };

/** Onde a cena seria reconstruída. Cada entrada aqui é uma tela de carregamento para o jogador. */
let rebuilds: RelaunchReason[] = [];
/** Onde a PÁGINA seria recarregada — a queda de último recurso, pior ainda que a anterior. */
let navigations: string[] = [];
const target = { pathname: '/', assign(url: string) { navigations.push(url); } };

beforeEach(() => {
  rebuilds = []; navigations = [];
  setRelaunchHandler(reason => { rebuilds.push(reason); });
});

afterEach(() => {
  setRelaunchHandler(undefined);
  setRoomConnector(undefined);
  closeRoom();
});

describe('entrar numa sala não reconstrói a cena', () => {
  it('criar sala, escolher personagem e dar PRONTO acontecem sobre a cena que já estava de pé', async () => {
    const sala = fakeRoom();
    setRoomConnector(() => sala);

    startOnline(INTENT, target);
    // O `openRoom` conecta fora da cena, num turno seguinte; nada disso passa por `Relaunch`.
    await Promise.resolve(); await Promise.resolve();

    expect(currentRoom()).toBe(sala);
    expect(sala.connects).toBe(1);
    // O ponto do trabalho inteiro, numa linha.
    expect(rebuilds).toEqual([]);
    expect(navigations).toEqual([]);

    // O lobby inteiro é menu: personagem, prontidão e o roster mudando por baixo.
    sala.chooseClass('gunslinger');
    sala.setReady(true);
    sala.players = [{ id: 's1', entityId: 1, name: 'LUCAS', classId: 'gunslinger', connected: true, ready: true, host: true, self: true }];
    sala.emit();
    expect(rebuilds).toEqual([]);
  });

  it('a mesma aba não abre duas conexões, e a segunda sala fecha a primeira', async () => {
    const primeira = fakeRoom(), segunda = fakeRoom();
    const salas = [primeira, segunda];
    let i = 0;
    setRoomConnector(() => salas[i++]!);

    startOnline(INTENT, target);
    await Promise.resolve(); await Promise.resolve();
    startOnline({ ...INTENT, code: 'AB34', seed: 'sala-ab34' }, target);
    await Promise.resolve(); await Promise.resolve();

    expect(primeira.disposes).toBe(1);
    expect(currentRoom()).toBe(segunda);
    expect(segunda.disposes).toBe(0);
    expect(rebuilds).toEqual([]);
  });

  it('a cena da partida ADOTA a sala aberta em vez de conectar de novo', async () => {
    const sala = fakeRoom();
    setRoomConnector(() => sala);
    startOnline(INTENT, target);
    await Promise.resolve(); await Promise.resolve();

    // É exatamente isto que `NetworkSession.fromLocation` lê ao nascer no mundo da fazenda: a
    // MESMA conexão, com a vaga que o jogador já garantiu. Conectar outra vez o mandaria para o
    // fim da fila de uma sala em que ele já está dentro.
    expect(currentRoom()).toBe(sala);
    expect(sala.connects).toBe(1);
  });
});

describe('sair da sala não reconstrói a cena', () => {
  it('quem sai AINDA NO MENU volta para a lista no mesmo quadro', async () => {
    const sala = fakeRoom();
    setRoomConnector(() => sala);
    const avisos: (string | undefined)[] = [];
    const off = onRoomChange((room, notice) => { if (!room) avisos.push(notice); });

    startOnline(INTENT, target);
    await Promise.resolve(); await Promise.resolve();

    browserMultiplayer().exitRoom('VOCÊ SAIU DA SALA');
    off();

    expect(currentRoom()).toBeUndefined();
    expect(sala.disposes).toBe(1);
    // O motivo chega ao menu pelo próprio fechamento: não há recarga nenhuma para ele atravessar.
    expect(avisos).toEqual(['VOCÊ SAIU DA SALA']);
    expect(rebuilds).toEqual([]);
    expect(navigations).toEqual([]);
  });

  it('a sala que cai (expulso, anfitrião encerrou) também não custa um mapa', async () => {
    const sala = fakeRoom();
    setRoomConnector(() => sala);
    startOnline(INTENT, target);
    await Promise.resolve(); await Promise.resolve();

    let motivo = '';
    sala.onClosed(reason => { motivo = reason; });
    sala.close('O ANFITRIÃO ENCERROU A SALA');
    browserMultiplayer().exitRoom(motivo);

    expect(motivo).toBe('O ANFITRIÃO ENCERROU A SALA');
    expect(rebuilds).toEqual([]);
  });
});

describe('a única tela de carregamento que sobrou é a da partida', () => {
  it('começar a partida refaz a cena UMA vez, e com a sala ainda de pé', async () => {
    const sala = fakeRoom();
    setRoomConnector(() => sala);
    startOnline(INTENT, target);
    await Promise.resolve(); await Promise.resolve();
    expect(rebuilds).toEqual([]);

    sala.phase = 'playing';
    browserMultiplayer().enterMatch();

    expect(rebuilds).toEqual(['entrar']);
    // A sala NÃO cai com a cena velha: é ela que a cena nova vai adotar.
    expect(currentRoom()).toBe(sala);
    expect(sala.disposes).toBe(0);
  });

  it('voltar ao menu VINDO DA PARTIDA refaz a cena e fecha a sala — é a saída legítima', async () => {
    const sala = fakeRoom();
    setRoomConnector(() => sala);
    startOnline(INTENT, target);
    await Promise.resolve(); await Promise.resolve();

    browserMultiplayer().backToMenu('VOCÊ SAIU DA SALA');

    expect(rebuilds).toEqual(['sair']);
    expect(currentRoom()).toBeUndefined();
    expect(sala.disposes).toBe(1);
  });
});

describe('as quedas que mantêm `?online=1&seed=` e o `jogar-coop.ps1`', () => {
  it('conector que explode fecha a sala em silêncio, sem arrastar a cena junto', () => {
    setRoomConnector(() => { throw new Error('sem conector'); });
    // `openRoom` aceita o pedido e só falha ao CONSTRUIR a sala, então a queda acontece já dentro
    // da abertura: a sala fecha sozinha e o menu diz o motivo, sem inventar uma cena nova.
    startOnline(INTENT, target);
    expect(navigations).toEqual([]);
    expect(rebuilds).toEqual([]);
  });

  it('sem conector NENHUM e sem `window`, recarrega a página — o caminho antigo, intacto', () => {
    // `lazyConnector` devolve `undefined` fora do browser, e a suíte roda em Node puro.
    setRelaunchHandler(undefined);
    startOnline(INTENT, target);
    expect(navigations).toEqual(['/']);
    expect(rebuilds).toEqual([]);
  });

  it('sem conector e COM quem relance, a cena é refeita em vez de a página recarregar', () => {
    startOnline(INTENT, target);
    expect(rebuilds).toEqual(['entrar']);
    expect(navigations).toEqual([]);
  });
});

describe('a sala que não sobe não deixa o jogador numa tela morta', () => {
  it('falha de conexão fecha a sala e escreve o motivo na lista', async () => {
    const sala = fakeRoom();
    sala.connect = async () => { throw new Error('servidor fora do ar'); };
    setRoomConnector(() => sala);
    const avisos: string[] = [];
    const off = onRoomChange((room, notice) => { if (!room && notice) avisos.push(notice); });

    expect(openRoom(INTENT)).toBe(true);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    off();

    expect(currentRoom()).toBeUndefined();
    expect(avisos).toEqual(['NÃO CONSEGUI ENTRAR NA SALA']);
    expect(rebuilds).toEqual([]);
  });
});

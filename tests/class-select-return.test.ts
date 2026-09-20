import { describe, it, expect, afterEach } from 'vitest';
import { classScreenReturn } from '../src/ui/MenuShell';
import { closeRoom, currentRoom, openRoom, setRoomConnector, type RoomConnection } from '../src/net/RoomSession';
import type { OnlineIntent } from '../src/net/OnlineIntent';
import type { LobbyPhase, LobbyPlayer } from '../src/net/LobbyLink';
import type { PlayerClassId } from '../src/run/PlayerClass';

/**
 * ESCOLHER PERSONAGEM NÃO PODE TIRAR O JOGADOR DA SALA.
 *
 * ## O que estava errado
 *
 * O `◂ VOLTAR` era um botão só, criado por uma função só, e mandava sempre para a raiz do menu.
 * Serve para OPÇÕES e para ABANDONAR, onde a raiz é mesmo o lugar de onde se veio. Não serve para
 * a tela de personagem quando há sala aberta: o jogador chegou nela VINDO DO LOBBY, e voltar para o
 * menu principal o despeja fora da tela da sala sem fechar sala nenhuma — a conexão segue viva, ele
 * continua ocupando a vaga, e a tela deixa de mostrar isso.
 *
 * Duas responsabilidades tinham ido parar na mesma função: "fechar esta tela" e "ir para o menu
 * principal". São a mesma coisa em quase toda tela, e é por isso que passou despercebido.
 *
 * ## O que este arquivo afirma
 *
 * Primeiro a REGRA, que é onde mora o defeito. Depois a INVARIANTE que a regra existe para
 * proteger: escolher personagem é uma alteração do estado daquele jogador DENTRO da sala que já
 * existe — não fecha conexão, não recria sala, não troca o `roomId` nem a identidade de quem
 * escolheu. Isso se afirma sem DOM e sem servidor, com a mesma sala de mentira dos outros testes de
 * sala.
 */

describe('o retorno da tela de personagem', () => {
  it('com sala aberta volta para A SALA, não para a raiz', () => {
    expect(classScreenReturn(true, true)).toBe('sala');
  });

  it('sem sala volta para a raiz, que é o caminho do single-player', () => {
    expect(classScreenReturn(false, true)).toBe('raiz');
  });

  /**
   * O campo de testes monta o menu sem tela de sala. Mandar para uma tela que não existe deixaria o
   * jogador numa tela em branco — um destino errado trocado por um pior.
   */
  it('sem tela de sala montada volta para a raiz mesmo com sala aberta', () => {
    expect(classScreenReturn(true, false)).toBe('raiz');
  });
});

/** A sala de mentira: a superfície de `RoomConnection` e contadores para o que o teste afirma. */
type FakeRoom = RoomConnection & {
  connects: number; disposes: number; chosen: PlayerClassId[]; players: LobbyPlayer[]; roomId: string;
};

function fakeRoom(roomId: string, players: LobbyPlayer[]): FakeRoom {
  const changed = new Set<() => void>();
  const sala: FakeRoom = {
    url: 'ws://127.0.0.1:2567', roomId, connects: 0, disposes: 0, chosen: [], players,
    isHost: false, address: '127.0.0.1:2567', roomName: 'SALA DE LUCAS', failure: '',
    phase: 'lobby' as LobbyPhase,
    async connect() { sala.connects++; },
    dispose() { sala.disposes++; },
    onChange(listener: () => void) { changed.add(listener); return () => changed.delete(listener); },
    onClosed() { return () => {}; },
    chooseClass(id: PlayerClassId) {
      sala.chosen.push(id);
      // O servidor devolve a escolha no roster; a sala é a MESMA, só o jogador mudou.
      const i = sala.players.findIndex(p => p.self);
      const eu = sala.players[i];
      if (eu) sala.players[i] = {...eu, classId: id};
      for (const listener of changed) listener();
    },
    setReady() {}, setSetting() {}, rename() {}, kick() {}, leave() {}, start() {},
  } as unknown as FakeRoom;
  return sala;
}

describe('escolher personagem dentro da sala', () => {
  afterEach(() => { closeRoom(); setRoomConnector(undefined); });

  it('não fecha a conexão, não recria a sala e preserva roomId e identidade', async () => {
    // `classId: undefined` é o estado real de quem ainda não escolheu — é ele que trava a largada.
    const players: LobbyPlayer[] = [
      {id: 'p1', entityId: 1, name: 'ANFITRIAO', classId: undefined, ready: false, host: true, self: false},
      {id: 'p2', entityId: 2, name: 'LUCAS', classId: undefined, ready: false, host: false, self: true},
    ];
    const sala = fakeRoom('ABC123', players);
    setRoomConnector(async (_intent: OnlineIntent) => sala);
    openRoom({code: 'ABC123', server: 'ws://127.0.0.1:2567', seed: 's', name: 'LUCAS', roomName: ''});
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const antes = currentRoom();
    expect(antes).toBe(sala);
    const roomIdAntes = sala.roomId;
    const euAntes = sala.players.find(p => p.self)!.id;

    // A tela de personagem: escolher é a ÚNICA coisa que acontece.
    sala.chooseClass('gunslinger');

    expect(sala.chosen).toEqual(['gunslinger']);
    // O destino do VOLTAR, para este estado, é a sala — e não a raiz.
    expect(classScreenReturn(!!currentRoom(), true)).toBe('sala');
    // A sala é a MESMA: nada foi descartado, nada foi reaberto.
    expect(currentRoom()).toBe(antes);
    expect(sala.roomId).toBe(roomIdAntes);
    expect(sala.disposes).toBe(0);
    expect(sala.connects).toBe(1);
    // A identidade de quem escolheu não mudou, e a escolha caiu NELE.
    const eu = sala.players.find(p => p.self)!;
    expect(eu.id).toBe(euAntes);
    expect(eu.classId).toBe('gunslinger');
    // O outro jogador continua onde estava, sem classe.
    const outro = sala.players.find(p => !p.self)!;
    expect(outro.id).toBe('p1');
    expect(outro.classId).toBeUndefined();
  });
});

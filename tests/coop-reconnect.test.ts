import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom } from '../server/rooms/FarmRoom';
import { PHASE, type FarmState } from '../server/schema';
import type { FarmSimulation } from '../server/FarmSimulation';

/**
 * CAIR NÃO É SAIR.
 *
 * ## O que existia
 *
 * `onLeave` tratava as duas coisas igual: apagava o jogador da simulação e do schema na hora. Quem
 * perdia o wi-fi por dez segundos voltava como JOGADOR NOVO — outro `entityId`, inventário vazio,
 * no fim da fila de uma corrida que já ia pela metade. `tests/coop-four-clients` documentava isso
 * com todas as letras: "a sala não tem reconexão por token".
 *
 * ## O que existe agora
 *
 * A queda abre uma JANELA. Dentro dela o `PlayerState` fica na sala com tudo no lugar, e
 * `allowReconnection` devolve o MESMO `sessionId` quando o cliente volta. É isso que faz a vaga e o
 * inventário serem os mesmos sem token nenhum: a identidade É a sessão.
 *
 * E o jogador caído deixa de ser alvo legítimo da horda (`eligible`) enquanto espera. Sem isso,
 * quem perde a conexão volta para um cadáver — morto por bichos que ele não podia ver nem correr
 * de, num corpo que ninguém estava pilotando.
 *
 * Sair de propósito continua liberando a vaga na hora: quem clicou em SAIR não quer o lugar
 * guardado, e segurar uma vaga de quatro por meio minuto por causa disso é pior do que liberá-la.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  colyseus = await boot<any>({
    initializeGameServer: (gameServer: Server) => { gameServer.define('farm', FarmRoom).filterBy(['seed']); },
  }, 20000 + Math.floor(Math.random() * 30000));
}, 60_000);
afterAll(async () => { await colyseus?.shutdown(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(condition: () => boolean, attempts = 400): Promise<boolean> {
  for (let i = 0; i < attempts; i++) { if (condition()) return true; await wait(25); }
  return false;
}
/** A contagem da sala é de 3 s; esperar além dela é o que prova que a largada aconteceu. */
const PAST_COUNTDOWN = 4200;

type Cliente = {
  readonly sessionId: string; readonly roomId: string; readonly reconnectionToken: string;
  readonly state: FarmState; send(type: string, message?: unknown): void; leave(consented?: boolean): Promise<number>;
};

async function mesaDeDois(seed: string): Promise<{a: Cliente; b: Cliente; room: FarmRoom; sim: FarmSimulation}> {
  const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', {seed, name: 'ANA'}) as unknown as Cliente;
  const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', {seed, name: 'BENTO'}) as unknown as Cliente;
  expect(b.roomId).toBe(a.roomId);
  const room = colyseus.getRoomById<FarmRoom>(a.roomId);
  expect(await until(() => room.state.players.size === 2)).toBe(true);
  return {a, b, room, sim: room['sim'] as FarmSimulation};
}

async function largar(room: FarmRoom, clientes: Cliente[]): Promise<void> {
  for (const c of clientes) { c.send('chooseClass', {classId: 'gunslinger'}); c.send('setReady', {ready: true}); }
  await wait(PAST_COUNTDOWN);
  expect(room.state.phase).toBe(PHASE.playing);
}

describe('a queda no meio da corrida', () => {
  it('segura a vaga, marca desconectado e a volta é a MESMA corrida', async () => {
    const {a, b, room, sim} = await mesaDeDois('reconectar-1');
    try {
      await largar(room, [a, b]);

      const sessaoB = b.sessionId, entidadeB = room.state.players.get(sessaoB)!.entityId;
      // Uma pilha no inventário DELE: é o que prova que a volta não é um jogador novo.
      sim.players.get(sessaoB)!.loadout.addItem('battery');
      const token = b.reconnectionToken;

      // Queda, não saída: `leave(false)` não é o fecho normal do WebSocket.
      await b.leave(false);

      // A vaga continua ocupada, e o schema diz por quê.
      expect(await until(() => room.state.players.get(sessaoB)?.connected === false)).toBe(true);
      expect(room.state.players.get(sessaoB)).toBeDefined();
      expect(room.state.players.size).toBe(2);
      expect(room.state.phase).toBe(PHASE.playing);
      // E a horda deixa de considerá-lo: quem não está ao volante não é alvo legítimo.
      expect(sim.players.get(sessaoB)!.disconnected).toBe(true);

      const volta = await colyseus.sdk.reconnect(token) as unknown as Cliente;
      expect(volta.sessionId).toBe(sessaoB);
      expect(await until(() => room.state.players.get(sessaoB)?.connected === true)).toBe(true);

      // Mesma vaga, mesma numeração, mesmo inventário: é a mesma corrida.
      expect(room.state.players.get(sessaoB)!.entityId).toBe(entidadeB);
      expect(sim.players.get(sessaoB)!.loadout.inventory.get('battery')).toBe(1);
      expect(sim.players.get(sessaoB)!.disconnected).toBe(false);
      expect(room.state.playerCount).toBe(2);

      await a.leave(); await volta.leave();
    } finally { /* a sala morre com o último cliente */ }
  }, 120_000);

  /**
   * Sair é uma DECISÃO. Guardar o lugar de quem clicou em SAIR bloquearia uma vaga de quatro por
   * meio minuto — e é justamente quando um amigo quer entrar no lugar dele.
   */
  it('sair de propósito NÃO segura vaga nenhuma', async () => {
    const {a, b, room} = await mesaDeDois('reconectar-2');
    try {
      await largar(room, [a, b]);
      const sessaoB = b.sessionId;

      await b.leave(true);

      expect(await until(() => !room.state.players.get(sessaoB))).toBe(true);
      expect(room.state.players.size).toBe(1);
      expect(room.state.playerCount).toBe(1);
      await a.leave();
    } finally { /* idem */ }
  }, 120_000);

  /**
   * O ÚLTIMO A CAIR — o caso que a auditoria levantou.
   *
   * `autoDispose` não está configurado na `FarmRoom`, então vale o padrão do Colyseus: a sala se
   * descarta quando fica sem cliente. A pergunta é se a janela de reconexão SEGURA a sala de pé
   * quando quem caiu era o único que restava — porque, se não segurar, a promessa de "volta para a
   * mesma corrida" é falsa exatamente no caso mais provável de um co-op de amigos: dois jogando, um
   * sai para o jantar, o outro perde o wi-fi por dez segundos.
   *
   * Este caso EXISTE para fixar a resposta, qualquer que ela seja — se um dia o Colyseus mudar o
   * comportamento, ele avisa.
   */
  it('o ÚLTIMO jogador caindo: a sala sobrevive à janela e a volta é a mesma corrida', async () => {
    const {a, b, room, sim} = await mesaDeDois('reconectar-4');
    try {
      await largar(room, [a, b]);
      const sessaoA = a.sessionId;
      sim.players.get(sessaoA)!.loadout.addItem('battery');
      const token = a.reconnectionToken;

      // B sai de propósito: some na hora, e A fica sozinho.
      await b.leave(true);
      expect(await until(() => room.state.players.size === 1)).toBe(true);

      // Agora o ÚNICO que restava cai.
      await a.leave(false);
      expect(await until(() => room.state.players.get(sessaoA)?.connected === false)).toBe(true);

      const volta = await colyseus.sdk.reconnect(token) as unknown as Cliente;
      expect(volta.sessionId).toBe(sessaoA);
      expect(await until(() => room.state.players.get(sessaoA)?.connected === true)).toBe(true);
      expect(sim.players.get(sessaoA)!.loadout.inventory.get('battery')).toBe(1);
      await volta.leave();
    } finally { /* a sala morre com o último cliente */ }
  }, 120_000);

  /**
   * NO LOBBY não há corrida a preservar: nem posição, nem inventário, nem estágio. Segurar a vaga
   * ali só atrasaria a mesa de quem ficou esperando para começar.
   */
  it('cair no LOBBY libera a vaga na hora', async () => {
    const {a, b, room} = await mesaDeDois('reconectar-3');
    try {
      expect(room.state.phase).toBe(PHASE.lobby);
      const sessaoB = b.sessionId;

      await b.leave(false);

      expect(await until(() => !room.state.players.get(sessaoB))).toBe(true);
      expect(room.state.players.size).toBe(1);
      await a.leave();
    } finally { /* idem */ }
  }, 120_000);
});

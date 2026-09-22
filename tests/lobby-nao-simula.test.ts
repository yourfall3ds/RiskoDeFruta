import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom } from '../server/rooms/FarmRoom';
import { PHASE, type FarmState } from '../server/schema';
import type { FarmSimulation } from '../server/FarmSimulation';

/**
 * NINGUÉM MORRE ESCOLHENDO PERSONAGEM.
 *
 * ## Como isto apareceu
 *
 * Não foi por leitura de código. Um cliente de testes ficou numa sala que NUNCA largou e saiu
 * assim: `saindo {"vida":0,"municao":23}`. Morto, e com munição gasta, numa corrida que não tinha
 * começado — e nem eu nem ninguém tinha pedido para ele atirar em coisa alguma.
 *
 * A causa está numa linha do laço da sala:
 *
 *     this.sim.step(ctx.dt);   // sem olhar a fase
 *
 * A simulação avançava SEMPRE. A horda nascia, perseguia e feria enquanto os jogadores ainda
 * estavam na tela de personagem — que, do lado deles, é um MENU. O jogador entrava em campo já
 * ferido, ou entrava morto, sem nunca ter visto o que o matou.
 *
 * ## O que este arquivo afirma
 *
 * No lobby a simulação fica PARADA: sem corpo nascendo, sem tique correndo, sem vida caindo. E
 * afirma o outro lado junto — que depois da largada ela anda —, porque um teste que só prova o
 * silêncio passaria também se a simulação nunca mais funcionasse.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  colyseus = await boot<any>({
    initializeGameServer: (gameServer: Server) => { gameServer.define('farm', FarmRoom).filterBy(['seed']); },
  }, 20000 + Math.floor(Math.random() * 30000));
}, 60_000);
afterAll(async () => { await colyseus?.shutdown(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
/**
 * A primeira sala de um arquivo paga o carregamento da colisão da fazenda, e isso passa de dez
 * segundos numa máquina ocupada. A espera é generosa de propósito: ela não esconde defeito nenhum
 * — a condição continua tendo de virar verdadeira —, só não confunde máquina lenta com bug.
 */
async function until(condition: () => boolean, attempts = 1600): Promise<boolean> {
  for (let i = 0; i < attempts; i++) { if (condition()) return true; await wait(25); }
  return false;
}
const PAST_COUNTDOWN = 4200;

describe('o lobby é menu, e menu não simula', () => {
  it('parado no lobby: o tique não anda, a horda não nasce e ninguém perde vida', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'lobby-parado', name: 'ANA' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'lobby-parado', name: 'BENTO' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    expect(await until(() => room.state.players.size === 2)).toBe(true);
    const sim = room['sim'] as FarmSimulation;

    expect(room.state.phase).toBe(PHASE.lobby);
    /**
     * ENTRAR NO SCHEMA NÃO É ESTAR ESPELHADO.
     *
     * `onJoin` cria o `PlayerState` com os campos numéricos ainda por escrever; quem lê vida ou
     * posição antes do primeiro `mirror()` recebe `undefined` — e `undefined > 0` é falso sem erro
     * nenhum, que é a forma mais silenciosa de um caso destes mentir. Esperar aqui é o que separa
     * "a vida está zerada" de "a vida ainda não chegou".
     */
    expect(await until(() => [...room.state.players.values()].every(p => p.hp > 0 && Number.isFinite(p.x)))).toBe(true);
    // O TIQUE DO SERVIDOR, não o espelhado: o que está em julgamento é se a simulação AVANÇA.
    const tiqueAntes = sim.steps;

    // Tempo de sobra para a horda fazer estrago, se ela estivesse correndo.
    await wait(3000);

    const andouNoLobby = sim.steps - tiqueAntes;
    expect({ tiquesNoLobby: andouNoLobby, corpos: sim.enemies.actors.length }).toEqual({ tiquesNoLobby: 0, corpos: 0 });
    for (const p of room.state.players.values()) expect(p.hp).toBe(p.maxHP);
    expect(room.state.phase).toBe(PHASE.lobby);

    await a.leave(); await b.leave();
  }, 120_000);

  /**
   * O outro lado da mesma moeda. Sem este caso, parar a simulação PARA SEMPRE passaria no teste
   * acima — e o jogo inteiro viraria uma tela de menu muito bem testada.
   */
  it('depois da largada a simulação ANDA: o tique corre e a horda volta a existir', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'lobby-anda', name: 'ANA' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'lobby-anda', name: 'BENTO' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    expect(await until(() => room.state.players.size === 2)).toBe(true);

    const sim = room['sim'] as FarmSimulation;
    expect(await until(() => [...room.state.players.values()].every(p => p.hp > 0 && Number.isFinite(p.x)))).toBe(true);
    const tiqueNoLobby = sim.steps;
    for (const c of [a, b]) { c.send('chooseClass', { classId: 'gunslinger' }); c.send('setReady', { ready: true }); }
    await wait(PAST_COUNTDOWN);
    expect(room.state.phase).toBe(PHASE.playing);

    expect(await until(() => sim.steps > tiqueNoLobby)).toBe(true);
    // A horda é do diretor, e ele leva um tempo para soltar o primeiro corpo; o que importa aqui é
    // que o RELÓGIO da simulação voltou a andar.
    expect(sim.steps).toBeGreaterThan(tiqueNoLobby);

    await a.leave(); await b.leave();
  }, 120_000);
});


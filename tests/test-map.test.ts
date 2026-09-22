import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom } from '../server/rooms/FarmRoom';
import { PHASE, type FarmState } from '../server/schema';
import type { FarmSimulation } from '../server/FarmSimulation';
import { TEST_MAP_ID, TEST_MAP_SIZE, isTestMap, testMapCollision } from '../src/world/TestMap';

/**
 * O MAPA DE TESTE EXISTE PARA O TESTE SER RÁPIDO — e isto mede se ele é.
 *
 * A fazenda leva cinquenta e dois segundos para montar no cliente, e a corrida inteira passa de um
 * minuto e meio até o primeiro quadro jogável. Validar mecanismo em cima disso é pagar noventa
 * segundos por tentativa. O mapa de teste é um CHÃO: seis números, sem arquivo, sem malha.
 *
 * Os casos abaixo afirmam as duas coisas que fazem dele uma bancada útil: que a sala com ele sobe
 * DEPRESSA, e que continua sendo a mesma sala — mesma autoridade, mesmo nascimento em fileira,
 * mesma unanimidade. Uma bancada que se comporta diferente do jogo não prova nada sobre o jogo.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  colyseus = await boot<any>({
    initializeGameServer: (gameServer: Server) => { gameServer.define('farm', FarmRoom).filterBy(['seed']); },
  }, 20000 + Math.floor(Math.random() * 30000));
}, 60_000);
afterAll(async () => { await colyseus?.shutdown(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(condition: () => boolean, attempts = 1600): Promise<boolean> {
  for (let i = 0; i < attempts; i++) { if (condition()) return true; await wait(25); }
  return false;
}
const PAST_COUNTDOWN = 4200;

describe('a colisão do mapa de teste', () => {
  it('é um chão só, sem malha e sem volume de relevo', () => {
    const c = testMapCollision();
    expect(c.surfaces).toHaveLength(1);
    expect(c.surfaces[0]!.width).toBe(TEST_MAP_SIZE);
    expect({ malha: c.mesh.positions.length, solido: c.solid.positions.length }).toEqual({ malha: 0, solido: 0 });
  });

  /**
   * CERCADO, e as paredes ficam FORA do piso. Sem cerco, andar para um lado derruba o jogador da
   * borda e o teste de movimento vira teste de queda. Encostadas por fora, elas não comem piso.
   */
  it('quatro paredes cercam o chão por fora, sem invadir o piso', () => {
    const { boxes } = testMapCollision();
    const meio = TEST_MAP_SIZE / 2;
    expect(boxes).toHaveLength(4);
    for (const b of boxes) {
      // Nenhuma parede tem volume DENTRO do quadrado jogável.
      const invade = b.min.x < meio && b.max.x > -meio && b.min.z < meio && b.max.z > -meio;
      expect(invade, b.id).toBe(false);
      expect(b.max.y - b.min.y).toBeGreaterThan(2);
    }
    // E fecham os quatro lados: cada lado do quadrado tem uma parede encostada nele.
    expect(boxes.some(b => b.min.z === meio)).toBe(true);
    expect(boxes.some(b => b.max.z === -meio)).toBe(true);
    expect(boxes.some(b => b.min.x === meio)).toBe(true);
    expect(boxes.some(b => b.max.x === -meio)).toBe(true);
  });

  /** Um lugar só decide o que é mapa de teste, e ele não se confunde com o mapa do jogo. */
  it('reconhece o id do mapa de teste, e só ele', () => {
    expect(isTestMap(TEST_MAP_ID)).toBe(true);
    expect(isTestMap(' TEST-V1 ')).toBe(true);
    expect(isTestMap('')).toBe(false);
    expect(isTestMap(undefined)).toBe(false);
    expect(isTestMap('fazenda')).toBe(false);
  });
});

describe('uma sala no mapa de teste', () => {
  it('sobe em menos de cinco segundos e anuncia o mapa no estado', async () => {
    const começo = Date.now();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'mapa-rapido', name: 'ANA', map: TEST_MAP_ID });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    expect(await until(() => !!room.state.players.get(a.sessionId))).toBe(true);
    const demorou = Date.now() - começo;

    // O número é generoso de propósito: o que se afirma é a ORDEM DE GRANDEZA — segundos, não
    // dezenas de segundos —, e num teste que divide a máquina com outros nove arquivos.
    expect(demorou).toBeLessThan(5000);
    expect(room.state.settings.get('map')).toBe(TEST_MAP_ID);
    await a.leave();
  }, 60_000);

  /**
   * A BANCADA TEM DE SE COMPORTAR COMO O JOGO. Se o mapa de teste mudasse a numeração, o
   * nascimento ou a unanimidade, tudo o que fosse validado nele seria validado sobre outra coisa.
   */
  it('dois jogadores: numeração 1 e 2, lado a lado, e a largada continua exigindo unanimidade', async () => {
    const seed = 'mapa-dois';
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'ANA', map: TEST_MAP_ID });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'BENTO', map: TEST_MAP_ID });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    expect(await until(() => room.state.players.size === 2)).toBe(true);
    expect(await until(() => [...room.state.players.values()].every(p => p.hp > 0 && Number.isFinite(p.x)))).toBe(true);

    const pa = room.state.players.get(a.sessionId)!, pb = room.state.players.get(b.sessionId)!;
    expect([pa.entityId, pb.entityId].sort()).toEqual([1, 2]);
    // Lado a lado: mesma linha, separados na lateral, e longe o bastante para não se encavalarem.
    expect(pa.z).toBeCloseTo(pb.z, 3);
    expect(Math.abs(pa.x - pb.x)).toBeGreaterThan(1);
    /**
     * O chão é plano, então os dois pisam na MESMA altura — com a tolerância de quem assentou por
     * um número diferente de quadros. Eles entram em instantes diferentes, e o motor leva alguns
     * passos para pousar; exigir igualdade no milímetro seria afirmar sincronia de relógio, que não
     * é o que está em julgamento aqui. Dez centímetros separam "mesmo plano" de "degrau".
     */
    expect(Math.abs(pa.y - pb.y)).toBeLessThan(.1);

    // Só um pronto não larga nada.
    a.send('chooseClass', { classId: 'gunslinger' }); a.send('setReady', { ready: true });
    await wait(PAST_COUNTDOWN);
    expect(room.state.phase).toBe(PHASE.lobby);

    // O segundo fecha a unanimidade.
    b.send('chooseClass', { classId: 'gunslinger' }); b.send('setReady', { ready: true });
    await wait(PAST_COUNTDOWN);
    expect(room.state.phase).toBe(PHASE.playing);

    const sim = room['sim'] as FarmSimulation;
    expect(await until(() => sim.steps > 0)).toBe(true);
    await a.leave(); await b.leave();
  }, 120_000);
});

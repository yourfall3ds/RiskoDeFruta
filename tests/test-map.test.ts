import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom } from '../server/rooms/FarmRoom';
import { PHASE, type FarmState } from '../server/schema';
import { FarmSimulation } from '../server/FarmSimulation';
import { TEST_MAP, TEST_MAP_ID, TEST_MAP_SIZE, isTestMap, testMapCollision } from '../src/world/TestMap';
import { FARM_MAP } from '../src/world/FarmMap';

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

/** Conta quantos corpos o diretor nasce, sem mudar o que ele faz. */
function contarNascimentos(sim: FarmSimulation): () => number {
  let nascidos = 0;
  const original = sim.enemies.spawn.bind(sim.enemies);
  sim.enemies.spawn = ((...args: Parameters<typeof original>) => { nascidos++; return original(...args); }) as typeof sim.enemies.spawn;
  return () => nascidos;
}

describe('a simulação do laboratório', () => {
  /**
   * SEM HORDA. A primeira corrida no Test Map mostrou por quê: o jogador nasceu no assento, a horda
   * do diretor o empurrou em saltos de cinco metros e o matou no servidor em meio minuto — enquanto
   * a tela dele mostrava vida cheia. Num laboratório de mecanismo o único inimigo é o que o mapa põe.
   */
  it('um minuto parado no assento: nenhum inimigo nasce, ninguém se mexe, ninguém se machuca', async () => {
    const sim = new FarmSimulation('lab-sem-horda', testMapCollision(), TEST_MAP);
    await sim.prepare();
    const nascidos = contarNascimentos(sim);
    sim.addPlayer('ana');
    for (let i = 0; i < 30; i++) sim.step(1 / 60); // o corpo assenta no chão
    const antes = sim.snapshot().players[0]!;
    for (let i = 0; i < 60 * 60; i++) sim.step(1 / 60);
    const depois = sim.snapshot().players[0]!;

    expect(nascidos()).toBe(0);
    expect(sim.enemies.count).toBe(0);
    expect(depois.hp).toBe(antes.hp);
    expect({ x: depois.x, z: depois.z }).toEqual({ x: antes.x, z: antes.z });
    expect({ x: depois.x, z: depois.z }).toEqual({ x: TEST_MAP.playerSpawns[0]!.x, z: TEST_MAP.playerSpawns[0]!.z });
  });

  /** O desligamento é do MAPA, não do diretor: a mesma conta com a fazenda nasce horda. */
  it('a mesma conta com o mapa da fazenda nasce horda', async () => {
    const sim = new FarmSimulation('lab-sem-horda', testMapCollision(), FARM_MAP);
    await sim.prepare();
    const nascidos = contarNascimentos(sim);
    sim.addPlayer('ana');
    for (let i = 0; i < 60 * 60; i++) sim.step(1 / 60);
    expect(nascidos()).toBeGreaterThan(0);
  });

  /**
   * COLISÃO IDÊNTICA dos dois lados. Duas peças da fazenda entravam na colisão do servidor em
   * qualquer mapa, e as duas caem dentro do cercado do laboratório: o baú do celeiro (0; 5; 38,6) e
   * a balsa entre ilhas, que anda de x = -26 a -34 em z = -8. O cliente do laboratório não desenha
   * nenhuma das duas — eram objetos que só o servidor tinha. E sem baú no mapa, não há o que comprar.
   */
  it('a colisão do servidor é exatamente a do mapa, e não há baú para comprar', () => {
    const sim = new FarmSimulation('lab-sem-bau', testMapCollision(), TEST_MAP);
    const mapa = testMapCollision();
    expect(sim.collision.movingBoxes).toHaveLength(0);
    expect(sim.collision.boxes.map(b => b.id).sort()).toEqual(mapa.boxes.map(b => b.id).sort());
    expect(sim.collision.surfaces.map(s => s.id).sort()).toEqual(mapa.surfaces.map(s => s.id).sort());
    expect(sim.ferry).toBeUndefined();
    sim.addPlayer('ana');
    expect(sim.requestPurchase('ana', { interactableId: 'barn-campo-loft', requestId: '1' })).toMatchObject({ ok: false, reason: 'unknown-chest' });
  });

  it('a fazenda continua com os baús, os colisores deles e a balsa', () => {
    const sim = new FarmSimulation('fazenda-com-bau', testMapCollision(), FARM_MAP);
    expect(sim.collision.movingBoxes.some(b => b.id === 'barn-chest-barn-campo-loft')).toBe(true);
    expect(sim.collision.movingBoxes.some(b => b.id === 'moving-island-ferry')).toBe(true);
    expect(sim.chests.get('barn-campo-loft')).toBeDefined();
    expect(sim.ferry).toBeDefined();
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

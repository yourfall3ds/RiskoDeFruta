import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom } from '../server/rooms/FarmRoom';
import type { FarmState } from '../server/schema';
import type { FarmSimulation } from '../server/FarmSimulation';
import { MELEE_TUNING } from '../src/player/PlayerTuning';

/**
 * O SOCO TAMBÉM É DO SERVIDOR.
 *
 * O bloco E migrou o tiro e deixou o melee sem dono: o portão de autoridade do `EnemySwarm` recusa
 * o acerto local e não havia nada do outro lado — em co-op o soco não machucava ninguém. O §22.2
 * exige "P2 dá melee", então isto bloqueava o marco.
 *
 * O mínimo, e só ele: a intenção chega, o servidor resolve alcance, cone e linha de visão, e o dano
 * entra pela MESMA `applyDamage` do tiro, com o mesmo `combatEventId` e a mesma idempotência. Não
 * existe segundo pipeline de dano, segundo HP, segunda morte nem segundo RNG.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  colyseus = await boot<any>({
    initializeGameServer: (gameServer: Server) => { gameServer.define('farm', FarmRoom); },
  }, 20000 + Math.floor(Math.random() * 30000));
}, 60_000);
afterAll(async () => { await colyseus?.shutdown(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(condition: () => boolean, attempts = 200): Promise<boolean> {
  for (let i = 0; i < attempts; i++) { if (condition()) return true; await wait(25); }
  return false;
}
async function untilPlayer(room: FarmRoom, sessionId: string): Promise<void> {
  for (let i = 0; i < 100; i++) { if (room.state.players.get(sessionId)) return; await wait(50); }
  throw new Error(`jogador ${sessionId} não entrou no estado`);
}

const STEP = MELEE_TUNING.steps[0]!;

/** Um corpo parado à frente do punho, dentro do alcance da primeira etapa do combo. */
function plant(sim: FarmSimulation, puncher: string, distance = 1.5) {
  sim.enemies.director.stopped = true;
  const player = sim.players.get(puncher)!;
  // Olhando para `+Z`: é o yaw que o servidor usa para medir o cone.
  player.yaw = 0;
  const m = player.motor;
  const at = { x: m.position.x, y: m.position.y, z: m.position.z + distance };
  expect(sim.enemies.spawn('eggplant', at, 'normal')).toBe(true);
  return sim.enemies.actor(sim.enemies.lastSpawnedId)!;
}

describe('melee autoritativo: o punho do cliente vira dano no servidor', () => {
  it('P2 soca e o corpo perde vida — igual nas duas telas, e uma vez só por pedido', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'melee-1' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'melee-1' });
    expect(b.roomId).toBe(a.roomId);
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);

    const sim = room['sim'] as FarmSimulation;
    // Quem soca é o SEGUNDO jogador — o `entityId !== 1` que já tornou os jogadores 2..4 imortais.
    const enemy = plant(sim, b.sessionId);
    const key = String(enemy.id);
    expect(await until(() => !!a.state.enemies?.get(key) && !!b.state.enemies?.get(key))).toBe(true);

    const full = enemy.health.current;
    b.send('melee', { requestId: '1' });
    expect(await until(() => enemy.health.current < full)).toBe(true);
    const afterOne = enemy.health.current;
    expect(full - afterOne).toBeCloseTo(STEP.damage, 4);

    // O MESMO pedido de novo é no-op observável: nem dano, nem segundo golpe.
    b.send('melee', { requestId: '1' });
    await wait(200);
    expect(enemy.health.current).toBe(afterOne);

    // As duas telas veem o mesmo número porque nenhuma delas o calculou.
    expect(await until(() => a.state.enemies.get(key)?.hp === afterOne && b.state.enemies.get(key)?.hp === afterOne)).toBe(true);

    await a.leave(); await b.leave();
  }, 120_000);

  it('recusa de graça: fora de alcance, fora do cone e pedido de quem já morreu', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'melee-2' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId);
    const sim = room['sim'] as FarmSimulation;

    const far = plant(sim, a.sessionId, STEP.range + 4);
    expect(sim.requestMelee(a.sessionId, { requestId: 'far' })).toBe(0);
    expect(far.health.current).toBe(far.health.maximum);

    // Mesmo corpo, agora dentro do alcance mas ÀS COSTAS: o cone é regra, não decoração.
    const player = sim.players.get(a.sessionId)!;
    far.position.x = player.motor.position.x;
    far.position.y = player.motor.position.y;
    far.position.z = player.motor.position.z - 1.4;
    expect(sim.requestMelee(a.sessionId, { requestId: 'behind' })).toBe(0);
    expect(far.health.current).toBe(far.health.maximum);

    // De frente, o mesmo pedido acerta — a prova de que as recusas acima não foram por acidente.
    far.position.z = player.motor.position.z + 1.4;
    expect(sim.requestMelee(a.sessionId, { requestId: 'front' })).toBe(1);
    expect(far.health.current).toBeLessThan(far.health.maximum);

    /**
     * MORTO NÃO SOCA — e a decisão é DAQUI (§20.22).
     *
     * O cliente pode mandar o pedido achando-se vivo, porque o `dead` dele é espelho. Quem sabe é o
     * servidor, e a resposta é "inválido", não um travamento no cliente.
     */
    player.motor.hp = 0;
    const before = far.health.current;
    expect(sim.requestMelee(a.sessionId, { requestId: 'dead' })).toBe(0);
    expect(far.health.current).toBe(before);

    // E uma sessão que não é de ninguém não resolve nada.
    expect(sim.requestMelee('fantasma', { requestId: 'x' })).toBe(0);

    await a.leave();
  }, 120_000);

  it('o abate pelo soco paga UMA recompensa, pela mesma porta do tiro', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'melee-3' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId);
    const sim = room['sim'] as FarmSimulation;

    const enemy = plant(sim, a.sessionId);
    enemy.health.current = 1;
    const kills = sim.progression.totalKills, credits = sim.progression.credits;
    expect(sim.requestMelee(a.sessionId, { requestId: 'kill' })).toBe(1);
    expect(enemy.health.dead).toBe(true);
    expect(sim.progression.totalKills).toBe(kills + 1);
    expect(sim.progression.credits).toBeGreaterThan(credits);

    // Soco num cadáver não paga de novo: a guarda de morte é a mesma do bloco E.
    const paid = sim.progression.credits;
    expect(sim.requestMelee(a.sessionId, { requestId: 'again' })).toBe(0);
    expect(sim.progression.totalKills).toBe(kills + 1);
    expect(sim.progression.credits).toBe(paid);

    await a.leave();
  }, 120_000);
});

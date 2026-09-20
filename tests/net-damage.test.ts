import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom, NetInput, BUTTON } from '../server/rooms/FarmRoom';
import type { FarmState } from '../server/schema';
import type { FarmSimulation } from '../server/FarmSimulation';

/**
 * DOIS CLIENTES REAIS, UM TIRO SÓ.
 *
 * A prova de ponta a ponta do bloco E: o cliente manda INTENÇÃO (bit de FIRE + mira), o servidor
 * resolve, e a barra de vida desce UMA vez — igual nas duas telas. Se o cliente também aplicasse o
 * acerto, o atirador veria o corpo perder vida duas vezes e o companheiro uma só; se ninguém
 * aplicasse, o tiro seria decorativo, que era o estado antes deste bloco.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  // Porta sorteada — ver a explicação em `tests/net-room.test.ts`: `boot(Server)` crava a porta do
  // pacote e dois arquivos em paralelo se atropelam, pendurando o `beforeAll` e PULANDO os casos.
  colyseus = await boot<any>({
    initializeGameServer: (gameServer: Server) => { gameServer.define('farm', FarmRoom); },
  }, 20000 + Math.floor(Math.random() * 30000));
}, 60_000);
afterAll(async () => { await colyseus?.shutdown(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function untilPlayer(room: FarmRoom, sessionId: string): Promise<void> {
  for (let i = 0; i < 100; i++) { if (room.state.players.get(sessionId)) return; await wait(50); }
  throw new Error(`jogador ${sessionId} não entrou no estado`);
}
async function until(condition: () => boolean, attempts = 200): Promise<boolean> {
  for (let i = 0; i < attempts; i++) { if (condition()) return true; await wait(25); }
  return false;
}

/**
 * Um alvo parado à frente do atirador, com o diretor desligado.
 *
 * Sem isso a horda espontânea entraria na linha da bala e o caso deixaria de dizer o que promete.
 */
function plant(sim: FarmSimulation, shooter: string) {
  sim.enemies.director.stopped = true;
  const motor = sim.players.get(shooter)!.motor;
  const at = { x: motor.position.x, y: motor.position.y, z: motor.position.z + 8 };
  expect(sim.enemies.spawn('eggplant', at, 'normal')).toBe(true);
  return sim.enemies.actor(sim.enemies.lastSpawnedId)!;
}

/** Mira do atirador para o torso do alvo, no formato que o `NetInput` já carrega: yaw e pitch. */
function aim(sim: FarmSimulation, shooter: string, targetId: number): { yaw: number; pitch: number } {
  const p = sim.players.get(shooter)!.motor.position, a = sim.enemies.actor(targetId)!.position;
  const dx = a.x - p.x, dy = (a.y + 1) - (p.y + 1.3), dz = a.z - p.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  return { yaw: Math.atan2(dx, dz), pitch: -Math.asin(dy / length) };
}

describe('o tiro atravessa a rede como intenção e volta como estado', () => {
  it('a vida do corpo desce UMA vez, igual nos dois clientes', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-damage-1' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-damage-1' });
    expect(b.roomId).toBe(a.roomId);
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);

    const sim = room['sim'] as FarmSimulation;
    const enemy = plant(sim, a.sessionId);
    const key = String(enemy.id);
    expect(await until(() => !!a.state.enemies?.get(key) && !!b.state.enemies?.get(key))).toBe(true);

    const input = a.input({ type: NetInput });
    // A intenção é reenviada com mira atualizada: o corpo anda, e quem persegue a mira é o cliente.
    for (let i = 1; i <= 40 && !enemy.health.dead && enemy.health.current === enemy.health.maximum; i++) {
      const { yaw, pitch } = aim(sim, a.sessionId, enemy.id);
      input.data.x = 0; input.data.z = 0; input.data.yaw = yaw; input.data.pitch = pitch;
      input.data.buttons = BUTTON.FIRE; input.data.seq = i; input.send();
      await wait(1000 / 60);
    }
    expect(enemy.health.current).toBeLessThan(enemy.health.maximum);

    // O NÚMERO é o mesmo nas duas telas porque nenhuma delas o calculou.
    const hp = enemy.health.current;
    expect(await until(() => a.state.enemies.get(key)?.hp === hp && b.state.enemies.get(key)?.hp === hp)).toBe(true);
    expect(a.state.enemies.get(key)!.hp).toBe(b.state.enemies.get(key)!.hp);
    // Quem não atirou não gastou munição: a intenção é de quem a enviou.
    expect(room.state.players.get(b.sessionId)!.ammo).toBe(50);

    await a.leave(); await b.leave();
  }, 120_000);

  it('o abate pelo tiro de um jogador conta uma vez para a sala inteira', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-damage-2' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-damage-2' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);

    const sim = room['sim'] as FarmSimulation;
    const enemy = plant(sim, a.sessionId);
    enemy.health.current = 1;                           // um tiro basta; a morte continua sendo do servidor
    const key = String(enemy.id), before = room.state.progression.totalKills;
    expect(await until(() => !!a.state.enemies?.get(key) && !!b.state.enemies?.get(key))).toBe(true);

    const input = a.input({ type: NetInput });
    for (let i = 1; i <= 40 && !enemy.health.dead; i++) {
      const { yaw, pitch } = aim(sim, a.sessionId, enemy.id);
      input.data.x = 0; input.data.z = 0; input.data.yaw = yaw; input.data.pitch = pitch;
      input.data.buttons = BUTTON.FIRE; input.data.seq = i; input.send();
      await wait(1000 / 60);
    }
    expect(enemy.health.dead).toBe(true);
    const dead = (state: FarmState) => state.enemies.get(key)?.alive === false;
    expect(await until(() => dead(a.state) && dead(b.state))).toBe(true);
    // Um abate, não um por cliente — que é o que dois donos da mesma regra produziriam.
    expect(room.state.progression.totalKills).toBe(before + 1);

    await a.leave(); await b.leave();
  }, 120_000);
});

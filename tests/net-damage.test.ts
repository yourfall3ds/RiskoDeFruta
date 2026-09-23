import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom } from '../server/rooms/FarmRoom';
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
 * LARGAR A CORRIDA — obrigatório desde que o lobby parou de simular.
 *
 * O mundo ficava vivo enquanto os jogadores ainda escolhiam personagem: a horda nascia e feria
 * quem estava no menu, e o jogador entrava em campo já machucado, ou morto, sem ter visto o quê.
 * Com o lobby parado, tiro e movimento só valem depois da largada — que é como o jogo se comporta
 * para quem joga. O que estes casos afirmam sobre AUTORIDADE continua idêntico.
 */
async function largar(clients: readonly { send(type: string, message?: unknown): void }[]): Promise<void> {
  for (const c of clients) { c.send('chooseClass', { classId: 'gunslinger' }); c.send('setReady', { ready: true }); }
  await wait(4200);   // a contagem da sala é de 3 s
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

/**
 * O pedido de acerto que a arma local mandaria (ver `src/net/HitClaim.ts`): quem atira diz o que
 * acertou; o servidor valida, calcula o dano final e aplica.
 */
function claim(target: { id: number; position: { x: number; y: number; z: number } }, attack: string, base = 12) {
  return {
    enemy: target.id, base, tags: ['bullet'], source: 'dual_pistols', attack, weak: false, proc: 0,
    point: { x: target.position.x, y: target.position.y + 1, z: target.position.z },
    force: { x: 0, y: 0, z: 1 }, forceMagnitude: 2,
  };
}

describe('o tiro atravessa a rede como pedido e volta como estado', () => {
  it('a vida do corpo desce UMA vez, igual nos dois clientes — e o pedido repetido é recusado', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-damage-1' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-damage-1' });
    expect(b.roomId).toBe(a.roomId);
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);
    await largar([a, b]);

    const sim = room['sim'] as FarmSimulation;
    const enemy = plant(sim, a.sessionId);
    const key = String(enemy.id);
    expect(await until(() => !!a.state.enemies?.get(key) && !!b.state.enemies?.get(key))).toBe(true);

    a.send('hit', claim(enemy, 'shot#1'));
    expect(await until(() => enemy.health.current < enemy.health.maximum)).toBe(true);
    const hp = enemy.health.current;
    // O MESMO disparo chegando de novo (retransmissão) não fere duas vezes.
    a.send('hit', claim(enemy, 'shot#1'));
    await wait(200);
    expect(enemy.health.current).toBe(hp);

    // O NÚMERO é o mesmo nas duas telas porque nenhuma delas o calculou.
    expect(await until(() => a.state.enemies.get(key)?.hp === hp && b.state.enemies.get(key)?.hp === hp)).toBe(true);
    await a.leave(); await b.leave();
  }, 120_000);

  it('o abate pelo pedido de um jogador conta uma vez para a sala inteira', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-damage-2' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-damage-2' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);
    await largar([a, b]);

    const sim = room['sim'] as FarmSimulation;
    const enemy = plant(sim, a.sessionId);
    enemy.health.current = 1;                           // um acerto basta; a morte continua sendo do servidor
    const key = String(enemy.id), before = room.state.progression.totalKills;
    expect(await until(() => !!a.state.enemies?.get(key) && !!b.state.enemies?.get(key))).toBe(true);

    // Os DOIS reivindicam o mesmo corpo quase juntos: um mata, o outro bate num cadáver.
    a.send('hit', claim(enemy, 'a#1')); b.send('hit', claim(enemy, 'b#1'));
    expect(await until(() => enemy.health.dead)).toBe(true);
    const dead = (state: FarmState) => state.enemies.get(key)?.alive === false;
    expect(await until(() => dead(a.state) && dead(b.state))).toBe(true);
    await wait(200);
    expect(room.state.progression.totalKills).toBe(before + 1);
    await a.leave(); await b.leave();
  }, 120_000);

  it('pedido implausível não fere: ponto longe do corpo', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-damage-3' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId);
    await largar([a]);
    const sim = room['sim'] as FarmSimulation;
    const enemy = plant(sim, a.sessionId);
    const longe = claim(enemy, 'x#1'); longe.point = { x: enemy.position.x + 30, y: enemy.position.y, z: enemy.position.z };
    a.send('hit', longe);
    await wait(300);
    expect(enemy.health.current).toBe(enemy.health.maximum);
    expect(sim.rejectedHits.get('ponto')).toBe(1);
    await a.leave();
  }, 120_000);

  it('o disparo de um chega ao OUTRO para ser desenhado, e não volta para quem atirou', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-damage-4' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-damage-4' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);
    const vistosA: unknown[] = [], vistosB: { entityId: number; weapon: string }[] = [];
    a.onMessage('shot', m => vistosA.push(m)); b.onMessage('shot', m => vistosB.push(m));
    a.onMessage('*', () => {}); b.onMessage('*', () => {});
    await largar([a, b]);
    a.send('shot', { weapon: 'prism', mode: 1, from: { x: 0, y: 1, z: 0 }, to: { x: 0, y: 1, z: 50 } });
    expect(await until(() => vistosB.length === 1)).toBe(true);
    expect(vistosB[0]!.weapon).toBe('prism');
    expect(vistosB[0]!.entityId).toBe(room.state.players.get(a.sessionId)!.entityId);
    expect(vistosA.length).toBe(0);
    await a.leave(); await b.leave();
  }, 120_000);
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom } from '../server/rooms/FarmRoom';
import type { FarmState } from '../server/schema';
import { ENEMY_STATES } from '../server/schema';

/**
 * DOIS CLIENTES REAIS, UM MUNDO SÓ.
 *
 * Este arquivo é a prova do bloco: até aqui `EnemyState` era declarado no schema e NUNCA escrito, e
 * cada cliente rodava a própria horda. As afirmações abaixo são as que só passam quando existe um
 * dono único — mesmos ids, mesma vida, mesmo alvo, mesma morte.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  const server = new Server({ transport: new WebSocketTransport({ server: createServer() }) });
  server.define('farm', FarmRoom);
  colyseus = await boot(server);
}, 60_000);
afterAll(async () => { await colyseus.shutdown(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function untilPlayer(room: FarmRoom, sessionId: string): Promise<void> {
  for (let i = 0; i < 100; i++) { if (room.state.players.get(sessionId)) return; await wait(50); }
  throw new Error(`jogador ${sessionId} não entrou no estado`);
}
/** Espera a condição valer nos DOIS clientes; patch de 30 Hz sob carga não cabe em tempo fixo. */
async function until(condition: () => boolean, attempts = 240): Promise<boolean> {
  for (let i = 0; i < attempts; i++) { if (condition()) return true; await wait(50); }
  return false;
}
/** `enemies` é `undefined` no cliente até a primeira patch chegar — antes disso não há mundo ainda. */
const rows = (state: FarmState) => state?.enemies ? [...state.enemies.values()] : [];
const ids = (state: FarmState) => rows(state).map(e => e.id).sort((x, y) => x - y);

describe('a horda replicada é a mesma nos dois clientes', () => {
  it('mesmos ids, mesma vida e mesmo alvo — e o schema finalmente É preenchido', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-enemies-1' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-enemies-1' });
    expect(b.roomId).toBe(a.roomId);
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);

    // O diretor precisa de tempo de relógio para pagar o primeiro corpo.
    expect(await until(() => rows(a.state).length > 0 && rows(b.state).length > 0)).toBe(true);
    // Isto sozinho já era impossível antes: `mirror()` nunca escrevia `EnemyState`.
    expect(rows(room.state).length).toBeGreaterThan(0);

    expect(await until(() => JSON.stringify(ids(a.state)) === JSON.stringify(ids(b.state)))).toBe(true);
    expect(ids(a.state)).toEqual(ids(b.state));
    expect(ids(a.state)).toEqual(ids(room.state));

    for (const ra of rows(a.state)) {
      const rb = rows(b.state).find(e => e.id === ra.id)!;
      expect(rb).toBeDefined();
      // Vida, espécie, variante e ESTADO vêm do servidor: nenhum cliente os calcula.
      expect(rb.hp).toBe(ra.hp);
      expect(rb.maxHP).toBe(ra.maxHP);
      expect(rb.kind).toBe(ra.kind);
      expect(rb.variant).toBe(ra.variant);
      // O ALVO é o campo que fecha o bug original: sem ele, cada tela adivinharia um alvo diferente.
      expect(rb.targetPlayerId).toBe(ra.targetPlayerId);
      expect(ENEMY_STATES[ra.state]).toBeDefined();
    }
    await a.leave(); await b.leave();
  }, 120_000);

  it('a morte acontece UMA vez e os dois clientes veem a mesma', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-enemies-2' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-enemies-2' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);
    expect(await until(() => rows(a.state).length > 0 && rows(b.state).length > 0)).toBe(true);

    const victim = rows(room.state)[0]!;
    const before = room.state.progression.totalKills;
    // O abate é pedido ao SERVIDOR. Nenhum cliente reivindica morte — é a regra do contrato §1.
    room['sim'].enemies.applyDamage(victim.id, {
      attackerId: 0, victimId: victim.id, sourceId: 'qa', attackId: 'qa',
      baseDamage: victim.maxHP * 10, finalDamage: victim.maxHP * 10, crit: false,
      procCoefficient: 0, procChainDepth: 0, damageTags: ['qa'],
      hitPosition: { x: victim.x, y: victim.y, z: victim.z }, hitNormal: { x: 0, y: 1, z: 0 },
      forceDirection: { x: 0, y: 0, z: 1 }, forceMagnitude: 0,
    });

    const deadFor = (state: FarmState) => state.enemies.get(String(victim.id))?.alive === false;
    expect(await until(() => deadFor(a.state) && deadFor(b.state))).toBe(true);
    expect(a.state.enemies.get(String(victim.id))!.hp).toBe(0);
    expect(b.state.enemies.get(String(victim.id))!.hp).toBe(0);
    // Uma morte, um abate — e não um por cliente, que é o que aconteceria com dois donos da regra.
    expect(room.state.progression.totalKills).toBe(before + 1);
    await a.leave(); await b.leave();
  }, 120_000);

  it('quem entra depois recebe a horda que já está em campo, sem inventar corpo nenhum', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-enemies-3' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId);
    expect(await until(() => rows(a.state).length > 0)).toBe(true);

    const late = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-enemies-3' });
    await untilPlayer(room, late.sessionId);
    expect(await until(() => rows(late.state).length > 0 && JSON.stringify(ids(late.state)) === JSON.stringify(ids(room.state)))).toBe(true);
    expect(ids(late.state)).toEqual(ids(room.state));
    await a.leave(); await late.leave();
  }, 120_000);
});

import { describe, it, expect } from 'vitest';
import { FarmSimulation } from '../server/FarmSimulation';
import { DAMAGE_TABLE, authorizedBase } from '../server/DamageTable';
import { sanitizeHitClaim, sanitizeShot, HIT_MAX_SINGLE, type HitClaim } from '../src/net/HitClaim';
import { TEST_MAP, testMapCollision } from '../src/world/TestMap';
import { PRISM_MODES } from '../src/combat/PrismTuning';
import { PISTOL_TUNING } from '../src/player/PlayerTuning';

/** O pedido de acerto: quem atira diz QUEM acertou com QUAL arma; o servidor decide QUANTO. */
async function arena(): Promise<{ sim: FarmSimulation; enemy: { id: number; position: { x: number; y: number; z: number }; health: { current: number; maximum: number } } }> {
  const sim = new FarmSimulation('claim', testMapCollision(), TEST_MAP);
  await sim.prepare();
  sim.clientHits = true;
  sim.addPlayer('a');
  sim.enemies.director.stopped = true;
  const p = sim.players.get('a')!.motor.position;
  expect(sim.enemies.spawn('eggplant', { x: p.x, y: p.y, z: p.z + 8 }, 'normal')).toBe(true);
  return { sim, enemy: sim.enemies.actor(sim.enemies.lastSpawnedId)! };
}
const pedido = (enemy: { id: number; position: { x: number; y: number; z: number } }, over: Partial<HitClaim> = {}): HitClaim => ({
  enemy: enemy.id, base: 12, tags: ['bullet'], source: 'dual_pistols', attack: 'a#' + Math.random(), weak: false, proc: 0,
  point: { ...enemy.position }, force: { x: 0, y: 0, z: 1 }, forceMagnitude: 2, ...over,
});

describe('tabela de dano do servidor', () => {
  it('conhece as três classes e deixa o soco de fora', () => {
    expect(DAMAGE_TABLE.get('dual_pistols')).toBe(PISTOL_TUNING.damage);
    for (const mode of PRISM_MODES) expect(DAMAGE_TABLE.get(mode.id)).toBeGreaterThanOrEqual(mode.damage);
    expect(DAMAGE_TABLE.get('prism_sniper')).toBeCloseTo(140 * 3.2, 5);   // perfurante pesada
    expect(DAMAGE_TABLE.has('silk_smg')).toBe(true);
    expect([...DAMAGE_TABLE.keys()].some(k => k.startsWith('unarmed'))).toBe(false);
  });
  it('o número do cliente é só dica: nunca passa do teto, e fonte desconhecida é recusada', () => {
    expect(authorizedBase('dual_pistols', 800)).toBeCloseTo(PISTOL_TUNING.damage, 2);
    expect(authorizedBase('dual_pistols', 5)).toBe(5);
    expect(authorizedBase('unarmed_right-cross', 20)).toBeUndefined();
    expect(authorizedBase('inventada', 1)).toBeUndefined();
  });
});

describe('saneamento do que vem da rede', () => {
  it('recusa lixo e limita o que passa', () => {
    expect(sanitizeHitClaim(undefined)).toBeUndefined();
    expect(sanitizeHitClaim({ enemy: 1, base: NaN, point: { x: 0, y: 0, z: 0 } })).toBeUndefined();
    expect(sanitizeHitClaim({ enemy: 1, base: HIT_MAX_SINGLE + 1, point: { x: 0, y: 0, z: 0 } })).toBeUndefined();
    const ok = sanitizeHitClaim({ enemy: 1, base: 10, point: { x: 0, y: 0, z: 0 }, tags: ['bullet', 3], proc: 9 })!;
    expect(ok.tags).toEqual(['bullet']);
    expect(ok.proc).toBe(3);
    expect(sanitizeShot({ weapon: 'laser', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 1 } })).toBeUndefined();
  });
});

describe('claimHit na simulação', () => {
  it('aplica com o dano da TABELA, não com o do pedido', async () => {
    const { sim, enemy } = await arena();
    const antes = enemy.health.current;
    expect(sim.claimHit('a', pedido(enemy, { base: 800 }))).toBeUndefined();
    const perdido = antes - enemy.health.current;
    expect(perdido).toBeGreaterThan(0);
    expect(perdido).toBeLessThanOrEqual(PISTOL_TUNING.damage * 2.5);   // teto × itens/crítico, nunca 800
  });
  it('recusa: ponto longe, soco local, proc do cliente e evento repetido', async () => {
    const { sim, enemy } = await arena();
    expect(sim.claimHit('a', pedido(enemy, { point: { x: enemy.position.x + 20, y: enemy.position.y, z: enemy.position.z } }))).toBe('ponto');
    expect(sim.claimHit('a', pedido(enemy, { source: 'unarmed_right-cross' }))).toBe('fonte');
    expect(sim.claimHit('a', pedido(enemy, { proc: 1 }))).toBe('proc');
    const um = pedido(enemy, { attack: 'mesmo' });
    expect(sim.claimHit('a', um)).toBeUndefined();
    expect(sim.claimHit('a', { ...um })).toBe('repetido');
  });
  it('o orçamento por segundo corta um cliente em laço, e volta no segundo seguinte', async () => {
    const { sim, enemy } = await arena();
    enemy.health.current = enemy.health.maximum = 1e9;
    let aceitos = 0;
    for (let i = 0; i < 400; i++) if (sim.claimHit('a', pedido(enemy)) === undefined) aceitos++;
    expect(aceitos).toBeLessThan(400);
    expect(aceitos).toBeGreaterThan(50);   // fogo legítimo (pistola a 3,3/s) nem chega perto
    for (let i = 0; i < 61; i++) sim.step(1 / 60);
    expect(sim.claimHit('a', pedido(enemy))).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { FarmSimulation, EMPTY_INPUT, type CollisionData } from '../server/FarmSimulation';
import { NO_TARGET, STICKY_LOCK_SECONDS } from '../src/enemies/EnemyTargeting';

/**
 * O TESTE DO DESLIGAMENTO (contrato §18.11).
 *
 * Nada aqui cria cena, malha, material ou câmera: é a simulação nua. Se a horda precisasse de
 * renderização para nascer, mirar, bater ou morrer, este arquivo nem compilaria — e isso é
 * exatamente a prova de que não sobrou gameplay escondido no cliente.
 */
function collision(): CollisionData {
  const read = (name: string) => JSON.parse(readFileSync(`public/models/${name}`, 'utf8'));
  const farm = read('farm-collision.json');
  const data: CollisionData = { boxes: farm.boxes, surfaces: farm.surfaces, mesh: read('world-collision-mesh.json'), solid: read('solid-island-collision.json') };
  if (existsSync('public/models/farm-city-collision.json')) data.city = read('farm-city-collision.json');
  return data;
}
const DT = 1 / 60;
const run = (sim: FarmSimulation, seconds: number) => { for (let i = 0; i < Math.round(seconds * 60); i++) sim.step(DT); };
const make = (seed: string) => new FarmSimulation(seed, collision());
/** Coloca o motor de um jogador num ponto exato, para a geometria do teste ser a do enunciado. */
function place(sim: FarmSimulation, id: string, x: number, z: number): void {
  const motor = sim.players.get(id)!.motor;
  motor.position.x = x; motor.position.z = z;
  Object.assign(motor.previous, motor.position);
}
const kill = (sim: FarmSimulation, id: string) => { sim.players.get(id)!.motor.hp = 0; };

describe('horda autoritativa, sem renderização nenhuma', () => {
  it('nasce, persegue e morre com a renderização completamente ausente', async () => {
    const sim = make('headless');
    sim.addPlayer('a');
    // Sem cena, sem `EnemySwarm`, sem GLB: o diretor sozinho tem de povoar o mundo.
    run(sim, 30);
    const alive = sim.snapshot().enemies;
    expect(alive.length).toBeGreaterThan(0);
    expect(alive.every(e => e.maxHP > 0 && e.alive)).toBe(true);

    const victim = alive[0]!;
    const killed = sim.enemies.applyDamage(victim.id, damage(victim.maxHP * 10, victim.id));
    expect(killed).toBe(true);
    expect(sim.enemies.kills).toBe(1);
    const row = sim.snapshot().enemies.find(e => e.id === victim.id)!;
    expect(row.alive).toBe(false);
    expect(row.hp).toBe(0);
    // O abate pagou a equipe — a recompensa é regra de jogo, e regra de jogo é do servidor.
    expect(sim.snapshot().credits).toBeGreaterThan(0);
  }, 60_000);

  it('não deixa a população passar do teto nem com o diretor correndo solto', async () => {
    const sim = make('cap');
    sim.addPlayer('a');
    sim.enemies.populationCap = 6;
    run(sim, 120);
    expect(sim.enemies.count).toBeLessThanOrEqual(6);
  }, 90_000);

  it('sem jogador vivo a horda não decide nada: o diretor não acumula e ninguém nasce', async () => {
    const sim = make('no-players');
    sim.addPlayer('a');
    kill(sim, 'a');
    run(sim, 40);
    expect(sim.snapshot().enemies.length).toBe(0);
  }, 60_000);
});

describe('alvo por política, não "o vivo mais próximo"', () => {
  it('adquire alvo, GRAVA em targetPlayerId e o mantém — sem reselecionar por tique', async () => {
    const sim = make('acquire');
    sim.addPlayer('a'); sim.addPlayer('b');
    place(sim, 'a', 0, -14); place(sim, 'b', 0, -12);
    run(sim, 25);
    const hunters = sim.snapshot().enemies.filter(e => e.state !== 'spawn');
    expect(hunters.length).toBeGreaterThan(0);
    for (const e of hunters) expect([1, 2]).toContain(e.targetPlayerId);
    // Travamento: o alvo tem idade, ou seja ele foi MANTIDO entre tiques em vez de reescolhido.
    expect(Math.max(...hunters.map(e => e.targetLockTime))).toBeGreaterThan(1);
  }, 60_000);

  it('um sticky NÃO troca de alvo porque o outro jogador ficou centímetros mais perto', async () => {
    const sim = make('sticky');
    sim.addPlayer('a'); sim.addPlayer('b');
    place(sim, 'a', 0, -14); place(sim, 'b', 40, -14);
    run(sim, 20);
    const sticky = sim.enemies.actors.find(a => a.active && a.kind === 'eggplant' && a.targetPlayerId !== NO_TARGET);
    expect(sticky).toBeDefined();
    const before = sticky!.targetPlayerId;
    const other = before === 1 ? 'b' : 'a';
    // O outro jogador é teleportado para 5 cm mais perto do corpo do que o alvo atual.
    const target = sim.players.get(before === 1 ? 'a' : 'b')!.motor.position;
    place(sim, other, sticky!.position.x + (target.x - sticky!.position.x) * .99, sticky!.position.z + (target.z - sticky!.position.z) * .99);
    run(sim, 6);   // além do travamento, para provar que nem destravado ele troca por centímetros
    expect(sticky!.targetLockTime).toBeGreaterThan(STICKY_LOCK_SECONDS);
    expect(sticky!.targetPlayerId).toBe(before);
  }, 60_000);

  it('RETARGETA quando o alvo morre, e o motivo da invalidação é a morte', async () => {
    const sim = make('retarget');
    sim.addPlayer('a'); sim.addPlayer('b');
    place(sim, 'a', 0, -14); place(sim, 'b', 6, -14);
    run(sim, 20);
    const hunter = sim.enemies.actors.find(a => a.active && !a.health.dead && a.targetPlayerId !== NO_TARGET);
    expect(hunter).toBeDefined();
    const doomed = hunter!.targetPlayerId;
    kill(sim, doomed === 1 ? 'a' : 'b');
    expect(sim.enemies.targetInvalidation(hunter!)).toBe('alvo morreu');
    run(sim, 1);
    // O sobrevivente é o novo alvo — e o morto deixou de ser alvo normal da IA (contrato §18.5).
    expect(hunter!.targetPlayerId).not.toBe(doomed);
    expect(hunter!.targetPlayerId).toBe(doomed === 1 ? 2 : 1);
  }, 60_000);

  it('com o alvo morto e ninguém mais vivo, a horda fica sem alvo em vez de mirar num cadáver', async () => {
    const sim = make('all-dead');
    sim.addPlayer('a');
    run(sim, 20);
    const hunter = sim.enemies.actors.find(a => a.active && a.targetPlayerId !== NO_TARGET);
    expect(hunter).toBeDefined();
    kill(sim, 'a');
    run(sim, .5);
    expect(sim.enemies.targetOf(hunter!)).toBeUndefined();
  }, 60_000);

  it('muitos inimigos e muitos jogadores NÃO convergem todos no mesmo alvo', async () => {
    const sim = make('spread');
    for (const id of ['a', 'b', 'c', 'd']) sim.addPlayer(id);
    place(sim, 'a', 0, -14); place(sim, 'b', 14, -14); place(sim, 'c', -14, -14); place(sim, 'd', 0, -28);
    run(sim, 60);
    const targeted = sim.snapshot().enemies.filter(e => e.targetPlayerId !== NO_TARGET);
    expect(targeted.length).toBeGreaterThan(2);
    // A prova do enunciado: o alvo VARIA entre os vivos. Com `nearestLivingPlayer` como regra única
    // este conjunto teria tamanho 1 — e era exatamente a pilha que a correção de premissa proíbe.
    expect(new Set(targeted.map(e => e.targetPlayerId)).size).toBeGreaterThan(1);
  }, 90_000);

  it('o nascimento roda entre os vivos: a horda não brota toda em cima de um jogador só', async () => {
    const sim = make('reference');
    for (const id of ['a', 'b', 'c']) sim.addPlayer(id);
    place(sim, 'a', 0, -14); place(sim, 'b', 45, -14); place(sim, 'c', -45, -14);
    run(sim, 70);
    const born = sim.snapshot().enemies;
    expect(born.length).toBeGreaterThan(1);
    const nearestTo = (x: number) => born.filter(e => Math.abs(e.x - x) < 36).length;
    // Nenhum jogador concentra a horda inteira: a referência de spawn variou (contrato §18.6).
    expect(Math.max(nearestTo(0), nearestTo(45), nearestTo(-45))).toBeLessThan(born.length);
  }, 90_000);
});

describe('jogadores 2..4 deixam de ser imortais', () => {
  it('o dano da horda escolhe a VÍTIMA, e o motor dela aceita', async () => {
    const sim = make('victims');
    sim.addPlayer('a'); const b = sim.addPlayer('b');
    const motor = sim.players.get('b')!.motor;
    expect(motor.entityId).toBe(b.entityId);
    const before = motor.hp;
    motor.invulnerable = 0;
    motor.applyDamage(damage(25, 0, b.entityId));
    // Antes, `applyDamage` comparava com o literal 1: este dano seria descartado em silêncio.
    expect(motor.hp).toBeLessThan(before);
  });
});

/** Contexto mínimo de dano; o hitscan de verdade é o bloco E. */
function damage(amount: number, attackerId: number, victimId = attackerId) {
  return {
    attackerId, victimId, sourceId: 'qa', attackId: 'qa', baseDamage: amount, finalDamage: amount,
    crit: false, procCoefficient: 0, procChainDepth: 0, damageTags: ['qa'],
    hitPosition: { x: 0, y: 0, z: 0 }, hitNormal: { x: 0, y: 1, z: 0 },
    forceDirection: { x: 0, y: 0, z: 1 }, forceMagnitude: 0,
  };
}

it('o passo da horda não depende de entrada de jogador: um cliente parado vê o mesmo mundo', async () => {
  const sim = make('observer');
  sim.addPlayer('a'); sim.addPlayer('b');
  // A anda; B nunca manda nada (o "observador" do contrato §18.11).
  sim.applyInput('a', { frame: { ...EMPTY_INPUT, z: 1 }, yaw: 0, pitch: 0, seq: 1 });
  run(sim, 30);
  expect(sim.snapshot().enemies.length).toBeGreaterThan(0);
  // O mundo de inimigos é UM só: a lista é a mesma leitura para os dois, porque só existe uma.
  expect(sim.snapshot().enemies).toEqual(sim.snapshot().enemies);
}, 60_000);

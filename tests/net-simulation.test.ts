import { describe, it, expect } from 'vitest';
import {SPRINT_SPEED} from '../src/player/PlayerTuning';
import { readFileSync, existsSync } from 'node:fs';
import { FarmSimulation, EMPTY_INPUT, type CollisionData } from '../server/FarmSimulation';

/** Mesmos JSONs que `FarmWorld.load` busca por fetch (cidade agrícola quando existir); o servidor não carrega GLB. */
function collision(): CollisionData {
  const read = (name: string) => JSON.parse(readFileSync(`public/models/${name}`, 'utf8'));
  const farm = read('farm-collision.json');
  const data: CollisionData = { boxes: farm.boxes, surfaces: farm.surfaces, mesh: read('world-collision-mesh.json'), solid: read('solid-island-collision.json') };
  if (existsSync('public/models/farm-city-collision.json')) data.city = read('farm-city-collision.json');
  return data;
}
const DT = 1 / 60;
const run = (sim: FarmSimulation, steps: number) => { for (let i = 0; i < steps; i++) sim.step(DT); };
/** Sem `prepare()`: a colisão cai para caixas/triângulos, suficiente para os testes; a sala real prepara o índice de raios. */
async function make(seed: string): Promise<FarmSimulation> { return new FarmSimulation(seed, collision()); }

describe('simulação autoritativa da fazenda', () => {
  it('prepara o índice de raios em Node pelo caminho síncrono e continua andando com colisão por malha', async () => {
    const sim = new FarmSimulation('mesh', collision());
    await sim.prepare();
    const start = sim.addPlayer('a');
    sim.applyInput('a', { frame: { ...EMPTY_INPUT, z: 1 }, yaw: 0, pitch: 0, seq: 1 });
    run(sim, 60);
    expect(sim.snapshot().players[0]!.z).toBeGreaterThan(start.z + 3);
  }, 60_000);

  it('coloca dois jogadores no chão em frente ao celeiro e move só quem recebeu entrada', async () => {
    const sim = await make('coop-a');
    const a = sim.addPlayer('a'), b = sim.addPlayer('b');
    expect(a.y).toBeCloseTo(0, 1); expect(b.y).toBeCloseTo(0, 1);
    expect(Math.abs(a.x)).toBeLessThanOrEqual(2); expect(a.z).toBeLessThanOrEqual(-10);
    sim.applyInput('a', { frame: { ...EMPTY_INPUT, z: 1 }, yaw: 0, pitch: 0, seq: 1 });
    run(sim, 60);
    const snap = sim.snapshot();
    const pa = snap.players.find(p => p.id === 'a')!, pb = snap.players.find(p => p.id === 'b')!;
    expect(pa.z).toBeGreaterThan(a.z + 3);
    expect(pb.x).toBeCloseTo(b.x, 3); expect(pb.z).toBeCloseTo(b.z, 3);
    expect(snap.tick).toBe(0); // step() direto não passa pelo FixedLoop
  });

  it('descarta pacotes fora de ordem e mantém a última entrada válida', async () => {
    const sim = await make('coop-b');
    const start = sim.addPlayer('a');
    sim.applyInput('a', { frame: { ...EMPTY_INPUT, z: 1 }, yaw: 0, pitch: 0, seq: 5 });
    sim.applyInput('a', { frame: { ...EMPTY_INPUT, z: -1 }, yaw: 0, pitch: 0, seq: 3 }); // atrasado: ignorado
    run(sim, 30);
    expect(sim.snapshot().players[0]!.z).toBeGreaterThan(start.z);
    expect(sim.snapshot().players[0]!.seq).toBe(5);
  });

  it('gasta as 50 balas ao disparar, bloqueia durante a recarga e enche ao final', async () => {
    const sim = await make('coop-c');
    sim.addPlayer('a');
    sim.applyInput('a', { frame: { ...EMPTY_INPUT, fire: true }, yaw: 0, pitch: 0, seq: 1 });
    run(sim, 60 * 17); // 3,3 tiros/s × 17 s > 50
    let p = sim.snapshot().players[0]!;
    expect(p.ammo).toBe(0); expect(p.reloading).toBe(false);
    sim.applyInput('a', { frame: { ...EMPTY_INPUT, reload: true }, yaw: 0, pitch: 0, seq: 2 });
    run(sim, 1);
    expect(sim.snapshot().players[0]!.reloading).toBe(true);
    run(sim, Math.ceil(1.35 / DT) + 1);
    p = sim.snapshot().players[0]!;
    expect(p.reloading).toBe(false); expect(p.ammo).toBe(50);
  });

  it('carrega MP até o tier e dispara a timeline da skill no servidor sem pausar o mundo', async () => {
    const sim = await make('coop-d');
    sim.addPlayer('a'); sim.addPlayer('b');
    sim.applyInput('a', { frame: { ...EMPTY_INPUT, charging: true }, yaw: 0, pitch: 0, seq: 1 });
    run(sim, Math.ceil(.7 / DT));
    expect(sim.snapshot().players[0]!.mpTier).toBe(1);
    sim.applyInput('a', { frame: EMPTY_INPUT, yaw: 0, pitch: 0, seq: 2 });
    run(sim, 1);
    const p = sim.snapshot().players[0]!;
    expect(p.skillActive).toBe(true); expect(p.skillTier).toBe(1);
    // o outro jogador continua simulando enquanto a skill prepara (release da skill I aos 1,22 s de SKILL_CUES)
    sim.applyInput('b', { frame: { ...EMPTY_INPUT, z: 1 }, yaw: 0, pitch: 0, seq: 1 });
    const before = sim.snapshot().players[1]!.z;
    run(sim, Math.ceil(1.3 / DT));
    expect(sim.snapshot().players[1]!.z).toBeGreaterThan(before);
    const events = sim.drain().map(e => e.type);
    expect(events).toContain('MPCharged'); expect(events).toContain('MPReleased'); expect(events).toContain('SkillUsed');
  });

  it('é determinística por seed: mesmas entradas, mesmo snapshot', async () => {
    const script = (sim: FarmSimulation) => {
      sim.addPlayer('a'); sim.applyInput('a', { frame: { ...EMPTY_INPUT, x: 1, jump: true }, yaw: .4, pitch: 0, seq: 1 }); run(sim, 90);
      return sim.snapshot();
    };
    const x = script(await make('same-seed')), y = script(await make('same-seed'));
    expect(x.players[0]).toEqual(y.players[0]); expect(x.ferryTime).toBe(y.ferryTime);
    const z = script(await make('other-seed'));
    expect(z.players[0]!.x).not.toBe(x.players[0]!.x);
  });

  it('itens são por jogador: quem pegou as botas anda mais que quem não pegou', async () => {
    const sim = await make('loadout');
    const a = sim.addPlayer('a'), b = sim.addPlayer('b');
    // `boot` é +10% de caminhada. Com um `stats` único da sala, B andaria exatamente o mesmo que A.
    sim.players.get('a')!.loadout.addItem('boot');
    sim.applyInput('a', { frame: { ...EMPTY_INPUT, z: 1 }, yaw: 0, pitch: 0, seq: 1 });
    sim.applyInput('b', { frame: { ...EMPTY_INPUT, z: 1 }, yaw: 0, pitch: 0, seq: 1 });
    run(sim, 60);
    const snap = sim.snapshot();
    const da = snap.players.find(p => p.id === 'a')!.z - a.z, db = snap.players.find(p => p.id === 'b')!.z - b.z;
    expect(da).toBeGreaterThan(db * 1.05);
    expect(snap.players.find(p => p.id === 'a')!.inventory['boot']).toBe(1);
    expect(snap.players.find(p => p.id === 'b')!.inventory['boot']).toBeUndefined();
  });

  it('entityId é atribuído na entrada e não renumera quando alguém sai', async () => {
    const sim = await make('ids');
    expect(sim.addPlayer('a').entityId).toBe(1);
    expect(sim.addPlayer('b').entityId).toBe(2);
    expect(sim.addPlayer('c').entityId).toBe(3);
    sim.removePlayer('b');
    const ids = Object.fromEntries(sim.snapshot().players.map(p => [p.id, p.entityId]));
    expect(ids).toEqual({ a: 1, c: 3 });          // antes, C virava 2 ao recalcular pela ordem do mapa
    expect(sim.addPlayer('d').entityId).toBe(2);  // o buraco é reaproveitado, mantendo a faixa 1..4
  });

  it('avança a balsa uma vez por passo mesmo com vários jogadores', async () => {
    const sim = await make('ferry');
    sim.addPlayer('a'); sim.addPlayer('b'); sim.addPlayer('c');
    run(sim, 60);
    expect(sim.snapshot().ferryTime).toBeCloseTo(1, 5);
  });
});

it('recarrega no servidor sem bloquear corrida nem salto',async()=>{
 const sim=await make('reload-running');sim.addPlayer('a');
 sim.applyInput('a',{frame:{...EMPTY_INPUT,fire:true},yaw:0,pitch:0,seq:1});run(sim,20);
 sim.applyInput('a',{frame:{...EMPTY_INPUT,z:1,dodge:true},yaw:0,pitch:0,seq:2});run(sim,60);
 const before=sim.snapshot().players[0]!;
 sim.applyInput('a',{frame:{...EMPTY_INPUT,z:1,reload:true,jump:true,fire:true},yaw:0,pitch:0,seq:3});run(sim,30);
 const during=sim.snapshot().players[0]!;expect(during.reloading).toBe(true);expect(during.z-before.z).toBeGreaterThan(SPRINT_SPEED*.5*.9);expect(during.y-before.y).toBeGreaterThan(1);expect(during.ammo).toBe(before.ammo);
});

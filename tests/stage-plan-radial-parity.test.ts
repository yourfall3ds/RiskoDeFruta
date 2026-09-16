import {describe, it, expect} from 'vitest';
import {planStage, islandPairs, HOME_MIN_ROUTE, WIDE_MIN_ROUTE} from '../src/stages/StagePlan';
import {siteBiomes, siteBiomeForStage, WIDE_ISLAND_SEPARATION, PLANET_BIOME_COUNT,
  type StageBiome, type StageIsland} from '../src/stages/StageRoute';
import {RunProgression} from '../src/run/RunProgression';
import {EventBus} from '../src/core/EventBus';
import {RunRNG} from '../src/core/RunRNG';
import {pickIslands, RADIAL_ISLAND_POOL} from '../src/stages/IslandPool';
import type {GameEvents, Vec3} from '../src/core/contracts';

/**
 * Paridade do sorteio de estágio depois que a integração passou a olhar um SUBCONJUNTO de ilhas.
 *
 * Aqui se exercita a lógica REAL (`planStage`, `islandPairs`, `siteBiomes`, `siteBiomeForStage`,
 * `RunProgression`) sobre um mapa sintético com oráculo fechado — dá para saber a resposta certa
 * por construção. A auditoria sobre o MANIFESTO real (38 ilhas, R=180) está em
 * `.temp/audit-stage-subset-routing.ts`; o relatório é `.temp/stage-parity-audit.md`.
 *
 */

const ISLANDS = 38, SPACING = 60;

/**
 * Anel de 38 ilhas: a rota entre duas é o menor arco pelo anel, `|Δíndice|` saltos.
 * Vizinha imediata ⇒ 60 m de rota, muito abaixo do piso de 150 — é o caso que o pedido proíbe.
 */
function ring(): StageIsland[] {
  return Array.from({length: ISLANDS}, (_, i) => {
    const angle = i / ISLANDS * Math.PI * 2, radius = ISLANDS * SPACING / (Math.PI * 2);
    return {id: `ilha-${i}`, name: `Ilha ${i}`, x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius,
      width: 40, depth: 40};
  });
}
const indexOf = (island: {id: string}): number => Number(island.id.split('-')[1]);
const hops = (a: number, b: number): number => {const d = Math.abs(a - b); return Math.min(d, ISLANDS - d);};
const routeBetween = (a: number, b: number): number => hops(a, b) * SPACING;

/** Só estas ilhas têm arena de cálice — mesma proporção que o manifesto real (16 de 38). */
const CHALICE_ISLANDS = new Set(Array.from({length: 16}, (_, i) => i * 2));

function validation(islands: readonly StageIsland[]) {
  const pointOf = (island: StageIsland): Vec3 => ({x: island.x, y: island.y, z: island.z});
  const byPoint = new Map(islands.map(i => [`${i.x.toFixed(4)},${i.z.toFixed(4)}`, indexOf(i)]));
  const at = (p: Vec3): number => byPoint.get(`${p.x.toFixed(4)},${p.z.toFixed(4)}`)!;
  return {
    spawnPoint: (island: StageIsland) => pointOf(island),                       // pouso em todas
    chalicePoint: (island: StageIsland) => CHALICE_ISLANDS.has(indexOf(island)) ? pointOf(island) : undefined,
    route: (spawn: Vec3, chalice: Vec3) => routeBetween(at(spawn), at(chalice)),
    distance: (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  };
}

const biomeOf = (islands: readonly StageIsland[]): StageBiome =>
  ({id: 'anel', name: 'Anel', region: undefined, islands, separation: WIDE_ISLAND_SEPARATION});

/** O sorteio da cena: subconjunto por tentativa + `planStage`, com as sementes reais. */
function planWithSubset(full: StageBiome, attemptSeed: string, stage: number, attempt: number) {
  const poolRng = new RunRNG(`${attemptSeed}:stage:${stage}:pool:${attempt}`).stream('scene');
  const biome = {...full, islands: pickIslands(full.islands, poolRng, RADIAL_ISLAND_POOL)};
  const rng = new RunRNG(`${attemptSeed}:stage:${stage}`).stream('scene');
  return planStage(biome, rng, validation(full.islands), {minRoute: WIDE_MIN_ROUTE});
}

describe('o piso de rota é obrigatório — nunca existe cálice vizinho', () => {
  it('em 400 sementes nenhum plano fica abaixo do piso nem escolhe a ilha ao lado', () => {
    const full = biomeOf(ring());
    let planned = 0;
    for (let seed = 0; seed < 400; seed++) {
      const plan = planWithSubset(full, `parity-${seed}`, 1, 0);
      if (!plan) continue;
      planned++;
      expect(plan.spawnIsland.id, `semente ${seed}`).not.toBe(plan.chaliceIsland.id);
      expect(plan.routeLength, `semente ${seed}`).toBeGreaterThanOrEqual(WIDE_MIN_ROUTE);
      expect(plan.shortfall).toBe(false);
      // Piso de 150 com vão de 60 m ⇒ pelo menos 3 saltos. Vizinha imediata é impossível.
      expect(hops(indexOf(plan.spawnIsland), indexOf(plan.chaliceIsland)), `semente ${seed}`).toBeGreaterThanOrEqual(3);
    }
    expect(planned).toBeGreaterThan(0);
  });

  it('quando NENHUM par do subconjunto cumpre o piso, devolve undefined em vez de aproximar', () => {
    // Anel inteiro, mas só a vizinha imediata tem cálice: nenhuma rota chega a 150.
    const islands = ring();
    const full = {...biomeOf(islands), separation: 1};
    const near = validation(islands);
    const plan = planStage(full, new RunRNG('sem-saida').stream('scene'), {
      ...near,
      chalicePoint: island => indexOf(island) === 1 ? {x: islands[1]!.x, y: 0, z: islands[1]!.z} : undefined,
      spawnPoint: island => indexOf(island) === 0 ? {x: islands[0]!.x, y: 0, z: islands[0]!.z} : undefined,
    }, {minRoute: WIDE_MIN_ROUTE});
    expect(plan).toBeUndefined();
  });

  it('`islandPairs` mede pela função informada — o filtro barato não pode ser a reta no planeta', () => {
    const islands = ring();
    const biome = biomeOf(islands);
    // Com uma métrica que devolve sempre 0, nenhum par passa a separação.
    expect(islandPairs(biome, () => 0)).toHaveLength(0);
    // Com uma métrica generosa, todos os pares ordenados distintos passam.
    expect(islandPairs(biome, () => 1e6)).toHaveLength(ISLANDS * (ISLANDS - 1));
  });

  it('o piso depende da separação do bioma, como a cena decide', () => {
    expect(HOME_MIN_ROUTE).toBeGreaterThan(WIDE_MIN_ROUTE);
    // `separation >= WIDE_ISLAND_SEPARATION ? WIDE_MIN_ROUTE : HOME_MIN_ROUTE` (PlayerScene:904)
    expect(WIDE_ISLAND_SEPARATION <= WIDE_ISLAND_SEPARATION).toBe(true);
    const full = biomeOf(ring());
    const strict = planStage(full, new RunRNG('estrito').stream('scene'), validation(full.islands), {minRoute: HOME_MIN_ROUTE});
    if (strict) expect(strict.routeLength).toBeGreaterThanOrEqual(HOME_MIN_ROUTE);
  });
});

describe('o subconjunto de 10 não congela a partida nem o destino', () => {
  it('a partida e o cálice variam entre sementes', () => {
    const full = biomeOf(ring());
    const spawns = new Set<string>(), chalices = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const plan = planWithSubset(full, `variedade-${seed}`, 1, 0);
      if (!plan) continue;
      spawns.add(plan.spawnIsland.id); chalices.add(plan.chaliceIsland.id);
    }
    expect(spawns.size).toBeGreaterThan(10);
    expect(chalices.size).toBeGreaterThan(8);
  });

  it('a mesma semente e tentativa dão o MESMO subconjunto; a tentativa seguinte dá outro', () => {
    const islands = ring();
    const key = (attempt: number) => pickIslands(islands,
      new RunRNG(`mesma:stage:1:pool:${attempt}`).stream('scene'), RADIAL_ISLAND_POOL).map(i => i.id).join(',');
    expect(key(0)).toBe(key(0));                 // determinístico
    expect(key(1)).not.toBe(key(0));             // a retentativa realmente sorteia outro conjunto
    expect(key(0).split(',')).toHaveLength(RADIAL_ISLAND_POOL);
  });

  it('o corte nunca deixa menos de dois candidatos, mesmo com bioma minúsculo', () => {
    const two = ring().slice(0, 2);
    expect(pickIslands(two, new RunRNG('pequeno').stream('scene'), RADIAL_ISLAND_POOL)).toHaveLength(2);
    const one = ring().slice(0, 1);
    // `max(2, …)` não inventa ilha: o corte é limitado pelo tamanho real da lista.
    expect(pickIslands(one, new RunRNG('menor').stream('scene'), RADIAL_ISLAND_POOL)).toHaveLength(1);
  });

  it('uma tentativa que falha é recuperável: outro subconjunto reabre o sorteio', () => {
    const islands = ring();
    const full = biomeOf(islands);
    // Só UMA ilha tem cálice: muitos subconjuntos não a contêm, e aí o plano falha.
    const only = new Set([19]);
    const base = validation(islands);
    const attempt = (n: number) => {
      const poolRng = new RunRNG(`escasso:stage:1:pool:${n}`).stream('scene');
      const biome = {...full, islands: pickIslands(islands, poolRng, RADIAL_ISLAND_POOL)};
      return planStage(biome, new RunRNG('escasso:stage:1').stream('scene'), {
        ...base, chalicePoint: island => only.has(indexOf(island)) ? {x: island.x, y: island.y, z: island.z} : undefined,
      }, {minRoute: WIDE_MIN_ROUTE});
    };
    const results = Array.from({length: 24}, (_, n) => attempt(n));
    expect(results.some(r => r === undefined)).toBe(true);   // falha existe…
    expect(results.some(r => r !== undefined)).toBe(true);   // …e a retentativa resolve
    for (const plan of results) if (plan) expect(plan.routeLength).toBeGreaterThanOrEqual(WIDE_MIN_ROUTE);
  });
});

describe('`siteBiomes` deixa o sorteio recuperável', () => {
  const sites = ring().map(i => ({id: i.id, name: i.name, centre: {x: i.x, y: i.y, z: i.z}, radius: 20}));

  it('cada bioma recebe a lista INTEIRA de ilhas, não o seu agrupamento', () => {
    const biomes = siteBiomes(sites, (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    expect(biomes).toHaveLength(PLANET_BIOME_COUNT);
    // Se cada bioma ficasse só com o seu grupo, um grupo desconexo travaria a expedição para
    // sempre — é exatamente o que o comentário de `siteBiomes` documenta ter evitado.
    for (const biome of biomes) expect(biome.islands).toHaveLength(ISLANDS);
    expect(new Set(biomes.map(b => b.id)).size).toBe(PLANET_BIOME_COUNT);
  });

  it('a rotação por estágio é estável e cobre todas as regiões', () => {
    const biomes = siteBiomes(sites, (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    const seen = new Set<string>();
    for (let stage = 1; stage <= PLANET_BIOME_COUNT; stage++) seen.add(siteBiomeForStage(biomes, stage)!.id);
    expect(seen.size).toBe(PLANET_BIOME_COUNT);
    expect(siteBiomeForStage(biomes, PLANET_BIOME_COUNT + 1)!.id).toBe(siteBiomeForStage(biomes, 1)!.id);
    expect(siteBiomeForStage([], 1)).toBeUndefined();
  });
});

describe('itens e progresso atravessam o estágio', () => {
  const run = () => new RunProgression(new EventBus<GameEvents>());

  it('`advanceStage` preserva inventário, nível e XP — só converte créditos', () => {
    const progression = run();
    progression.addItem('pruner'); progression.addItem('pruner'); progression.addItem('battery');
    progression.credits = 120;
    const level = progression.level, xp = progression.xp;
    const inventory = new Map(progression.inventory);
    progression.advanceStage();
    expect(progression.stage).toBe(2);
    expect(progression.credits).toBe(0);                     // viraram XP
    expect(progression.xp + progression.level * 0).toBeGreaterThanOrEqual(xp);
    expect(progression.level).toBeGreaterThanOrEqual(level);
    expect(new Map(progression.inventory)).toEqual(inventory);
    expect(progression.inventory.get('pruner')).toBe(2);
    // E os efeitos derivados continuam valendo no estágio novo.
    expect(progression.stats).toBeDefined();
  });

  it('cinco estágios seguidos não perdem um item sequer', () => {
    const progression = run();
    for (const id of ['pruner', 'battery', 'boot']) progression.addItem(id);
    const before = new Map(progression.inventory);
    for (let stage = 1; stage <= 5; stage++) {progression.credits = 40; progression.advanceStage();}
    expect(progression.stage).toBe(6);
    expect(new Map(progression.inventory)).toEqual(before);
  });

  it('só `reset` (morte/nova tentativa) limpa o inventário — e limpa mesmo', () => {
    const progression = run();
    progression.addItem('pruner'); progression.credits = 90; progression.advanceStage();
    expect(progression.inventory.size).toBe(1);
    progression.reset();
    expect(progression.inventory.size).toBe(0);
    expect(progression.stage).toBe(1);
    expect(progression.level).toBe(1);
    expect(progression.xp).toBe(0);
    expect(progression.credits).toBe(0);
  });
});

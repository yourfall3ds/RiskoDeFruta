import {describe, expect, it} from 'vitest';
import type {DamageContext, GameEvents, Vec3} from '../src/core/contracts';
import {EventBus} from '../src/core/EventBus';
import {Health} from '../src/combat/Health';
import {MPCharge, MP_HIT_GAIN, awardsMP} from '../src/combat/MPCharge';
import {RunProgression} from '../src/run/RunProgression';
import {MonsterDirector, type EnemyKind} from '../src/run/MonsterDirector';
import {RunRNG} from '../src/core/RunRNG';
import {PLANET, PlanetFrame, cross, length, normalize, scale, sub} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {hitscan, lineOfSight, rayCapsule, tangentSpread, type HitCapsule} from '../src/planet-game/PlanetHitscan';
import {PlanetGraph} from '../src/planet-game/PlanetGraph';
import {PlanetObjective} from '../src/planet-game/PlanetObjective';
import {APPLICABLE_ITEMS, APPLICABLE_STATS, rollApplicableItem} from '../src/planet-game/PlanetItems';
import {probeSpawn, ringSamples, SPAWN_DEFAULTS} from '../src/planet-game/PlanetSpawn';
import type {PlanetManifest} from '../src/planet-game/PlanetManifest';

// ---------------------------------------------------------------- fixtures

const frame = new PlanetFrame(PLANET);

/** Base tangente estável de um ponto da superfície, usada por todos os fixtures deste arquivo. */
function basisOf(up: Vec3): {east: Vec3; north: Vec3} {
  const seed = Math.abs(up.y) < 0.9 ? {x: 0, y: 1, z: 0} : {x: 1, y: 0, z: 0};
  const east = normalize(cross(seed, up));
  return {east, north: cross(up, east)};
}

/** Retângulo horizontal na direção `up`, centrado em `centre`. */
function deck(centre: Vec3, up: Vec3, half: number): {positions: number[]; indices: number[]} {
  const {east, north} = basisOf(up);
  const corner = (a: number, b: number): number[] => [
    centre.x + east.x * a * half + north.x * b * half,
    centre.y + east.y * a * half + north.y * b * half,
    centre.z + east.z * a * half + north.z * b * half,
  ];
  return {
    positions: [...corner(-1, -1), ...corner(1, -1), ...corner(1, 1), ...corner(-1, 1)],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

/** Parede levantada em `up`, cruzando o eixo `east` a `offset` metros do centro. */
function wall(centre: Vec3, up: Vec3, offset: number, half: number, height: number): {positions: number[]; indices: number[]} {
  const {east, north} = basisOf(up);
  const base = {
    x: centre.x + east.x * offset, y: centre.y + east.y * offset, z: centre.z + east.z * offset,
  };
  const corner = (side: number, up01: number): number[] => [
    base.x + north.x * side * half + up.x * up01 * height,
    base.y + north.y * side * half + up.y * up01 * height,
    base.z + north.z * side * half + up.z * up01 * height,
  ];
  return {
    positions: [...corner(-1, 0), ...corner(1, 0), ...corner(1, 1), ...corner(-1, 1)],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

/** Ponto a `metres` ao longo do eixo `east` da base tangente, na altura `lift`. */
const eastOf = (centre: Vec3, up: Vec3, metres: number, lift = 0): Vec3 => {
  const {east} = basisOf(up);
  return {
    x: centre.x + east.x * metres + up.x * lift,
    y: centre.y + east.y * metres + up.y * lift,
    z: centre.z + east.z * metres + up.z * lift,
  };
};

function collisionOf(...parts: {positions: number[]; indices: number[]}[]): PlanetCollision {
  const positions: number[] = [], indices: number[] = [];
  for (const part of parts) {
    const base = positions.length / 3;
    positions.push(...part.positions);
    for (const index of part.indices) indices.push(index + base);
  }
  const collision = new PlanetCollision();
  collision.setGeometry(positions, indices);
  return collision;
}

const capsuleAt = (id: number, base: Vec3, up: Vec3): HitCapsule =>
  ({id, base, up, radius: 0.8, height: 1.9, alive: true});

/** Manifesto sintético com a topologia do contrato: 6 cardeais + 8 cantos, 24 pontes. */
function archipelago(radius = 200): PlanetManifest {
  const cardinals: Record<string, Vec3> = {
    east: {x: 1, y: 0, z: 0}, west: {x: -1, y: 0, z: 0},
    north: {x: 0, y: 1, z: 0}, south: {x: 0, y: -1, z: 0},
    front: {x: 0, y: 0, z: 1}, back: {x: 0, y: 0, z: -1},
  };
  const islands: PlanetManifest['islands'][number][] = [];
  const bridges: PlanetManifest['bridges'][number][] = [];
  const push = (id: string, up: Vec3): void => {
    const unit = normalize(up);
    const centre = scale(unit, radius);
    islands.push({id, name: id, up: unit, centre, spawn: centre, radius: 30, source: 'test'});
  };
  for (const [id, up] of Object.entries(cardinals)) push(id, up);
  let corner = 0;
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    const id = `junction-${corner++}`;
    const direction = normalize({x: sx, y: sy, z: sz});
    push(id, direction);
    for (const [cardinalId, up] of Object.entries(cardinals)) {
      if (up.x * direction.x + up.y * direction.y + up.z * direction.z <= 0.01) continue;
      const a = scale(direction, radius), b = scale(up, radius);
      bridges.push({
        id: `${id}~${cardinalId}`, a: id, b: cardinalId, width: 6,
        waypoints: [a, scale(normalize({x: a.x + b.x, y: a.y + b.y, z: a.z + b.z}), radius), b],
      });
    }
  }
  return {
    version: 1, centre: {x: 0, y: 0, z: 0}, radius,
    positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    islands, bridges,
  };
}

// ---------------------------------------------------------------- tiro: sem bala fantasma

describe('tiro no planeta', () => {
  const up: Vec3 = {x: 0, y: 1, z: 0};
  const centre: Vec3 = {x: 0, y: 200, z: 0};

  it('a cápsula do alvo é orientada pela vertical local, não pelo Y do mundo', () => {
    // Mesmo bicho na face de baixo: a cápsula cresce para −Y, e um tiro vindo de fora acerta.
    const under: Vec3 = {x: 0, y: -200, z: 0};
    const target = capsuleAt(1, under, {x: 0, y: -1, z: 0});
    const origin = {x: 12, y: -201, z: 0};
    const direction = normalize(sub({x: 0, y: -201, z: 0}, origin));
    expect(rayCapsule(origin, direction, 40, target)).toBeDefined();
    // O mesmo raio contra uma cápsula que crescesse para +Y (errada) erraria por completo.
    const wrong: HitCapsule = {...target, up: {x: 0, y: 1, z: 0}, base: {x: 0, y: -203, z: 0}};
    expect(rayCapsule(origin, direction, 40, wrong)).toBeUndefined();
  });

  it('parede entre o cano e o alvo cancela o dano — nada de bala fantasma', () => {
    const {east} = basisOf(up);
    const target = capsuleAt(7, eastOf(centre, up, 6), up);
    const open = collisionOf(deck(centre, up, 30));
    const blocked = collisionOf(deck(centre, up, 30), wall(centre, up, 3, 6, 4));
    const origin = eastOf(centre, up, 0, 1);
    expect(hitscan(open, origin, east, 60, [target]).target?.id).toBe(7);
    const shot = hitscan(blocked, origin, east, 60, [target]);
    expect(shot.target).toBeUndefined();
    expect(shot.distance).toBeLessThan(6);
  });

  it('alvo morto não é alvo', () => {
    const {east} = basisOf(up);
    const open = collisionOf(deck(centre, up, 30));
    const dead: HitCapsule = {...capsuleAt(7, eastOf(centre, up, 6), up), alive: false};
    expect(hitscan(open, eastOf(centre, up, 0, 1), east, 60, [dead]).target).toBeUndefined();
  });

  it('linha de visão recusa exatamente o que a parede bloqueia', () => {
    const blocked = collisionOf(deck(centre, up, 30), wall(centre, up, 3, 6, 4));
    const eye = eastOf(centre, up, 0, 1);
    expect(lineOfSight(blocked, eye, eastOf(centre, up, 6, 1))).toBe(false);
    expect(lineOfSight(blocked, eye, eastOf(centre, up, -6, 1))).toBe(true);
  });

  it('o leque do especial abre no plano tangente, em qualquer face do planeta', () => {
    for (const direction of [{x: 0, y: 1, z: 0}, {x: 0, y: -1, z: 0}, {x: 1, y: 0, z: 0}]) {
      const localUp = normalize(direction);
      const forward = normalize(cross(localUp, {x: 0.3, y: 0.5, z: 0.81}));
      const spread = tangentSpread(forward, localUp, 7, 0.9);
      expect(spread).toHaveLength(7);
      for (const ray of spread) {
        // Cada raio continua tangente: nenhum aponta para dentro ou para fora do planeta.
        expect(Math.abs(ray.x * localUp.x + ray.y * localUp.y + ray.z * localUp.z)).toBeLessThan(1e-9);
        expect(length(ray)).toBeCloseTo(1, 9);
      }
    }
  });
});

// ---------------------------------------------------------------- MP só em acerto confirmado

describe('MP só em acerto confirmado', () => {
  const context = (over: Partial<DamageContext> = {}): DamageContext => ({
    attackerId: 1, victimId: 9, sourceId: 'planet_pistols', attackId: 'planet_pistols',
    baseDamage: 12, finalDamage: 12, crit: false, procCoefficient: 1, procChainDepth: 0,
    damageTags: ['bullet'],
    hitPosition: {x: 0, y: 0, z: 0}, hitNormal: {x: 0, y: 1, z: 0},
    forceDirection: {x: 0, y: 0, z: 1}, forceMagnitude: 2,
    ...over,
  });

  it('a vida do alvo é quem paga o MP, não a intenção de dano', () => {
    const events = new EventBus<GameEvents>();
    const mp = new MPCharge(events);
    mp.current = 0;
    // `DamageDealt` sozinho — o que o disparo emite ANTES de saber se a vida aceitou — não paga.
    events.emit('DamageDealt', context());
    expect(mp.current).toBe(0);
    // Agora com vida real: `Health.apply` emite `EnemyHit` DEPOIS de subtrair.
    const health = new Health(9, 50, events);
    expect(health.apply(context())).toBe(true);
    expect(mp.current).toBe(MP_HIT_GAIN);
  });

  it('cadáver e dano recusado não pagam', () => {
    const events = new EventBus<GameEvents>();
    const mp = new MPCharge(events);
    mp.current = 0;
    const health = new Health(9, 10, events);
    health.apply(context({finalDamage: 10}));
    const afterKill = mp.current;
    expect(afterKill).toBe(MP_HIT_GAIN);
    // Alvo já morto: `apply` recusa e nada é emitido.
    expect(health.apply(context())).toBe(false);
    expect(mp.current).toBe(afterKill);
  });

  it('o especial não se realimenta: dano marcado como `skill` não paga MP', () => {
    expect(awardsMP(context())).toBe(true);
    expect(awardsMP(context({damageTags: ['bullet', 'skill']}))).toBe(false);
    const events = new EventBus<GameEvents>();
    const mp = new MPCharge(events);
    mp.current = 0;
    new Health(9, 500, events).apply(context({damageTags: ['bullet', 'skill']}));
    expect(mp.current).toBe(0);
  });

  it('o teto da janela de 1 s limita a rajada', () => {
    const events = new EventBus<GameEvents>();
    const mp = new MPCharge(events);
    mp.current = 0;
    const health = new Health(9, 5000, events);
    for (let i = 0; i < 12; i++) health.apply(context({finalDamage: 1}));
    expect(mp.current).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------- porta do suco e do chefe

describe('cálice, horda final e chefe', () => {
  const manifest = archipelago();
  const graph = new PlanetGraph(manifest);

  const plant = (): {objective: PlanetObjective; at: Vec3} => {
    const positions: number[] = [], indices: number[] = [];
    for (const island of manifest.islands) {
      const part = deck(island.centre, island.up, 18);
      const base = positions.length / 3;
      positions.push(...part.positions);
      for (const index of part.indices) indices.push(index + base);
    }
    const collision = new PlanetCollision();
    collision.setGeometry(positions, indices);
    const objective = new PlanetObjective(frame, graph);
    const site = objective.plan(collision, graph.island('north')!);
    expect(site).toBeDefined();
    return {objective, at: site!.position};
  };

  it('o `E` desperta a horda; não pula direto para recolher', () => {
    const {objective, at} = plant();
    objective.update(at);
    expect(objective.phase).toBe('ativo');
    expect(objective.activate(at)).toBe('horda');
    expect(objective.hordeActive).toBe(true);
    // Um segundo `E` durante a horda não recolhe nada: o cálice está vazio e o chefe está vivo.
    expect(objective.activate(at)).toBeUndefined();
    expect(objective.phase).toBe('horda');
  });

  it('só suco cheio NÃO abre a coleta; só chefe morto também não', () => {
    const {objective, at} = plant();
    objective.update(at);
    objective.activate(at);
    for (let i = 0; i < 200; i++) objective.registerKill('watermelon');
    expect(objective.juice).toBe(objective.juiceTarget);
    objective.update(at);
    expect(objective.phase).toBe('horda');
    expect(objective.activate(at)).toBeUndefined();

    const second = plant();
    second.objective.update(second.at);
    second.objective.activate(second.at);
    second.objective.registerBossDefeat();
    second.objective.update(second.at);
    expect(second.objective.phase).toBe('horda');
  });

  it('suco cheio E chefe morto abrem a coleta, e o `E` fecha o estágio', () => {
    const {objective, at} = plant();
    objective.update(at);
    objective.activate(at);
    for (let i = 0; i < 200; i++) objective.registerKill('eggplant');
    objective.registerBossDefeat();
    expect(objective.update(at)).toBe(true);
    expect(objective.phase).toBe('pronto');
    expect(objective.activate(at)).toBe('recolhido');
    expect(objective.complete).toBe(true);
  });

  it('abate fora da horda não enche o cálice', () => {
    const {objective, at} = plant();
    expect(objective.registerKill('watermelon')).toBe(0);
    expect(objective.juice).toBe(0);
    objective.update(at);
    objective.activate(at);
    expect(objective.registerKill('watermelon')).toBeGreaterThan(0);
  });

  it('o `E` longe do cálice não faz nada', () => {
    const {objective, at} = plant();
    objective.update(at);
    const far = {x: at.x + 30, y: at.y, z: at.z};
    expect(objective.activate(far)).toBeUndefined();
    expect(objective.phase).not.toBe('horda');
  });
});

// ---------------------------------------------------------------- itens entre estágios

describe('itens e progressão entre ilhas', () => {
  it('o sorteio só entrega itens cujo atributo esta cena aplica', () => {
    expect(APPLICABLE_ITEMS.length).toBeGreaterThan(10);
    for (const item of APPLICABLE_ITEMS) {
      expect(item.stat).toBeDefined();
      expect(APPLICABLE_STATS).toContain(item.stat!);
      expect(item.hook).toBeUndefined();
    }
    // Atributos que nenhum sistema desta cena lê ficam fora — nada de item decorativo.
    for (const excluded of ['moveSpeed', 'sprintSpeed', 'jump', 'extraJumps', 'dodgeRecharge', 'skillCharges']) {
      expect(APPLICABLE_ITEMS.some(item => item.stat === excluded)).toBe(false);
    }
    let random = 0;
    for (let i = 0; i < 200; i++) {
      random = (random + 0.017) % 1;
      const item = rollApplicableItem(() => random);
      expect(APPLICABLE_ITEMS).toContain(item);
    }
  });

  it('trocar de ilha preserva inventário, nível e poder; a morte reinicia', () => {
    const events = new EventBus<GameEvents>();
    const progression = new RunProgression(events);
    progression.addItem('pruner');
    progression.addItem('pruner');
    progression.addItem('belt');
    const damage = progression.stats.damage, armor = progression.stats.armor;
    expect(damage).toBeGreaterThan(1);
    expect(armor).toBe(20);
    progression.credits = 120;

    progression.advanceStage();
    expect(progression.stage).toBe(2);
    expect(progression.inventory.get('pruner')).toBe(2);
    expect(progression.stats.damage).toBeGreaterThanOrEqual(damage);
    expect(progression.stats.armor).toBe(armor);
    // Os créditos viram XP na viagem — é o contrato de `advanceStage`, não uma perda silenciosa.
    expect(progression.credits).toBe(0);
    expect(progression.level).toBeGreaterThan(1);

    progression.reset();
    expect(progression.stage).toBe(1);
    expect(progression.level).toBe(1);
    expect(progression.inventory.size).toBe(0);
    expect(progression.stats.armor).toBe(0);
  });
});

// ---------------------------------------------------------------- nascimento seguro de hostis

describe('nascimento de hostis', () => {
  const up: Vec3 = {x: 0, y: 1, z: 0};
  const centre: Vec3 = {x: 0, y: 200, z: 0};

  it('o anel fica entre as distâncias pedidas e no plano tangente', () => {
    let seed = 0.123;
    const random = (): number => (seed = (seed * 9301 + 49297) % 233280 / 233280);
    const player = {x: 0, y: 200.4, z: 0};
    for (const point of ringSamples(frame, player, random, 16, 34, 40)) {
      const arc = frame.arcDistance(player, point);
      expect(arc).toBeGreaterThanOrEqual(15.9);
      expect(arc).toBeLessThanOrEqual(34.1);
      // O passo geodésico conserva o raio: o hostil não nasce acima nem dentro do convés.
      expect(frame.radius(point)).toBeCloseTo(frame.radius(player), 6);
    }
  });

  it('candidato fora do convés é recusado; sobre o convés é aceito com apoio medido', () => {
    const collision = collisionOf(deck(centre, up, 24));
    const options = {...SPAWN_DEFAULTS, height: 1.8, requirePlatform: false, above: 3, below: 8};
    // 10 m do centro: dentro do convés de 24 m de meia-largura.
    expect(probeSpawn(collision, frame, {x: 10, y: 200.4, z: 0}, options)).toBeDefined();
    // 40 m: fora. Sem apoio, sem nascimento — nunca um bicho no ar.
    expect(probeSpawn(collision, frame, {x: 40, y: 200.4, z: 0}, options)).toBeUndefined();
  });

  it('nenhum candidato do anel é aceito quando a ilha é pequena demais', () => {
    const collision = collisionOf(deck(centre, up, 4));
    const options = {...SPAWN_DEFAULTS, height: 1.8, requirePlatform: false, above: 3, below: 8};
    let seed = 0.77;
    const random = (): number => (seed = (seed * 9301 + 49297) % 233280 / 233280);
    let accepted = 0;
    for (const point of ringSamples(frame, {x: 0, y: 200.4, z: 0}, random, 16, 34, 60)) {
      if (probeSpawn(collision, frame, point, options)) accepted++;
    }
    expect(accepted).toBe(0);
  });
});

// ---------------------------------------------------------------- abertura do diretor

describe('abertura do diretor', () => {
  it('a expedição abre com poucos hostis e só cresce com a pressão da horda', () => {
    const director = new MonsterDirector(new RunRNG('planeta').stream('director'), 1, 24, 'expedition');
    let population = 0;
    const spawn = (_kind: EnemyKind): boolean => {population++; return true;};
    // Primeiros 30 s de exploração.
    for (let i = 0; i < 30 * 60; i++) director.update(1 / 60, 0, population, spawn, 24);
    expect(population).toBeLessThanOrEqual(3);

    // A horda final sobe a pressão; o teto cresce, mas dentro do limite pedido.
    director.pressure = 1;
    director.pressureCap = 5;
    for (let i = 0; i < 60 * 60; i++) director.update(1 / 60, 0, population, spawn, 24);
    expect(population).toBeGreaterThan(3);
    expect(population).toBeLessThanOrEqual(13);
  });
});

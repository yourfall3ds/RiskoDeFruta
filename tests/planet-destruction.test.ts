import {describe, expect, it} from 'vitest';
import type {GameEvents, Vec3} from '../src/core/contracts';
import {EventBus} from '../src/core/EventBus';
import {Health} from '../src/combat/Health';
import {MPCharge} from '../src/combat/MPCharge';
import {PLANET, PlanetFrame, cross, normalize} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {hitscan, lineOfSight, type HitCapsule} from '../src/planet-game/PlanetHitscan';
import {
  NO_DESTRUCTION, PlanetDestructionLedger, destructionHit,
  type DestructionHit, type DestructionOutcome, type DestructionPort,
} from '../src/planet-game/PlanetDestruction';
import {
  DestructionSystem, materialDestructionAudio, parseDestructibles, profileOf,
} from '../src/destruction';
import {parsePlanetManifest} from '../src/planet-game/PlanetManifest';

const frame = new PlanetFrame(PLANET);
const UP: Vec3 = {x: 0, y: 1, z: 0};
const CENTRE: Vec3 = {x: 0, y: 200, z: 0};

function basisOf(up: Vec3): {east: Vec3; north: Vec3} {
  const seed = Math.abs(up.y) < 0.9 ? {x: 0, y: 1, z: 0} : {x: 1, y: 0, z: 0};
  const east = normalize(cross(seed, up));
  return {east, north: cross(up, east)};
}

const quad = (corners: number[][]): {positions: number[]; indices: number[]} =>
  ({positions: corners.flat(), indices: [0, 1, 2, 0, 2, 3]});

/** Convés: triângulos 0 e 1. */
function deck(centre: Vec3, up: Vec3, half: number): {positions: number[]; indices: number[]} {
  const {east, north} = basisOf(up);
  const at = (a: number, b: number): number[] => [
    centre.x + east.x * a * half + north.x * b * half,
    centre.y + east.y * a * half + north.y * b * half,
    centre.z + east.z * a * half + north.z * b * half,
  ];
  return quad([at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)]);
}

/** Caixa (parede) cruzando o eixo leste: triângulos 2 e 3 depois do convés. */
function crate(centre: Vec3, up: Vec3, offset: number, half: number, height: number): {positions: number[]; indices: number[]} {
  const {east, north} = basisOf(up);
  const base = {x: centre.x + east.x * offset, y: centre.y + east.y * offset, z: centre.z + east.z * offset};
  const at = (side: number, lift: number): number[] => [
    base.x + north.x * side * half + up.x * lift * height,
    base.y + north.y * side * half + up.y * lift * height,
    base.z + north.z * side * half + up.z * lift * height,
  ];
  return quad([at(-1, 0), at(1, 0), at(1, 1), at(-1, 1)]);
}

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

const eastOf = (metres: number, lift = 0): Vec3 => {
  const {east} = basisOf(UP);
  return {
    x: CENTRE.x + east.x * metres + UP.x * lift,
    y: CENTRE.y + east.y * metres + UP.y * lift,
    z: CENTRE.z + east.z * metres + UP.z * lift,
  };
};

/** Fachada falsa: quebra ao acumular dano, e diz exatamente quantos triângulos removeu. */
function fakeSystem(collision: {disableTriangles(start: number, count: number): number},
  range: {start: number; count: number}, threshold = 30): DestructionPort & {damage: number; updates: number} {
  let damage = 0, broke = false;
  const port = {
    damage: 0, updates: 0,
    hit(hit: DestructionHit): DestructionOutcome | undefined {
      if (hit.triangle === undefined) return undefined;
      if (hit.triangle < range.start || hit.triangle >= range.start + range.count) return undefined;
      if (broke) return undefined;
      damage += hit.damage; port.damage = damage;
      const fraction = Math.min(1, damage / threshold);
      if (fraction < 1) {
        return {id: 'crate-1', kind: 'crate', broke: false, stage: Math.floor(fraction * 3), fraction, felled: [], removedTriangles: 0};
      }
      broke = true;
      const removed = collision.disableTriangles(range.start, range.count);
      return {id: 'crate-1', kind: 'crate', broke: true, stage: 3, fraction: 1, felled: [], removedTriangles: removed};
    },
    update(_dt: number) {port.updates++;},
    reset() {damage = 0; broke = false; port.damage = 0;},
  };
  return port;
}

// ---------------------------------------------------------------- hitscan leva o triângulo

describe('o tiro sabe qual triângulo acertou', () => {
  it('acerto no mundo traz o índice; acerto em ator e erro não trazem', () => {
    const collision = collisionOf(deck(CENTRE, UP, 30), crate(CENTRE, UP, 6, 2, 3));
    const {east} = basisOf(UP);
    const eye = eastOf(0, 1);

    const wall = hitscan(collision, eye, east, 60, []);
    expect(wall.target).toBeUndefined();
    expect(wall.triangle).toBeDefined();
    // O convés ocupa 0 e 1; a caixa é o bloco contíguo seguinte — é isso que o manifesto declara.
    expect(wall.triangle).toBeGreaterThanOrEqual(2);
    expect(wall.triangle).toBeLessThan(4);

    const actor: HitCapsule = {id: 9, base: eastOf(3), up: UP, radius: 0.8, height: 1.9, alive: true};
    const onActor = hitscan(collision, eye, east, 60, [actor]);
    expect(onActor.target?.id).toBe(9);
    expect(onActor.triangle).toBeUndefined();

    const sky = hitscan(collision, eastOf(0, 40), UP, 60, []);
    expect(sky.missed).toBe(true);
    expect(sky.triangle).toBeUndefined();
  });
});

// ------------------------------------------------- colisão some de verdade quando o corpo quebra

describe('cenário quebrado sai da colisão', () => {
  const rangeOfCrate = {start: 2, count: 2};

  it('antes de quebrar a caixa barra; depois o tiro e a linha de visão passam', () => {
    const collision = collisionOf(deck(CENTRE, UP, 30), crate(CENTRE, UP, 6, 2, 3));
    const {east} = basisOf(UP);
    const eye = eastOf(0, 1), behind = eastOf(12, 1);
    const target: HitCapsule = {id: 5, base: eastOf(12), up: UP, radius: 0.8, height: 1.9, alive: true};

    expect(lineOfSight(collision, eye, behind)).toBe(false);
    expect(hitscan(collision, eye, east, 60, [target]).target).toBeUndefined();

    const ledger = new PlanetDestructionLedger(collision);
    const system = fakeSystem(ledger.collisionPort(), rangeOfCrate);
    let outcome: DestructionOutcome | undefined;
    for (let shot = 0; shot < 4 && !outcome?.broke; shot++) {
      const hit = hitscan(collision, eye, east, 60, []);
      outcome = ledger.record(system.hit(destructionHit(hit.point, east, 12, hit.triangle, hit.normal)));
    }
    expect(outcome?.broke).toBe(true);
    expect(outcome!.removedTriangles).toBe(2);

    // O corpo sumiu da tela E do caminho: é o invariante "nunca colisão invisível".
    expect(lineOfSight(collision, eye, behind)).toBe(true);
    expect(hitscan(collision, eye, east, 60, [target]).target?.id).toBe(5);
    expect(ledger.defects).toEqual([]);
  });

  it('o apoio sob o corpo destruído também some, e volta no reinício', () => {
    // Uma plataforma solta ACIMA do convés: enquanto existe, sustenta; destruída, não sustenta.
    const platform = deck(eastOf(0, 4), UP, 3);
    const collision = collisionOf(deck(CENTRE, UP, 30), platform);
    const above = eastOf(0, 6);
    expect(collision.supportBelow(above, UP, 0.5, 4)?.point.y).toBeCloseTo(204, 3);

    const ledger = new PlanetDestructionLedger(collision);
    const port = ledger.collisionPort();
    expect(port.disableTriangles(2, 2)).toBe(2);
    const afterBreak = collision.supportBelow(above, UP, 0.5, 4);
    expect(afterBreak === undefined || afterBreak.point.y < 202).toBe(true);

    ledger.restore();
    expect(collision.supportBelow(above, UP, 0.5, 4)?.point.y).toBeCloseTo(204, 3);
    expect(ledger.ranges).toEqual([]);
  });

  it('quebrar sem remover triângulo é acusado como defeito', () => {
    const ledger = new PlanetDestructionLedger(undefined);
    ledger.record({id: 'barril-7', kind: 'barrel', broke: true, stage: 3, fraction: 1, felled: [], removedTriangles: 0});
    expect(ledger.defects).toEqual(['barril-7']);
    expect(ledger.readout()).toMatch(/DEFEITO/);
    // O mesmo prop não entra duas vezes na lista.
    ledger.record({id: 'barril-7', kind: 'barrel', broke: true, stage: 3, fraction: 1, felled: [], removedTriangles: 0});
    expect(ledger.defects).toHaveLength(1);
  });

  it('os intervalos removidos ficam disponíveis e ordenados — é o que a navegação precisaria', () => {
    const collision = collisionOf(deck(CENTRE, UP, 30), crate(CENTRE, UP, 6, 2, 3), crate(CENTRE, UP, -6, 2, 3));
    const ledger = new PlanetDestructionLedger(collision);
    const port = ledger.collisionPort();
    port.disableTriangles(4, 2);
    port.disableTriangles(2, 2);
    // Repetir o mesmo intervalo não infla a conta: a fachada pode chamar por componente e por pai.
    port.disableTriangles(2, 2);
    expect(ledger.ranges).toEqual([{start: 2, count: 2}, {start: 4, count: 2}]);
    expect(ledger.disabledProps).toBe(2);
  });
});

// ------------------------------------------------- a navegação envelhecida erra para o lado seguro

describe('cópia da navegação fica velha, mas erra de forma conservadora', () => {
  it('destruir só REMOVE colisão: nada que era passável deixa de ser', () => {
    // Duas caixas. A navegação (que não é avisada) enxerga as duas para sempre.
    const collision = collisionOf(
      deck(CENTRE, UP, 30),
      crate(CENTRE, UP, 6, 2, 3),
      crate(CENTRE, UP, -6, 2, 3),
    );
    const eye = eastOf(0, 1);
    const westBehind = eastOf(-12, 1), eastBehind = eastOf(12, 1);
    // Antes: as duas barram.
    expect(lineOfSight(collision, eye, eastBehind)).toBe(false);
    expect(lineOfSight(collision, eye, westBehind)).toBe(false);

    const ledger = new PlanetDestructionLedger(collision);
    ledger.collisionPort().disableTriangles(2, 2);

    // Depois: a caixa destruída abriu passagem; a outra continua exatamente como estava.
    expect(lineOfSight(collision, eye, eastBehind)).toBe(true);
    expect(lineOfSight(collision, eye, westBehind)).toBe(false);
    // Nenhum obstáculo NOVO apareceu — é isto que torna a rota velha apenas mais longa, nunca
    // uma rota por cima de um buraco.
    expect(ledger.ranges).toEqual([{start: 2, count: 2}]);
  });
});

// ---------------------------------------------------------------- MP só de inimigo

describe('cenário não paga MP', () => {
  it('destruir caixa não move a barra; acertar praga move', () => {
    const events = new EventBus<GameEvents>();
    const mp = new MPCharge(events);
    mp.current = 0;

    const collision = collisionOf(deck(CENTRE, UP, 30), crate(CENTRE, UP, 6, 2, 3));
    const ledger = new PlanetDestructionLedger(collision);
    const system = fakeSystem(ledger.collisionPort(), {start: 2, count: 2});
    const {east} = basisOf(UP);
    const eye = eastOf(0, 1);
    for (let shot = 0; shot < 4; shot++) {
      const hit = hitscan(collision, eye, east, 60, []);
      if (hit.triangle === undefined) break;
      ledger.record(system.hit(destructionHit(hit.point, east, 12, hit.triangle, hit.normal)));
    }
    // A caixa levou dano e quebrou, e a barra não subiu um ponto: nada aqui passa por `Health`.
    expect(system.damage).toBeGreaterThan(0);
    expect(ledger.breaks).toBe(1);
    expect(mp.current).toBe(0);

    // Para contraste: o mesmo dano numa praga, pela vida, paga.
    new Health(9, 100, events).apply({
      attackerId: 1, victimId: 9, sourceId: 'planet_pistols', attackId: 'planet_pistols',
      baseDamage: 12, finalDamage: 12, crit: false, procCoefficient: 1, procChainDepth: 0,
      damageTags: ['bullet'], hitPosition: eye, hitNormal: UP,
      forceDirection: east, forceMagnitude: 2,
    });
    expect(mp.current).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- manifesto versão 2

describe('manifesto com cenário quebrável', () => {
  const base = (): Record<string, unknown> => ({
    version: 2, centre: {x: 0, y: 0, z: 0}, radius: 180,
    positions: [0, 180, 0, 5, 180, 0, 0, 180, 5, 5, 180, 5],
    indices: [0, 1, 2, 1, 3, 2],
    islands: [{id: 'a', name: 'A', up: {x: 0, y: 1, z: 0}, centre: {x: 0, y: 180, z: 0},
      spawn: {x: 0, y: 180, z: 0}, radius: 30, source: 'test'}],
    bridges: [],
  });

  it('versão 1 sem a chave continua válida — ausência não é erro', () => {
    const data = base(); data.version = 1; delete data.destructibles;
    const manifest = parsePlanetManifest(data);
    expect(manifest.destructibles).toBeUndefined();
    expect(parseDestructibles(manifest.destructibles).records).toEqual([]);
  });

  it('versão 2 entrega a lista crua, e quem valida é o subsistema', () => {
    const data = base();
    data.destructibles = [{
      id: 'crate-1', nodeName: 'Crate_01', kind: 'crate',
      centre: {x: 0, y: 180, z: 0}, extents: {x: 0.5, y: 0.5, z: 0.5},
      triangleStart: 0, triangleCount: 1,
    }];
    const manifest = parsePlanetManifest(data);
    const parsed = parseDestructibles(manifest.destructibles, {
      centre: manifest.centre, triangleTotal: manifest.indices.length / 3,
    });
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]!.id).toBe('crate-1');
    expect(parsed.warnings).toEqual([]);
  });

  it('registro ruim é recusado sem derrubar o mapa', () => {
    const data = base();
    data.destructibles = [
      {id: 'bom', nodeName: 'A', kind: 'crate', centre: {x: 0, y: 180, z: 0},
        extents: {x: 0.5, y: 0.5, z: 0.5}, triangleStart: 0, triangleCount: 1},
      {id: 'fora-do-buffer', nodeName: 'B', kind: 'crate', centre: {x: 0, y: 180, z: 0},
        extents: {x: 0.5, y: 0.5, z: 0.5}, triangleStart: 900, triangleCount: 40},
    ];
    const manifest = parsePlanetManifest(data);
    const parsed = parseDestructibles(manifest.destructibles, {
      centre: manifest.centre, triangleTotal: manifest.indices.length / 3,
    });
    expect(parsed.records.map(record => record.id)).toEqual(['bom']);
    expect(parsed.warnings.length).toBeGreaterThan(0);
    // O planeta em si continua carregado e jogável.
    expect(manifest.islands).toHaveLength(1);
    expect(frame.radius({x: 0, y: 180, z: 0})).toBeCloseTo(180, 9);
  });
});

// ---------------------------------------------------------------- fachada REAL

describe('fachada real do subsistema, com colisão real', () => {
  const record = {
    id: 'crate-1', nodeName: 'Crate_01', kind: 'crate',
    centre: eastOf(6, 1.5), extents: {x: 2, y: 1.5, z: 2},
    triangleStart: 2, triangleCount: 2,
  };

  /** Sistema de verdade, com a colisão de verdade e o ledger no meio. */
  const build = (): {collision: PlanetCollision; ledger: PlanetDestructionLedger; system: DestructionSystem; foley: string[]} => {
    const collision = collisionOf(deck(CENTRE, UP, 30), crate(CENTRE, UP, 6, 2, 3));
    const ledger = new PlanetDestructionLedger(collision);
    const foley: string[] = [];
    const system = new DestructionSystem({
      collision: ledger.collisionPort(),
      // O MESMO adaptador que a cena usa, com um duplo do `WeaponAudio`.
      audio: materialDestructionAudio({
        footstep: (surface, speed) => foley.push(`step:${surface}:${(speed ?? 1).toFixed(2)}`),
        impact: heavy => foley.push(`impact:${heavy ? 'heavy' : 'light'}`),
      }),
    });
    const parsed = parseDestructibles([record], {centre: {x: 0, y: 0, z: 0}, triangleTotal: 4});
    expect(parsed.warnings).toEqual([]);
    system.register(parsed.records);
    expect(system.registered).toBe(1);
    return {collision, ledger, system, foley};
  };

  it('tiros reais gastam a vida, quebram e tiram a caixa do caminho', () => {
    const {collision, ledger, system, foley} = build();
    const {east} = basisOf(UP);
    const eye = eastOf(0, 1);
    const behind = eastOf(12, 1);
    expect(lineOfSight(collision, eye, behind)).toBe(false);

    const profile = profileOf('crate');
    let broke = false, shots = 0;
    for (; shots < 20 && !broke; shots++) {
      const shot = hitscan(collision, eye, east, 60, []);
      if (shot.triangle === undefined) break;
      const outcome = ledger.record(system.hit(
        destructionHit(shot.point, east, 12, shot.triangle, shot.normal)));
      expect(outcome).toBeDefined();
      broke = outcome!.broke;
      // A vida do estado é a mesma que o inspetor do F2 mostra.
      const state = system.field.get('crate-1')!;
      expect(state.health).toBeLessThan(profile.health);
    }
    expect(broke).toBe(true);
    // 36 de vida / 12 por tiro: três tiros. Se o perfil mudar, isto acusa.
    expect(shots).toBe(Math.ceil(profile.health / 12));
    expect(system.broken).toBe(1);
    expect(system.removedTriangles).toBe(2);
    expect(ledger.defects).toEqual([]);

    // O invariante: quebrou na tela, sumiu do caminho.
    expect(lineOfSight(collision, eye, behind)).toBe(true);
    expect(ledger.ranges).toEqual([{start: 2, count: 2}]);
    // E soou como madeira, pelo banco existente — sem arquivo de áudio novo.
    expect(foley.some(entry => entry.startsWith('step:wood'))).toBe(true);
    expect(foley.at(-1)).toBe('impact:light');
  });

  it('a caixa já quebrada não absorve mais tiro nem remove mais nada', () => {
    const {collision, ledger, system} = build();
    const {east} = basisOf(UP);
    const eye = eastOf(0, 1);
    for (let i = 0; i < 4; i++) {
      const shot = hitscan(collision, eye, east, 60, []);
      if (shot.triangle === undefined) break;
      ledger.record(system.hit(destructionHit(shot.point, east, 12, shot.triangle, shot.normal)));
    }
    const removed = system.removedTriangles, breaks = ledger.breaks;
    // Agora o raio passa direto: não há mais triângulo do prop para acertar.
    const after = hitscan(collision, eye, east, 60, []);
    expect(after.missed || after.triangle === undefined || after.triangle < 2).toBe(true);
    expect(system.removedTriangles).toBe(removed);
    expect(ledger.breaks).toBe(breaks);
  });

  it('`resetAttempt` + ledger devolvem a caixa inteira e no caminho', () => {
    const {collision, ledger, system} = build();
    const {east} = basisOf(UP);
    const eye = eastOf(0, 1), behind = eastOf(12, 1);
    for (let i = 0; i < 4; i++) {
      const shot = hitscan(collision, eye, east, 60, []);
      if (shot.triangle === undefined) break;
      ledger.record(system.hit(destructionHit(shot.point, east, 12, shot.triangle, shot.normal)));
    }
    expect(lineOfSight(collision, eye, behind)).toBe(true);

    // Mesma ordem da cena: colisão primeiro, fachada depois.
    ledger.restore();
    system.resetAttempt();
    expect(lineOfSight(collision, eye, behind)).toBe(false);
    expect(system.field.get('crate-1')!.health).toBe(profileOf('crate').health);
    expect(system.field.get('crate-1')!.broken).toBe(false);
    expect(ledger.ranges).toEqual([]);
  });

  it('acerto fora de qualquer prop não vira destruição', () => {
    const {ledger, system} = build();
    // Triângulo 0 é convés, não prop.
    const outcome = ledger.record(system.hit(destructionHit(CENTRE, UP, 12, 0, UP)));
    expect(outcome).toBeUndefined();
    expect(system.broken).toBe(0);
    expect(ledger.hits).toBe(0);
  });

  it('a área do especial também quebra, pelo mesmo caminho', () => {
    const {collision, ledger, system} = build();
    const eye = eastOf(0, 1), behind = eastOf(12, 1);
    const outcomes = system.splash(eastOf(6, 1.5), 5, profileOf('crate').health);
    for (const outcome of outcomes) ledger.record(outcome);
    expect(outcomes.some(outcome => outcome.broke)).toBe(true);
    expect(lineOfSight(collision, eye, behind)).toBe(true);
  });
});

// ---------------------------------------------------------------- sem destruição instalada

describe('sem destruição o tiro não muda', () => {
  it('a porta nula nunca reclama de acerto nenhum', () => {
    expect(NO_DESTRUCTION.hit(destructionHit({x: 0, y: 0, z: 0}, UP, 10, 3, UP))).toBeUndefined();
    expect(() => {NO_DESTRUCTION.update(1 / 60); NO_DESTRUCTION.reset();}).not.toThrow();
  });

  it('o acerto só carrega os campos que existem', () => {
    const bare = destructionHit({x: 1, y: 2, z: 3}, UP, 7, undefined, undefined);
    expect('triangle' in bare).toBe(false);
    expect('normal' in bare).toBe(false);
    const full = destructionHit({x: 1, y: 2, z: 3}, UP, 7, 12, UP);
    expect(full.triangle).toBe(12);
    expect(full.normal).toEqual(UP);
  });
});

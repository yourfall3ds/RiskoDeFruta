import {describe, expect, it} from 'vitest';
import {Ray} from '@babylonjs/core/Culling/ray';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {FlatSurface} from '../src/physics/FlatSurface';
import {SphereSurface} from '../src/physics/SphereSurface';
import {FLOOR_COS, localYawOf, tangentFrom} from '../src/physics/SurfaceFrame';
import {PLAYER_TUNING} from '../src/player/PlayerTuning';
import {PLANET, PlanetFrame, cross, distance, dot, length, normalize, scale, sub} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {BRIDGE_SPANS, ISLAND_SLOTS, islandSlot} from '../src/planet/PlanetLayout';
import {TriangleSoup, bridgeDeck, islandDeck, tangentSlab} from './planet-fixture';
import type {Vec3} from '../src/core/contracts';

/**
 * `FlatSurface` é o ORÁCULO de regressão do porte: cada método dela tem de devolver exatamente o
 * mesmo número que o `CollisionWorld` de hoje, porque é ela que o mundo plano continua usando.
 * `SphereSurface` é verificada pelas propriedades que só uma esfera de verdade satisfaz.
 */

/** Mundo plano de teste: malha inclinada + caixas + superfícies autoradas, como a fazenda. */
function flatWorld(): CollisionWorld {
  const world = new CollisionWorld();
  const positions: number[] = [], indices: number[] = [];
  const at = (i: number, j: number): number => {
    // Relevo suave com uma vertente íngreme em x > 12, para exercitar o descarte por inclinação.
    const x = -20 + i * 4, z = -20 + j * 4;
    const y = x > 12 ? (x - 12) * 1.6 : Math.sin(x * 0.12) * 0.8 + Math.cos(z * 0.1) * 0.6;
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const grid: number[][] = [];
  for (let i = 0; i <= 10; i++) {
    const row: number[] = [];
    for (let j = 0; j <= 10; j++) row.push(at(i, j));
    grid.push(row);
  }
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
    indices.push(grid[i]![j]!, grid[i + 1]![j]!, grid[i + 1]![j + 1]!);
    indices.push(grid[i]![j]!, grid[i + 1]![j + 1]!, grid[i]![j + 1]!);
  }
  world.setGeometry(positions, indices);
  world.prepareRaycasts();
  world.boxes.push({id: 'crate', min: {x: 2, y: 0, z: 2}, max: {x: 4, y: 1.4, z: 4}});
  world.boxes.push({id: 'wall', min: {x: -6, y: 0, z: 6}, max: {x: 6, y: 4, z: 6.6}});
  world.surfaces.push({id: 'deck', x: -10, z: -10, width: 8, depth: 8, height: 2.5});
  world.surfaces.push({id: 'ramp', x: 10, z: -10, width: 8, depth: 8, height: 1, slopeX: 0.3});
  return world;
}

/** Gerador determinístico — nada de `Math.random` numa suíte de regressão. */
function sampler(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('FlatSurface é o CollisionWorld de hoje, sem um bit de diferença', () => {
  const world = flatWorld();
  const surface = new FlatSurface(world);

  it('up/down/altitude/atAltitude/belowVoid são exatamente as hipóteses antigas', () => {
    const p = {x: 3, y: 7, z: -2};
    expect(surface.kind).toBe('flat');
    expect(surface.up(p)).toEqual({x: 0, y: 1, z: 0});
    expect(surface.down(p)).toEqual({x: 0, y: -1, z: 0});
    expect(surface.altitude(p)).toBe(7);
    expect(surface.atAltitude(p, -3)).toEqual({x: 3, y: -3, z: -2});
    expect(surface.belowVoid({x: 0, y: PLAYER_TUNING.voidHeight - 0.01, z: 0})).toBe(true);
    expect(surface.belowVoid({x: 0, y: PLAYER_TUNING.voidHeight, z: 0})).toBe(false);
  });

  it('a base é exata: right === (1,0,0) e os produtos escalares são identidades', () => {
    const b = surface.basis({x: 4, y: 1, z: 4}, {x: 0, y: 5, z: 1});
    expect(b.up).toEqual({x: 0, y: 1, z: 0});
    expect(b.forward).toEqual({x: 0, y: 0, z: 1});
    // `right.z` sai como −0 (é `−forward.x`), o que é aritmeticamente idêntico a 0.
    expect(distance(b.right, {x: 1, y: 0, z: 0})).toBe(0);
    expect(distance(b.right, cross(b.up, b.forward))).toBe(0);
    // A dica degenerada (só vertical) cai numa tangente estável em vez de NaN.
    expect(surface.basis({x: 0, y: 0, z: 0}, {x: 0, y: 1, z: 0}).forward).toEqual({x: 0, y: 0, z: 1});
    // Componentes locais de um vetor de mundo são o próprio vetor.
    const v = {x: 1.7, y: -3.2, z: 0.4};
    expect(tangentFrom(b, v.x, v.z)).toEqual({x: v.x, y: 0, z: v.z});
    expect(localYawOf(b.up, b.forward, {x: Math.sin(0.7), y: 0, z: Math.cos(0.7)})).toBeCloseTo(0.7, 12);
  });

  it('support/steepSupport reproduzem groundAt/surfaceAt em 1000 amostras', () => {
    const random = sampler(0x5eed);
    let supported = 0, steep = 0;
    for (let i = 0; i < 1000; i++) {
      const p = {x: -20 + random() * 40, y: -4 + random() * 14, z: -20 + random() * 40};
      const above = [0.5, 2, Infinity][i % 3]!;
      const ground = world.groundAt(p.x, p.z, p.y + above, PLAYER_TUNING.maxSlopeDegrees);
      const sample = surface.support(p, above, Infinity, PLAYER_TUNING.maxSlopeDegrees);
      if (!Number.isFinite(ground)) {
        expect(sample).toBeUndefined();
      } else {
        supported++;
        expect(sample).toBeDefined();
        expect(sample!.point).toEqual({x: p.x, y: ground, z: p.z});
        expect(sample!.offset).toBe(p.y - ground);
        expect(sample!.slopeDegrees).toBeLessThanOrEqual(PLAYER_TUNING.maxSlopeDegrees);
      }
      const real = world.surfaceAt(p.x, p.z, p.y + above);
      const steepSample = surface.steepSupport(p, above, Infinity);
      if (!real) expect(steepSample).toBeUndefined();
      else {
        steep++;
        expect(steepSample!.point.y).toBe(real.height);
        expect(steepSample!.offset).toBe(p.y - real.height);
        expect(steepSample!.slopeDegrees).toBe(real.slopeDegrees);
        expect(steepSample!.normal).toEqual(real.normal);
      }
    }
    expect(supported).toBeGreaterThan(400);
    expect(steep).toBeGreaterThan(400);
  });

  it('`below` finito recorta o apoio distante, `Infinity` não recorta nada', () => {
    const p = {x: -10, y: 12, z: -10};
    expect(surface.support(p, 0.5, Infinity)!.point.y).toBe(2.5);
    expect(surface.support(p, 0.5, 1)).toBeUndefined();
  });

  it('slide apoiado === move + soma vertical; slide no ar === moveAirborne', () => {
    const random = sampler(0xc0ffee);
    for (let i = 0; i < 400; i++) {
      const start = {x: -14 + random() * 28, y: 0.4 + random() * 6, z: -14 + random() * 28};
      const delta = {x: (random() - 0.5) * 0.4, y: (random() - 0.5) * 0.5, z: (random() - 0.5) * 0.4};
      const {radius, height, stepHeight} = PLAYER_TUNING;

      const groundedReference = {...start};
      world.move(groundedReference, delta.x, delta.z, radius, height, stepHeight, true);
      groundedReference.y += delta.y;
      const grounded = {...start};
      const groundedResult = surface.slide(grounded, delta, radius, height, stepHeight, {ignoreFloors: true});
      expect(grounded).toEqual(groundedReference);
      expect(groundedResult.moved).toEqual(sub(groundedReference, start));

      const airReference = {...start};
      const contact = world.moveAirborne(airReference, {...delta}, radius, height, FLOOR_COS);
      const air = {...start};
      const airResult = surface.slide(air, delta, radius, height, 0, {stepUp: false});
      expect(air).toEqual(airReference);
      expect(airResult.verticalContact).toBe(contact);
    }
  });

  it('sweep === sweepSphere, com id do colisor e topo do obstáculo', () => {
    const random = sampler(0xbeef);
    let hits = 0;
    for (let i = 0; i < 400; i++) {
      const from = {x: -8 + random() * 16, y: 0.5 + random() * 4, z: -8 + random() * 16};
      const delta = {x: (random() - 0.5) * 3, y: 0, z: (random() - 0.5) * 3};
      const reference = world.sweepSphere(from, delta, PLAYER_TUNING.radius, true);
      const hit = surface.sweep(from, delta, PLAYER_TUNING.radius);
      if (!reference) {expect(hit).toBeUndefined(); continue;}
      hits++;
      expect(hit!.time).toBe(reference.time);
      expect(hit!.normal).toEqual(reference.normal);
      expect(hit!.id).toBe(reference.collider.id);
      // `topGap > −.2` tem de ser o antigo `collider.max.y > position.y + .7` (sonda a .9 do pé).
      expect(hit!.topGap).toBe(reference.collider.max.y - from.y);
    }
    expect(hits).toBeGreaterThan(20);
  });

  it('raycast e insideSolid delegam sem alteração; depenetrate não existe no plano', () => {
    const ray = new Ray(new Vector3(3, 9, 3), new Vector3(0, -1, 0), 40);
    const reference = world.raycast(ray), hit = surface.raycast(ray);
    expect(hit?.distance).toBe(reference?.distance);
    expect(hit?.point).toEqual(reference?.point);
    const buried = {x: 3, y: 0.2, z: 3};
    expect(surface.insideSolid(buried, PLAYER_TUNING.height)).toBe(world.insideSolid(buried, PLAYER_TUNING.height));
    expect(surface.insideSolid(buried, PLAYER_TUNING.height)).toBe(true);
    expect(surface.depenetrate(buried, PLAYER_TUNING.radius, PLAYER_TUNING.height)).toBeUndefined();
  });

  it('métrica planar, altura, walk, transporte e grade', () => {
    const a = {x: 3, y: 9, z: -4}, b = {x: -2, y: 1, z: 6};
    expect(surface.planarDistance(a, b)).toBe(Math.hypot(a.x - b.x, a.z - b.z));
    expect(surface.heightGap(a, b)).toBe(a.y - b.y);
    expect(surface.walk(a, {x: 2, y: 0, z: -3})).toEqual({x: 5, y: 9, z: -7});
    expect(surface.transport({x: 1, y: 2, z: 3}, a, b)).toEqual({x: 1, y: 2, z: 3});
    expect(surface.bucket({x: 7, y: -1, z: 3.5}, 3)).toBe('2,-1,1');
    expect(surface.bucket({x: 7.9, y: 0, z: 3.5}, 3)).toBe('2,0,1');
  });

  it('orient mantém o comportamento de hoje: rotation.y e nenhum quaternion', () => {
    const node = {position: {x: 0, y: 0, z: 0}, rotation: {x: 0.3, y: 0, z: 0.4}, rotationQuaternion: {x: 1, y: 1, z: 1, w: 1} as {x: number; y: number; z: number; w: number} | null};
    surface.orient(node, {x: 5, y: 2, z: -1}, {x: Math.sin(0.9), y: 3, z: Math.cos(0.9)});
    expect(node.position).toEqual({x: 5, y: 2, z: -1});
    expect(node.rotationQuaternion).toBeNull();
    expect(node.rotation.y).toBeCloseTo(0.9, 12);
    expect(node.rotation.x).toBe(0);
    expect(node.rotation.z).toBe(0);
  });

  it('CollisionWorld entrega FlatSurface por default e o mesmo objeto em cada leitura', () => {
    const fresh = new CollisionWorld();
    expect(fresh.spherical).toBe(false);
    expect(fresh.planet).toBeUndefined();
    expect(fresh.surface.kind).toBe('flat');
    expect(fresh.surface).toBe(fresh.surface);
  });
});

const frame = new PlanetFrame(PLANET);

/** Mundo do contrato: 6 ilhas cardeais + as pontes, como em `tests/planet-motor.test.ts`. */
function planetWorld(extra?: (soup: TriangleSoup) => void): PlanetCollision {
  const soup = new TriangleSoup();
  for (const slot of ISLAND_SLOTS) islandDeck(soup, frame, slot.direction, {radiusMetres: frame.islandRadius});
  for (const span of BRIDGE_SPANS) {
    bridgeDeck(soup, frame, islandSlot(span.from).direction, islandSlot(span.to).direction,
      {width: 10, segments: 60, inset: frame.islandRadius});
  }
  extra?.(soup);
  const collision = new PlanetCollision();
  collision.setGeometry(soup.positions, soup.indices);
  return collision;
}

describe('SphereSurface é uma esfera de verdade nos seis polos', () => {
  const collision = planetWorld();
  const surface = new SphereSurface(frame, collision);

  it('a vertical local é radial e a altitude é medida pelo raio', () => {
    expect(surface.kind).toBe('sphere');
    for (const slot of ISLAND_SLOTS) {
      const p = frame.fromDirection(slot.direction, 3);
      expect(distance(surface.up(p), normalize(slot.direction))).toBeLessThan(1e-12);
      expect(distance(surface.down(p), scale(normalize(slot.direction), -1))).toBeLessThan(1e-12);
      expect(surface.altitude(p)).toBeCloseTo(3, 9);
      expect(frame.radius(surface.atAltitude(p, -1))).toBeCloseTo(PLANET.surfaceRadius - 1, 9);
    }
    // Abaixo do limite do vazio — e isso NÃO é "y < −25": no polo sul o vazio está em y positivo.
    expect(surface.belowVoid(frame.fromDirection({x: 0, y: -1, z: 0}, -40))).toBe(true);
    expect(surface.belowVoid(frame.fromDirection({x: 0, y: -1, z: 0}, -10))).toBe(false);
  });

  it('a sonda de apoio encontra o convés em qualquer lado, com folga ~0 e normal radial', () => {
    for (const slot of ISLAND_SLOTS) {
      const p = frame.fromDirection(slot.direction, 0.5);
      const sample = surface.support(p, 1, 2, PLAYER_TUNING.maxSlopeDegrees);
      expect(sample).toBeDefined();
      expect(sample!.offset).toBeCloseTo(0.5, 3);
      // O convés é facetado: a faceta do ápice da calota inclina ~1° em relação à radial exata.
      expect(sample!.slopeDegrees).toBeLessThan(2);
      expect(dot(sample!.normal, surface.up(p))).toBeGreaterThan(0.999);
      expect(frame.altitude(sample!.point)).toBeCloseTo(0, 6);
    }
    // Fora de ilha e de ponte não existe apoio nenhum — nada de piso falso em y=0.
    expect(surface.support(frame.fromDirection(normalize({x: 0.7, y: 0.7, z: 0.2}), 0.5), 1, 2)).toBeUndefined();
    // `Infinity` é recortado na casca útil (teto acima, vazio abaixo) e ainda acha o convés.
    const fallen = frame.fromDirection({x: 0, y: 0, z: 1}, -20);
    expect(surface.support(fallen, Infinity, Infinity)!.offset).toBeCloseTo(-20, 2);
  });

  it('planarDistance é ARCO, não corda: um quarto de volta entre polos vizinhos', () => {
    const north = frame.fromDirection({x: 0, y: 1, z: 0});
    const front = frame.fromDirection({x: 0, y: 0, z: 1});
    expect(surface.planarDistance(north, front)).toBeCloseTo(frame.circumference / 4, 6);
    // A corda mediria 282,8 m — atravessando o planeta. O arco mede 314,2 m.
    expect(distance(north, front)).toBeLessThan(surface.planarDistance(north, front) - 30);
    const antipode = frame.fromDirection({x: 0, y: 0, z: -1});
    expect(surface.planarDistance(front, antipode)).toBeCloseTo(frame.circumference / 2, 5);
  });

  it('heightGap mede na vertical local, não em Y do mundo', () => {
    const low = frame.fromDirection({x: 1, y: 0, z: 0}, 0);
    const high = frame.fromDirection({x: 1, y: 0, z: 0}, 4);
    expect(surface.heightGap(high, low)).toBeCloseTo(4, 9);
    expect(surface.heightGap(low, high)).toBeCloseTo(-4, 9);
    // Dois pontos na MESMA altitude, separados por arco, não têm diferença de altura.
    const beside = surface.walk(low, scale(surface.basis(low, {x: 0, y: 1, z: 0}).forward, 30));
    expect(Math.abs(surface.heightGap(beside, low))).toBeLessThan(2.3);
    expect(Math.abs(high.y - low.y)).toBeLessThan(1e-9);
  });

  it('walk é passo geodésico: o raio é preservado em mil passos', () => {
    let p = frame.fromDirection({x: 0, y: 0, z: 1}, 0);
    const heading = frame.basisAt(p, {x: 0, y: 1, z: 0}).forward;
    let direction = heading, travelled = 0;
    for (let i = 0; i < 1000; i++) {
      const next = frame.geodesicStep(p, scale(direction, 1.2));
      p = next.position; direction = next.direction; travelled += 1.2;
      expect(Math.abs(frame.radius(p) - PLANET.surfaceRadius)).toBeLessThan(1e-9);
    }
    expect(travelled).toBeCloseTo(1200, 6);
    expect(Math.abs(frame.radius(p) - PLANET.surfaceRadius)).toBeLessThan(1e-9);
  });

  it('transporte paralelo preserva comprimento e tangência (o polo deixa de ser singular)', () => {
    const from = frame.fromDirection({x: 0, y: 0, z: 1});
    const to = frame.fromDirection({x: 0, y: 1, z: 0});
    const tangent = scale(frame.basisAt(from, {x: 1, y: 0, z: 0}).forward, 6.8);
    const carried = surface.transport(tangent, from, to);
    expect(length(carried)).toBeCloseTo(6.8, 12);
    expect(Math.abs(dot(carried, surface.up(to)))).toBeLessThan(1e-12);
  });

  it('slide anda tangencialmente sobre o convés e barra uma face alta', () => {
    const at = frame.fromDirection({x: 0, y: 0, z: 1}, 0.02);
    const heading = frame.basisAt(at, {x: 0, y: 1, z: 0}).forward;
    const walked = {...at};
    const result = surface.slide(walked, scale(heading, 0.12), PLAYER_TUNING.radius, PLAYER_TUNING.height, PLAYER_TUNING.stepHeight, {ignoreFloors: true});
    expect(result.blocked).toBe(false);
    expect(frame.arcDistance(at, walked)).toBeCloseTo(0.12, 3);
    expect(length(result.moved)).toBeCloseTo(0.12, 3);

    const blocked = new SphereSurface(frame, planetWorld(soup => {
      // Murete fino 1,5 m à frente: a cápsula começa FORA dele e é barrada a ~0,9 m de avanço.
      tangentSlab(soup, frame, frame.geodesicStep(at, scale(heading, 1.5)).position,
        {along: 0.6, across: 8, height: 2.4, heading: {x: 0, y: 1, z: 0}});
    }));
    const stopped = {...at};
    const wallHit = blocked.slide(stopped, scale(heading, 1.2), PLAYER_TUNING.radius, PLAYER_TUNING.height, PLAYER_TUNING.stepHeight, {ignoreFloors: true});
    expect(wallHit.blocked).toBe(true);
    expect(wallHit.wall).toBeDefined();
    expect(frame.arcDistance(at, stopped)).toBeLessThan(1.2);
  });

  it('slide sobe um degrau abaixo de stepHeight e reporta `stepped`', () => {
    const at = frame.fromDirection({x: 0, y: 0, z: 1}, 0.02);
    const heading = frame.basisAt(at, {x: 0, y: 1, z: 0}).forward;
    const stepped = new SphereSurface(frame, planetWorld(soup => {
      tangentSlab(soup, frame, frame.geodesicStep(at, scale(heading, 3)).position,
        {along: 6, across: 10, height: 0.34, heading: {x: 0, y: 1, z: 0}});
    }));
    const p = {...at};
    let climbed = false;
    for (let i = 0; i < 40 && !climbed; i++) {
      const result = stepped.slide(p, scale(heading, 0.12), PLAYER_TUNING.radius, PLAYER_TUNING.height, PLAYER_TUNING.stepHeight, {ignoreFloors: true});
      climbed ||= result.stepped;
      // Reancorar a marcha no ponto atual, como o motor faz por transporte.
      if (frame.arcDistance(at, p) > 5) break;
    }
    expect(climbed).toBe(true);
    expect(frame.altitude(p)).toBeGreaterThan(0.2);
  });

  it('sweep acha a parede com id estável por FACE, não por triângulo', () => {
    const at = frame.fromDirection({x: 0, y: 0, z: 1}, 0.02);
    const heading = frame.basisAt(at, {x: 0, y: 1, z: 0}).forward;
    const walled = new SphereSurface(frame, planetWorld(soup => {
      tangentSlab(soup, frame, frame.geodesicStep(at, scale(heading, 1.5)).position,
        {along: 0.6, across: 20, height: 3, heading: {x: 0, y: 1, z: 0}});
    }));
    const up = walled.up(at);
    const shoulder = {x: at.x + up.x * 0.9, y: at.y + up.y * 0.9, z: at.z + up.z * 0.9};
    const first = walled.sweep(shoulder, scale(heading, 1.2), PLAYER_TUNING.radius);
    expect(first).toBeDefined();
    expect(Math.abs(dot(first!.normal, up))).toBeLessThan(FLOOR_COS);
    expect(first!.topGap).toBe(Infinity);
    // Deslizar 1,5 m ao longo da MESMA face responde a mesma chave: um wall jump por parede.
    const side = cross(up, heading);
    const beside = walled.walk(shoulder, scale(side, 1.5));
    const second = walled.sweep(beside, scale(heading, 1.2), PLAYER_TUNING.radius);
    expect(second?.id).toBe(first!.id);
  });

  it('insideSolid e depenetrate desencravam um corpo enfiado no convés', () => {
    const buried = frame.fromDirection({x: 1, y: 0, z: 0}, -0.3);
    const contact = surface.depenetrate(buried, PLAYER_TUNING.radius, PLAYER_TUNING.height);
    expect(contact).toBeDefined();
    expect(contact!.depth).toBeGreaterThan(0.2);
    // O empurrão é para FORA do sólido, ao longo da normal — nunca para dentro.
    expect(dot(contact!.normal, surface.up(buried))).toBeGreaterThan(0.9);
    expect(surface.insideSolid(buried, PLAYER_TUNING.height)).toBe(true);
    expect(surface.insideSolid(frame.fromDirection({x: 1, y: 0, z: 0}, 0.05), PLAYER_TUNING.height)).toBe(false);
  });

  it('orient entrega quaternion radial com Y local na vertical verdadeira', () => {
    const node: {position: Vec3; rotation: Vec3; rotationQuaternion: {x: number; y: number; z: number; w: number} | null} = {
      position: {x: 0, y: 0, z: 0}, rotation: {x: 0.2, y: 0.3, z: 0.4}, rotationQuaternion: null,
    };
    for (const slot of ISLAND_SLOTS) {
      const p = frame.fromDirection(slot.direction, 0.1);
      const forward = frame.basisAt(p, {x: 0, y: 1, z: 0}).forward;
      surface.orient(node, p, forward);
      expect(node.position).toEqual({x: p.x, y: p.y, z: p.z});
      expect(node.rotation).toEqual({x: 0, y: 0, z: 0});
      const q = node.rotationQuaternion!;
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
      // O eixo Y da rotação é a vertical local: a fruta não fica deitada fora do polo.
      const localUp = {
        x: 2 * (q.x * q.y - q.w * q.z),
        y: 1 - 2 * (q.x * q.x + q.z * q.z),
        z: 2 * (q.y * q.z + q.w * q.x),
      };
      expect(distance(localUp, surface.up(p))).toBeLessThan(1e-6);
    }
  });

  it('CollisionWorld.configurePlanet troca o backend sem tocar nos métodos originais', () => {
    const world = flatWorld();
    const flatGround = world.groundAt(0, 0);
    const flatSurface = world.surface;
    expect(flatSurface.kind).toBe('flat');
    world.configurePlanet(frame, collision);
    expect(world.spherical).toBe(true);
    expect(world.planet?.frame).toBe(frame);
    expect(world.surface.kind).toBe('sphere');
    expect(world.surface).not.toBe(flatSurface);
    // Os métodos de sempre continuam respondendo o que sempre responderam.
    expect(world.groundAt(0, 0)).toBe(flatGround);
    expect(world.boxes.length).toBe(2);
    // Idempotente para o mesmo par: não recria o referencial.
    const again = world.surface;
    world.configurePlanet(frame, collision);
    expect(world.surface).toBe(again);
  });
});

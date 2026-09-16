import {describe, expect, it} from 'vitest';
import type {Vec3} from '../src/core/contracts';
import {
  PLANET, PlanetFrame, add, cross, distance, dot, length, normalize, scale, sub, type Quat,
} from '../src/planet/PlanetFrame';
import {
  BRIDGE_SPANS, EQUATORIAL_LOOP, ISLAND_SLOTS, islandSlot, PLANET_LAYOUT,
} from '../src/planet/PlanetLayout';
import {arcPoints, bridgeSpan, bridgeSpanFor, islandPlacement, islandPlacementFor} from '../src/planet/PlanetTransform';

const frame = new PlanetFrame(PLANET);

/** Rotação de vetor por quaternion — a mesma que o Babylon aplica à `rotationQuaternion`. */
function rotate(q: Quat, v: Vec3): Vec3 {
  const u = {x: q.x, y: q.y, z: q.z};
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q.w)), cross(u, t));
}

describe('PLANET_LAYOUT — o contrato como dado', () => {
  it('tem seis setores cardeais, um para cada face do planeta', () => {
    expect(ISLAND_SLOTS).toHaveLength(6);
    const ids = ISLAND_SLOTS.map(s => s.id).sort();
    expect(ids).toEqual(['back', 'east', 'front', 'north', 'south', 'west']);
    for (const slot of ISLAND_SLOTS) {
      expect(length(slot.direction)).toBeCloseTo(1, 12);
      expect(distance(slot.direction, PlanetFrame.direction(slot.longitudeDegrees, slot.latitudeDegrees)))
        .toBeLessThan(1e-12);
    }
    // Pares opostos: nenhuma face do planeta fica sem ilha.
    for (const [a, b] of [['north', 'south'], ['front', 'back'], ['east', 'west']] as const) {
      expect(dot(islandSlot(a).direction, islandSlot(b).direction)).toBeCloseTo(-1, 12);
    }
  });

  it('o anel equatorial é um ciclo fechado: sair e seguir em frente volta à mesma ilha', () => {
    const stage1 = BRIDGE_SPANS.filter(span => span.stage === 1);
    expect(stage1).toHaveLength(4);
    const next = new Map(stage1.map(span => [span.from, span.to]));
    let at: string = EQUATORIAL_LOOP[0]!;
    const visited: string[] = [at];
    for (let i = 0; i < 4; i++) {at = next.get(at as never)!; visited.push(at);}
    expect(visited).toEqual([...EQUATORIAL_LOOP, EQUATORIAL_LOOP[0]]);
    expect(new Set(visited).size).toBe(4);
  });

  it('as pontes polares ligam os dois polos ao anel', () => {
    const stage2 = BRIDGE_SPANS.filter(span => span.stage === 2);
    expect(stage2.map(span => span.id).sort()).toEqual(['north-front', 'south-back']);
    for (const span of stage2) {
      const from = islandSlot(span.from).direction, to = islandSlot(span.to).direction;
      expect(dot(from, to)).toBeCloseTo(0, 12);
    }
    expect(PLANET_LAYOUT.bridges).toBe(BRIDGE_SPANS);
  });

  it('cada ponte liga slots vizinhos, nunca antípodas', () => {
    for (const span of BRIDGE_SPANS) {
      const arc = frame.arcDistance(
        frame.fromDirection(islandSlot(span.from).direction),
        frame.fromDirection(islandSlot(span.to).direction),
      );
      expect(arc).toBeCloseTo(Math.PI / 2 * PLANET.surfaceRadius, 6);
    }
  });
});

describe('islandPlacement — colocar GLB autoral no slot', () => {
  it('põe o convés no raio do contrato, com a vertical radial', () => {
    for (const slot of ISLAND_SLOTS) {
      const placement = islandPlacementFor(frame, slot.id);
      expect(distance(placement.position, PLANET.centre)).toBeCloseTo(PLANET.surfaceRadius, 9);
      expect(distance(placement.up, slot.direction)).toBeLessThan(1e-12);
      expect(distance(placement.position, frame.fromDirection(slot.direction))).toBeLessThan(1e-9);
    }
  });

  it('o quaternion leva Y local para a vertical e Z local para a frente', () => {
    for (const slot of ISLAND_SLOTS) {
      const p = islandPlacement(frame, slot.direction, 37);
      expect(Math.hypot(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w)).toBeCloseTo(1, 12);
      expect(distance(rotate(p.rotation, {x: 0, y: 1, z: 0}), p.up)).toBeLessThan(1e-9);
      expect(distance(rotate(p.rotation, {x: 0, y: 0, z: 1}), p.forward)).toBeLessThan(1e-9);
      expect(distance(rotate(p.rotation, {x: 1, y: 0, z: 0}), p.right)).toBeLessThan(1e-9);
      expect(distance(p.right, cross(p.up, p.forward))).toBeLessThan(1e-12);
    }
  });

  it('o giro roda a ilha em torno da própria vertical, sem sair do slot', () => {
    const none = islandPlacement(frame, {x: 0, y: 0, z: 1}, 0);
    const spun = islandPlacement(frame, {x: 0, y: 0, z: 1}, 90);
    expect(distance(none.position, spun.position)).toBeLessThan(1e-9);
    expect(dot(none.forward, spun.forward)).toBeCloseTo(0, 9);
    expect(distance(spun.forward, none.right)).toBeLessThan(1e-9);
  });

  it('`deckOffset` sobe o convés sem tirá-lo da vertical', () => {
    const raised = islandPlacementFor(frame, 'south', 3.5);
    expect(distance(raised.position, PLANET.centre)).toBeCloseTo(PLANET.surfaceRadius + 3.5, 9);
    expect(raised.position.y).toBeCloseTo(-(PLANET.surfaceRadius + 3.5), 9);
    expect(frame.altitude(raised.position)).toBeCloseTo(3.5, 9);
  });

  it('nos polos, onde não há leste geográfico, a base continua válida', () => {
    for (const id of ['north', 'south'] as const) {
      const p = islandPlacementFor(frame, id);
      expect(Math.abs(dot(p.forward, p.up))).toBeLessThan(1e-12);
      expect(length(p.forward)).toBeCloseTo(1, 12);
      expect(length(p.right)).toBeCloseTo(1, 12);
    }
  });
});

describe('bridgeSpan — distribuir módulos no arco', () => {
  it('entrega os comprimentos exatos do contrato', () => {
    const path = bridgeSpanFor(frame, BRIDGE_SPANS[0]!, {modules: 6});
    expect(path.arcLength).toBeCloseTo(314.159, 3);
    expect(path.freeLength).toBeCloseTo(170.159, 3);
    expect(path.moduleLength).toBeCloseTo(170.159 / 6, 3);
    expect(path.modules).toHaveLength(6);
  });

  it('todo módulo fica na superfície, de pé e virado para a travessia', () => {
    const path = bridgeSpan(frame, {x: 0, y: 0, z: 1}, {x: 1, y: 0, z: 0}, {modules: 6});
    for (const m of path.modules) {
      expect(distance(m.position, PLANET.centre)).toBeCloseTo(PLANET.surfaceRadius, 9);
      expect(distance(m.up, normalize(sub(m.position, PLANET.centre)))).toBeLessThan(1e-12);
      expect(Math.abs(dot(m.forward, m.up))).toBeLessThan(1e-12);
      expect(distance(m.right, cross(m.up, m.forward))).toBeLessThan(1e-12);
      // Uma ponte entre `front` e `east` fica toda no equador.
      expect(Math.abs(m.position.y)).toBeLessThan(1e-9);
    }
  });

  it('os módulos ficam igualmente espaçados dentro do vão livre', () => {
    const path = bridgeSpan(frame, {x: 0, y: 0, z: 1}, {x: 1, y: 0, z: 0}, {modules: 6});
    const start = frame.fromDirection({x: 0, y: 0, z: 1});
    path.modules.forEach((m, i) => {
      expect(m.arcOffset).toBeCloseTo(path.moduleLength * (i + 0.5), 9);
      expect(frame.arcDistance(start, m.position))
        .toBeCloseTo(frame.islandRadius + path.moduleLength * (i + 0.5), 6);
    });
    for (let i = 1; i < path.modules.length; i++) {
      expect(frame.arcDistance(path.modules[i - 1]!.position, path.modules[i]!.position))
        .toBeCloseTo(path.moduleLength, 6);
    }
  });

  it('o primeiro e o último módulo respeitam o recuo das ilhas', () => {
    const path = bridgeSpan(frame, {x: 0, y: 0, z: 1}, {x: 0, y: 1, z: 0}, {modules: 6});
    const from = frame.fromDirection({x: 0, y: 0, z: 1}), to = frame.fromDirection({x: 0, y: 1, z: 0});
    expect(frame.arcDistance(from, path.modules[0]!.position))
      .toBeGreaterThanOrEqual(frame.islandRadius - 1e-6);
    expect(frame.arcDistance(to, path.modules[5]!.position))
      .toBeGreaterThanOrEqual(frame.islandRadius - 1e-6);
  });

  it('recusa um arco indefinido entre pontas coincidentes', () => {
    expect(() => bridgeSpan(frame, {x: 0, y: 0, z: 1}, {x: 0, y: 0, z: 1}, {modules: 4})).toThrow();
    expect(() => bridgeSpan(frame, {x: 0, y: 0, z: 1}, {x: 0, y: 0, z: -1}, {modules: 4})).toThrow();
  });

  it('um recuo próprio muda o vão sem mudar o arco', () => {
    const path = bridgeSpan(frame, {x: 0, y: 0, z: 1}, {x: 1, y: 0, z: 0}, {modules: 4, islandRadius: 50});
    expect(path.arcLength).toBeCloseTo(314.159, 3);
    expect(path.freeLength).toBeCloseTo(314.159 - 100, 3);
    expect(path.moduleLength * 4).toBeCloseTo(path.freeLength, 9);
  });
});

describe('arcPoints — rota sobre o círculo máximo', () => {
  it('sai do começo, chega no fim e fica todo na superfície', () => {
    const points = arcPoints(frame, {x: 0, y: 0, z: 1}, {x: 0, y: 1, z: 0}, 12);
    expect(points).toHaveLength(13);
    expect(distance(points[0]!, frame.fromDirection({x: 0, y: 0, z: 1}))).toBeLessThan(1e-9);
    expect(distance(points[12]!, frame.fromDirection({x: 0, y: 1, z: 0}))).toBeLessThan(1e-6);
    for (const p of points) expect(Math.abs(frame.altitude(p))).toBeLessThan(1e-9);
  });

  it('respeita a altitude pedida e o espaçamento constante', () => {
    const points = arcPoints(frame, {x: 0, y: 0, z: 1}, {x: 1, y: 0, z: 0}, 8, 5);
    for (const p of points) expect(frame.altitude(p)).toBeCloseTo(5, 6);
    const spacing = frame.arcDistance(points[0]!, points[1]!);
    for (let i = 1; i < points.length; i++) {
      expect(frame.arcDistance(points[i - 1]!, points[i]!)).toBeCloseTo(spacing, 6);
    }
  });
});

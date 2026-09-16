import {describe, expect, it} from 'vitest';
import {
  PLANET, PlanetFrame, add, cross, distance, dot, length, normalize, scale, sub, transport,
} from '../src/planet/PlanetFrame';

const frame = new PlanetFrame(PLANET);
const R = PLANET.surfaceRadius;

describe('PlanetFrame — verticais e altitude', () => {
  it('a vertical aponta para fora do centro em qualquer lado do planeta', () => {
    for (const d of [{x: 1, y: 0, z: 0}, {x: -1, y: 0, z: 0}, {x: 0, y: 1, z: 0},
                     {x: 0, y: -1, z: 0}, {x: 0, y: 0, z: 1}, {x: 0, y: 0, z: -1}]) {
      const p = frame.fromDirection(d);
      const up = frame.up(p);
      expect(distance(up, d)).toBeLessThan(1e-12);
      expect(frame.altitude(p)).toBeCloseTo(0, 9);
    }
  });

  it('altitude é relativa ao convés, inclusive de cabeça para baixo', () => {
    const under = frame.fromDirection({x: 0, y: -1, z: 0}, 3);
    expect(under.y).toBeCloseTo(-(R + 3), 9);
    expect(frame.altitude(under)).toBeCloseTo(3, 9);
    expect(frame.up(under).y).toBeCloseTo(-1, 12);
  });

  it('não produz NaN no centro exato do planeta', () => {
    const up = frame.up({x: 0, y: 0, z: 0});
    expect(Number.isFinite(up.x + up.y + up.z)).toBe(true);
    expect(length(up)).toBeCloseTo(1, 12);
  });
});

describe('PlanetFrame — transporte paralelo', () => {
  it('mantém comprimento e tangência ao mudar de vertical', () => {
    const a = frame.up(frame.fromDirection({x: 0, y: 0, z: 1}));
    const b = frame.up(frame.fromDirection({x: 0.3, y: 0.8, z: -0.2}));
    const v = normalize(cross(a, {x: 0.1, y: 0.9, z: 0.4}));
    const moved = transport(scale(v, 6.8), a, b);
    expect(length(moved)).toBeCloseTo(6.8, 10);
    expect(dot(normalize(moved), b)).toBeCloseTo(0, 10);
  });

  it('transporte de ida e volta devolve o vetor original', () => {
    const a = normalize({x: 0.2, y: 0.9, z: -0.3});
    const b = normalize({x: -0.7, y: 0.1, z: 0.6});
    const v = normalize(cross(a, {x: 1, y: 0.2, z: 0}));
    const back = transport(transport(v, a, b), b, a);
    expect(distance(back, v)).toBeLessThan(1e-12);
  });

  it('sobrevive à antípoda exata sem NaN', () => {
    const a = {x: 0, y: 1, z: 0}, b = {x: 0, y: -1, z: 0};
    const moved = transport({x: 1, y: 0, z: 0}, a, b);
    expect(Number.isFinite(moved.x + moved.y + moved.z)).toBe(true);
    expect(length(moved)).toBeCloseTo(1, 12);
    expect(Math.abs(dot(moved, b))).toBeLessThan(1e-12);
  });
});

describe('PlanetFrame — travessia real da superfície', () => {
  /** Anda `metres` em passos de `step`, sempre na direção de marcha transportada. */
  const walk = (start: Vec3Like, heading: Vec3Like, metres: number, step: number) => {
    let position = {...start}, direction = frame.basisAt(start, heading).forward;
    for (let travelled = 0; travelled < metres - 1e-9;) {
      const advance = Math.min(step, metres - travelled);
      const moved = frame.geodesicStep(position, scale(direction, advance));
      position = moved.position; direction = moved.direction; travelled += advance;
    }
    return {position, direction};
  };
  type Vec3Like = {x: number; y: number; z: number};

  it('a volta completa da circunferência fecha no ponto de partida', () => {
    const start = frame.fromDirection({x: 0, y: 0, z: 1});
    const heading = {x: 1, y: 0, z: 0};
    const {position, direction} = walk(start, heading, frame.circumference, 6.8 / 60);
    expect(distance(position, start)).toBeLessThan(1e-6);
    expect(distance(direction, normalize(heading))).toBeLessThan(1e-9);
    expect(Math.abs(frame.altitude(position))).toBeLessThan(1e-9);
  });

  it('meia volta chega na antípoda exata', () => {
    const start = frame.fromDirection({x: 0, y: 0, z: 1});
    const {position} = walk(start, {x: 1, y: 0, z: 0}, frame.circumference / 2, 6.8 / 60);
    expect(distance(position, scale(start, -1))).toBeLessThan(1e-6);
    expect(frame.arcDistance(position, start)).toBeCloseTo(frame.circumference / 2, 5);
  });

  it('atravessa o polo norte sem descontinuidade e chega ao lado oposto', () => {
    const start = frame.fromDirection({x: 0, y: 0, z: 1});
    // Um quarto de volta para o norte pousa no polo; meia volta segue para o antípoda.
    const quarter = walk(start, {x: 0, y: 1, z: 0}, frame.circumference / 4, 6.8 / 60);
    expect(distance(quarter.position, frame.fromDirection({x: 0, y: 1, z: 0}))).toBeLessThan(1e-6);
    // No polo a marcha continua tangente: aponta para −Z, o lado oposto do ponto de partida.
    expect(Math.abs(dot(quarter.direction, frame.up(quarter.position)))).toBeLessThan(1e-9);
    expect(distance(quarter.direction, {x: 0, y: 0, z: -1})).toBeLessThan(1e-9);
    const half = walk(quarter.position, quarter.direction, frame.circumference / 4, 6.8 / 60);
    expect(distance(half.position, frame.fromDirection({x: 0, y: 0, z: -1}))).toBeLessThan(1e-6);
  });

  it('passa pelo polo sul de cabeça para baixo mantendo o raio', () => {
    const start = frame.fromDirection({x: 1, y: 0, z: 0});
    let worst = 0, position = start, direction = frame.basisAt(start, {x: 0, y: -1, z: 0}).forward;
    for (let i = 0; i < 6000; i++) {
      const moved = frame.geodesicStep(position, scale(direction, 6.8 / 60));
      position = moved.position; direction = moved.direction;
      worst = Math.max(worst, Math.abs(frame.altitude(position)), Math.abs(dot(direction, frame.up(position))));
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('o passo geodésico nunca deriva do raio, mesmo com direção fora do plano tangente', () => {
    let position = frame.fromDirection({x: 0, y: 0.6, z: 0.8});
    for (let i = 0; i < 2000; i++) {
      // Direção suja de propósito: componente radial grande que o passo precisa descartar.
      const dirty = add(frame.basisAt(position, {x: 1, y: 0, z: 0}).forward, scale(frame.up(position), 3));
      position = frame.geodesicStep(position, scale(dirty, 0.05)).position;
    }
    expect(Math.abs(frame.altitude(position))).toBeLessThan(1e-9);
  });
});

describe('PlanetFrame — base e geografia', () => {
  it('right = up × forward, igual à convenção de câmera do jogo', () => {
    const p = frame.fromDirection({x: 0, y: 0, z: 1});
    const basis = frame.basisAt(p, {x: 0.4, y: 7, z: 0.9});
    expect(dot(basis.forward, basis.up)).toBeCloseTo(0, 12);
    expect(distance(basis.right, cross(basis.up, basis.forward))).toBeLessThan(1e-12);
    expect(length(basis.right)).toBeCloseTo(1, 12);
  });

  it('cai numa tangente estável quando a dica aponta direto para cima', () => {
    const p = frame.fromDirection({x: 0, y: 1, z: 0});
    const basis = frame.basisAt(p, {x: 0, y: 1, z: 0});
    expect(Number.isFinite(basis.forward.x + basis.forward.y + basis.forward.z)).toBe(true);
    expect(dot(basis.forward, basis.up)).toBeCloseTo(0, 12);
    expect(length(basis.forward)).toBeCloseTo(1, 12);
  });

  it('longitude/latitude bate com os seis slots do contrato', () => {
    expect(distance(PlanetFrame.direction(0, 90), {x: 0, y: 1, z: 0})).toBeLessThan(1e-12);
    expect(distance(PlanetFrame.direction(0, -90), {x: 0, y: -1, z: 0})).toBeLessThan(1e-12);
    expect(distance(PlanetFrame.direction(0, 0), {x: 0, y: 0, z: 1})).toBeLessThan(1e-12);
    expect(distance(PlanetFrame.direction(90, 0), {x: 1, y: 0, z: 0})).toBeLessThan(1e-12);
    expect(distance(PlanetFrame.direction(180, 0), {x: 0, y: 0, z: -1})).toBeLessThan(1e-12);
    expect(distance(PlanetFrame.direction(-90, 0), {x: -1, y: 0, z: 0})).toBeLessThan(1e-12);
    const back = PlanetFrame.lonLat(PlanetFrame.direction(37, -22));
    expect(back.longitudeDegrees).toBeCloseTo(37, 9);
    expect(back.latitudeDegrees).toBeCloseTo(-22, 9);
  });

  it('a bússola dá leste/norte coerentes e não quebra nos polos', () => {
    const equator = PlanetFrame.compass({x: 0, y: 0, z: 1});
    expect(distance(equator.east, {x: 1, y: 0, z: 0})).toBeLessThan(1e-12);
    expect(distance(equator.north, {x: 0, y: 1, z: 0})).toBeLessThan(1e-12);
    const pole = PlanetFrame.compass({x: 0, y: 1, z: 0});
    expect(length(pole.east)).toBeCloseTo(1, 12);
    expect(length(pole.north)).toBeCloseTo(1, 12);
    expect(Math.abs(dot(pole.east, pole.north))).toBeLessThan(1e-12);
  });

  it('a distância de arco corresponde às medidas do contrato', () => {
    expect(frame.circumference).toBeCloseTo(1256.637, 3);
    const a = frame.fromDirection({x: 0, y: 0, z: 1}), b = frame.fromDirection({x: 1, y: 0, z: 0});
    expect(frame.arcDistance(a, b)).toBeCloseTo(Math.PI / 2 * R, 9);
    expect(frame.arcDistance(a, b) - 2 * PLANET.islandRadius).toBeCloseTo(170.16, 2);
  });

  it('a altitude ignora o deslocamento do centro só quando o centro é a origem', () => {
    const offset = new PlanetFrame({...PLANET, centre: {x: 10, y: -5, z: 2}});
    const p = offset.fromDirection({x: 0, y: 1, z: 0}, 4);
    expect(p.y).toBeCloseTo(-5 + R + 4, 9);
    expect(offset.altitude(p)).toBeCloseTo(4, 9);
    expect(distance(sub(p, {x: 10, y: -5, z: 2}), {x: 0, y: R + 4, z: 0})).toBeLessThan(1e-9);
  });
});

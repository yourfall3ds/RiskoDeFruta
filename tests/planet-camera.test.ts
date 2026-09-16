import {describe, expect, it} from 'vitest';
import {PLANET, PlanetFrame, add, cross, distance, dot, length, normalize, scale, sub} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {PlanetCamera, PLANET_CAMERA_TUNING, tangentAngle, turnTangent} from '../src/planet/PlanetCamera';
import {PlanetMotor, type PlanetInput} from '../src/planet/PlanetMotor';
import {BRIDGE_SPANS, ISLAND_SLOTS, islandSlot} from '../src/planet/PlanetLayout';
import {TriangleSoup, bridgeDeck, islandDeck, tangentSlab} from './planet-fixture';

const frame = new PlanetFrame(PLANET);
const c = PLANET_CAMERA_TUNING;
const STEP = 1 / 60;
const SPRINT: PlanetInput = {x: 0, z: 1, jump: false, sprint: true};

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

describe('PlanetCamera — vertical de verdade, não roll cosmético', () => {
  it('a vertical da pose é a vertical do planeta em qualquer lado', () => {
    const camera = new PlanetCamera(frame, frame.fromDirection({x: 0, y: 0, z: 1}));
    for (const direction of [{x: 0, y: 0, z: 1}, {x: 0, y: -1, z: 0}, {x: -1, y: 0, z: 0}]) {
      const anchor = frame.fromDirection(direction);
      camera.snapTo(anchor);
      const pose = camera.update(anchor, STEP);
      expect(distance(pose.up, frame.up(anchor))).toBeLessThan(1e-9);
      expect(length(pose.up)).toBeCloseTo(1, 12);
    }
  });

  it('olha na direção do alvo e mantém a distância pedida quando nada estorva', () => {
    const anchor = frame.fromDirection({x: 0, y: 0, z: 1});
    const camera = new PlanetCamera(frame, anchor);
    const pose = camera.update(anchor, STEP);
    expect(distance(sub(pose.target, pose.position), pose.forward)).toBeLessThan(1e-12);
    expect(length(pose.forward)).toBeCloseTo(1, 12);
    expect(pose.distance).toBeCloseTo(c.distance, 9);
    const pivot = add(anchor, scale(pose.up, c.pivotHeight));
    // Atrás do pivô, com o deslocamento de ombro do contrato.
    expect(dot(sub(pose.position, pivot), pose.forward)).toBeLessThan(0);
    expect(dot(sub(pose.position, pivot), pose.right)).toBeCloseTo(c.shoulderOffset, 6);
  });

  it('o pitch fica preso nos limites e positivo olha para baixo', () => {
    const anchor = frame.fromDirection({x: 0, y: 0, z: 1});
    const camera = new PlanetCamera(frame, anchor, {heading: {x: 1, y: 0, z: 0}});
    for (let i = 0; i < 4000; i++) camera.look(0, 40);
    expect(camera.pitch).toBeCloseTo(c.pitchMax, 9);
    expect(dot(camera.update(anchor, STEP).forward, frame.up(anchor))).toBeLessThan(-0.5);
    for (let i = 0; i < 8000; i++) camera.look(0, -40);
    expect(camera.pitch).toBeCloseTo(c.pitchMin, 9);
    expect(dot(camera.update(anchor, STEP).forward, frame.up(anchor))).toBeGreaterThan(0.5);
  });

  it('girar a mira preserva tangência inclusive sobre o polo', () => {
    const anchor = frame.fromDirection({x: 0, y: 1, z: 0});
    const camera = new PlanetCamera(frame, anchor);
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      camera.look(30, 0, frame.up(anchor));
      worst = Math.max(worst, Math.abs(dot(camera.heading, frame.up(anchor))), Math.abs(length(camera.heading) - 1));
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('recua quando há parede atrás e volta a abrir quando ela some', () => {
    const anchor = frame.fromDirection({x: 0, y: 0, z: 1});
    const basis = frame.basisAt(anchor, {x: 0, y: 1, z: 0});
    const walled = planetWorld(soup => {
      // Parede logo atrás do jogador, na direção oposta à mira.
      tangentSlab(soup, frame, frame.geodesicStep(anchor, scale(basis.forward, -1.2)).position,
        {along: 0.6, across: 12, height: 6, heading: {x: 0, y: 1, z: 0}});
    });
    const blocked = new PlanetCamera(frame, anchor, {collision: walled, heading: basis.forward});
    const near = blocked.update(anchor, STEP);
    expect(near.distance).toBeLessThan(c.distance);
    expect(near.distance).toBeGreaterThan(0.14);

    const open = new PlanetCamera(frame, anchor, {collision: planetWorld(), heading: basis.forward});
    expect(open.update(anchor, STEP).distance).toBeCloseTo(c.distance, 9);
  });

  it('acompanha o personagem dando a volta no planeta sem perder o enquadramento', () => {
    const collision = planetWorld();
    const motor = new PlanetMotor({
      frame, collision, spawn: frame.fromDirection({x: 0, y: 0, z: 1}, 0.5), heading: {x: 1, y: 0, z: 0},
    });
    const camera = new PlanetCamera(frame, motor.position, {collision, heading: {x: 1, y: 0, z: 0}});
    let worstUp = 0, worstBehind = 1, worstPivot = 0;
    for (let i = 0; i < 60 * 200; i++) {
      motor.fixedUpdate(STEP, SPRINT, camera.motorHeading);
      const pose = camera.update(motor.position, STEP);
      worstUp = Math.max(worstUp, distance(pose.up, motor.up));
      worstBehind = Math.min(worstBehind, dot(normalize(pose.forward), motor.forward));
      worstPivot = Math.max(worstPivot, Math.abs(frame.arcDistance(pose.position, motor.position)) - 4);
    }
    expect(motor.recoveries).toBe(0);
    // A vertical da câmera é sempre a do corpo: nenhum roll artificial no meio.
    expect(worstUp).toBeLessThan(1e-9);
    // Continua olhando para onde o personagem anda (pitch pequeno do contrato).
    expect(worstBehind).toBeGreaterThan(0.95);
    // Nunca se afasta mais do que a distância de terceira pessoa.
    expect(worstPivot).toBeLessThan(0.1);
    // Voltou ao ponto de partida junto com o corpo.
    expect(frame.arcDistance(motor.position, frame.fromDirection({x: 0, y: 0, z: 1}))).toBeLessThan(120);
  });

  it('a mira transportada não salta ao cruzar o polo', () => {
    const collision = planetWorld();
    const motor = new PlanetMotor({
      frame, collision, spawn: frame.fromDirection({x: 0, y: 0, z: 1}, 0.5), heading: {x: 0, y: 1, z: 0},
    });
    const camera = new PlanetCamera(frame, motor.position, {collision, heading: {x: 0, y: 1, z: 0}});
    let biggestJump = 0, previous = camera.update(motor.position, STEP).forward;
    for (let i = 0; i < 60 * 55; i++) {
      motor.fixedUpdate(STEP, SPRINT, camera.motorHeading);
      const pose = camera.update(motor.position, STEP);
      biggestJump = Math.max(biggestJump, distance(pose.forward, previous));
      previous = pose.forward;
    }
    // Passou pelo polo norte; a maior variação de um quadro continua sendo o giro do arco.
    expect(dot(motor.up, {x: 0, y: 1, z: 0})).toBeGreaterThan(0.9);
    expect(biggestJump).toBeLessThan(0.01);
  });
});

describe('PlanetCamera — utilidades de tangente', () => {
  it('mede o ângulo com sinal entre duas tangentes', () => {
    const up = {x: 0, y: 1, z: 0};
    const a = {x: 0, y: 0, z: 1};
    expect(tangentAngle(up, a, {x: 1, y: 0, z: 0})).toBeCloseTo(Math.PI / 2, 9);
    expect(tangentAngle(up, a, {x: -1, y: 0, z: 0})).toBeCloseTo(-Math.PI / 2, 9);
    expect(tangentAngle(up, a, a)).toBeCloseTo(0, 9);
  });

  it('gira uma tangente em torno da vertical local', () => {
    const up = normalize({x: 0.2, y: 0.9, z: -0.3});
    const tangent = normalize(cross(up, {x: 1, y: 0, z: 0}));
    const turned = turnTangent(up, tangent, Math.PI / 3);
    expect(Math.abs(dot(turned, up))).toBeLessThan(1e-12);
    expect(length(turned)).toBeCloseTo(1, 12);
    expect(tangentAngle(up, tangent, turned)).toBeCloseTo(Math.PI / 3, 9);
  });
});

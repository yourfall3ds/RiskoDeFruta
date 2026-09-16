import {describe, expect, it} from 'vitest';
import {PLANET, PlanetFrame, add, cross, distance, dot, length, normalize, scale, sub} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {PLANET_MOTOR_TUNING, PlanetMotor, type PlanetInput} from '../src/planet/PlanetMotor';
import {BRIDGE_SPANS, ISLAND_SLOTS, islandSlot} from '../src/planet/PlanetLayout';
import {TriangleSoup, bridgeDeck, islandDeck, tangentSlab} from './planet-fixture';

const frame = new PlanetFrame(PLANET);
const t = PLANET_MOTOR_TUNING;
const IDLE: PlanetInput = {x: 0, z: 0, jump: false, sprint: false};
const FORWARD: PlanetInput = {x: 0, z: 1, jump: false, sprint: false};
const SPRINT: PlanetInput = {x: 0, z: 1, jump: false, sprint: true};
const STEP = 1 / 60;

/** Mundo completo do contrato: 6 ilhas cardeais + as 6 pontes (anel equatorial e ligação polar). */
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

function motorAt(collision: PlanetCollision, direction: {x: number; y: number; z: number}, altitude = 0.05, heading?: {x: number; y: number; z: number}) {
  return new PlanetMotor({
    frame, collision,
    spawn: frame.fromDirection(direction, altitude),
    ...(heading ? {heading} : {}),
  });
}

function drive(motor: PlanetMotor, seconds: number, input: PlanetInput): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) motor.fixedUpdate(STEP, input);
}

describe('PlanetMotor — gravidade radial de verdade', () => {
  it('cai na direção do centro e assenta no convés, em qualquer lado do planeta', () => {
    const collision = planetWorld();
    for (const slot of ISLAND_SLOTS) {
      const motor = motorAt(collision, slot.direction, 6);
      drive(motor, 2.5, IDLE);
      expect(motor.grounded).toBe(true);
      expect(Math.abs(motor.altitude)).toBeLessThan(0.1);
      expect(distance(motor.up, slot.direction)).toBeLessThan(1e-9);
      // A gravidade puxou para o centro, não para −Y: no polo sul a queda foi para −Y mesmo,
      // mas na ilha `east` ela foi para −X.
      expect(dot(normalize(sub(motor.position, PLANET.centre)), slot.direction)).toBeCloseTo(1, 9);
    }
  });

  it('parado no convés não afunda nem deriva', () => {
    const motor = motorAt(planetWorld(), {x: 0, y: 0, z: 1}, 0.5);
    drive(motor, 1, IDLE);
    const settled = {...motor.position};
    drive(motor, 4, IDLE);
    expect(motor.grounded).toBe(true);
    expect(distance(motor.position, settled)).toBeLessThan(0.02);
    expect(motor.tangentialSpeed).toBeLessThan(0.05);
  });

  it('de cabeça para baixo o salto vai para FORA do planeta', () => {
    const motor = motorAt(planetWorld(), {x: 0, y: -1, z: 0}, 2);
    drive(motor, 2, IDLE);
    expect(motor.grounded).toBe(true);
    expect(motor.position.y).toBeLessThan(-PLANET.surfaceRadius + 0.2);
    motor.fixedUpdate(STEP, {...IDLE, jump: true});
    expect(motor.jumps).toBe(1);
    // Velocidade radial positiva = afastando do centro; em Y do mundo isso é DESCER.
    expect(motor.verticalSpeed).toBeGreaterThan(5);
    expect(motor.velocity.y).toBeLessThan(-5);
  });

  it('o ápice do salto bate com o ajuste, em qualquer orientação', () => {
    const collision = planetWorld();
    for (const direction of [{x: 0, y: 0, z: 1}, {x: 0, y: -1, z: 0}, {x: -1, y: 0, z: 0}]) {
      const motor = motorAt(collision, direction, 1);
      drive(motor, 1.5, IDLE);
      let apex = motor.altitude;
      motor.fixedUpdate(STEP, {...IDLE, jump: true});
      for (let i = 0; i < 90; i++) {motor.fixedUpdate(STEP, IDLE); apex = Math.max(apex, motor.altitude);}
      expect(apex).toBeGreaterThan(t.jumpApex - 0.25);
      expect(apex).toBeLessThan(t.jumpApex + 0.25);
    }
  });
});

describe('PlanetMotor — travessia sobre a superfície curva', () => {
  it('andar para a frente cobre a distância de arco esperada sem sair do convés', () => {
    const motor = motorAt(planetWorld(), {x: 0, y: 0, z: 1}, 0.5);
    drive(motor, 1, IDLE);
    const start = {...motor.position};
    drive(motor, 6, FORWARD);
    const travelled = frame.arcDistance(start, motor.position);
    expect(motor.grounded).toBe(true);
    expect(Math.abs(motor.altitude)).toBeLessThan(0.1);
    // 6 s de caminhada com ~0,1 s de rampa de aceleração.
    expect(travelled).toBeGreaterThan(t.speed * 5.8);
    expect(travelled).toBeLessThan(t.speed * 6.05);
    expect(motor.tangentialSpeed).toBeGreaterThan(t.speed - 0.15);
  });

  it('correr é mais rápido que andar, no mesmo convés', () => {
    const collision = planetWorld();
    const walker = motorAt(collision, {x: 0, y: 0, z: 1}, 0.5);
    const runner = motorAt(collision, {x: 0, y: 0, z: 1}, 0.5);
    drive(walker, 1, IDLE); drive(runner, 1, IDLE);
    const from = {...walker.position};
    drive(walker, 5, FORWARD); drive(runner, 5, SPRINT);
    expect(frame.arcDistance(from, runner.position)).toBeGreaterThan(frame.arcDistance(from, walker.position) * 1.4);
  });

  it('a frente do personagem continua tangente e a base permanece ortonormal', () => {
    const motor = motorAt(planetWorld(), {x: 0, y: 0, z: 1}, 0.5);
    drive(motor, 1, IDLE);
    let worst = 0;
    for (let i = 0; i < 60 * 30; i++) {
      motor.fixedUpdate(STEP, FORWARD);
      const b = motor.basis;
      worst = Math.max(worst, Math.abs(dot(b.forward, b.up)), Math.abs(length(b.forward) - 1),
        distance(b.right, cross(b.up, b.forward)));
    }
    expect(worst).toBeLessThan(1e-9);
    const q = motor.rotation;
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
  });

  it('atravessa a ponte polar e chega ao polo norte de pé', () => {
    const motor = motorAt(planetWorld(), {x: 0, y: 0, z: 1}, 0.5, {x: 0, y: 1, z: 0});
    drive(motor, 1, IDLE);
    let grounded = 0, steps = 0;
    // Um quarto de volta: 314,16 m a 6,8 m/s ≈ 46,2 s.
    for (; steps < 60 * 52 && frame.arcDistance(motor.position, frame.fromDirection({x: 0, y: 1, z: 0})) > 0.8; steps++) {
      motor.fixedUpdate(STEP, SPRINT);
      if (motor.grounded) grounded++;
    }
    expect(motor.recoveries).toBe(0);
    expect(grounded / steps).toBeGreaterThan(0.97);
    expect(frame.arcDistance(motor.position, frame.fromDirection({x: 0, y: 1, z: 0}))).toBeLessThan(0.8);
    expect(distance(motor.up, {x: 0, y: 1, z: 0})).toBeLessThan(0.02);
    expect(Math.abs(motor.altitude)).toBeLessThan(0.1);
  });

  it('segue em frente PELO polo e continua descendo do outro lado', () => {
    const start = frame.fromDirection({x: 0, y: 0, z: 1});
    const motor = motorAt(planetWorld(), {x: 0, y: 0, z: 1}, 0.5, {x: 0, y: 1, z: 0});
    drive(motor, 1, IDLE);
    // 314,16 m até o polo + 55 m para dentro da vertente oposta da ilha polar (raio 72 m).
    const target = frame.circumference / 4 + 55;
    for (let i = 0; i < 60 * 70 && frame.arcDistance(start, motor.position) < target; i++) {
      motor.fixedUpdate(STEP, SPRINT);
    }
    expect(motor.recoveries).toBe(0);
    expect(motor.grounded).toBe(true);
    expect(frame.arcDistance(start, motor.position)).toBeGreaterThan(target - 1);
    // Passou do polo: o corpo está na vertente que olha para `back`, com z negativo.
    expect(motor.position.z).toBeLessThan(-20);
    expect(motor.position.y).toBeGreaterThan(180);
    // Continua de pé: a vertical local ainda é radial, agora inclinada para o lado oposto.
    expect(dot(motor.up, {x: 0, y: 1, z: 0})).toBeGreaterThan(0.9);
    expect(dot(motor.up, {x: 0, y: 0, z: 1})).toBeLessThan(-0.1);
    expect(Math.abs(motor.altitude)).toBeLessThan(0.2);
  });

  it('andar para fora da borda da ilha polar cai no vazio e recupera num convés real', () => {
    const start = frame.fromDirection({x: 0, y: 0, z: 1});
    const collision = planetWorld();
    const motor = motorAt(collision, {x: 0, y: 0, z: 1}, 0.5, {x: 0, y: 1, z: 0});
    drive(motor, 1, IDLE);
    // Além do polo NÃO existe ponte para `back`: a borda da ilha (72 m) é o fim do caminho.
    for (let i = 0; i < 60 * 120 && motor.recoveries === 0; i++) motor.fixedUpdate(STEP, SPRINT);
    expect(motor.recoveries).toBe(1);
    expect(frame.arcDistance(start, motor.position)).toBeLessThan(frame.circumference / 4 + frame.islandRadius + 5);
    drive(motor, 1, IDLE);
    expect(motor.grounded).toBe(true);
    const sample = collision.supportBelow(motor.position, motor.up, 0.3, 1);
    expect(sample).toBeDefined();
    expect(sample!.slopeDegrees).toBeLessThanOrEqual(t.maxSlopeDegrees);
  });

  it('VOLTA COMPLETA: o anel equatorial devolve o jogador à mesma ilha', () => {
    const start = frame.fromDirection({x: 0, y: 0, z: 1});
    const motor = motorAt(planetWorld(), {x: 0, y: 0, z: 1}, 0.5, {x: 1, y: 0, z: 0});
    drive(motor, 1, IDLE);
    let travelled = 0, grounded = 0, steps = 0, farthest = 0, worstAltitude = 0;
    let previous = {...motor.position};
    for (; steps < 60 * 230 && travelled < frame.circumference; steps++) {
      motor.fixedUpdate(STEP, SPRINT);
      travelled += distance(previous, motor.position);
      previous = {...motor.position};
      if (motor.grounded) grounded++;
      farthest = Math.max(farthest, frame.arcDistance(start, motor.position));
      worstAltitude = Math.max(worstAltitude, Math.abs(motor.altitude));
    }
    expect(travelled).toBeGreaterThanOrEqual(frame.circumference);
    // Chegou ao antípoda no meio do caminho — não foi um passeio em círculo pequeno.
    expect(farthest).toBeGreaterThan(frame.circumference / 2 - 3);
    expect(motor.recoveries).toBe(0);
    expect(grounded / steps).toBeGreaterThan(0.97);
    expect(worstAltitude).toBeLessThan(0.6);
    expect(frame.arcDistance(start, motor.position)).toBeLessThan(4);
    expect(distance(motor.up, {x: 0, y: 0, z: 1})).toBeLessThan(0.03);
  });
});

describe('PlanetMotor — apoio, degrau e escorregamento', () => {
  it('sobe um degrau abaixo de stepHeight e é barrado por um murete alto', () => {
    const at = frame.fromDirection({x: 0, y: 0, z: 1});
    const heading = frame.basisAt(at, {x: 0, y: 1, z: 0}).forward;
    // Plataforma de 10 m de comprimento começando 2 m à frente do jogador. O bloco é plano no
    // plano tangente do próprio centro, então mantê-lo curto evita que as pontas subam pela
    // curvatura e virem um degrau alto demais — isso é limite do fixture, não do motor.
    const build = (height: number): PlanetCollision => planetWorld(soup => {
      tangentSlab(soup, frame, frame.geodesicStep(at, scale(heading, 7)).position,
        {along: 10, across: 14, height, heading: {x: 0, y: 1, z: 0}});
    });
    const low = motorAt(build(0.35), {x: 0, y: 0, z: 1}, 0.5, {x: 0, y: 1, z: 0});
    drive(low, 1, IDLE); drive(low, 2.2, FORWARD);
    expect(low.grounded).toBe(true);
    expect(low.altitude).toBeGreaterThan(0.3);
    expect(frame.arcDistance(at, low.position)).toBeGreaterThan(8);

    const high = motorAt(build(1.5), {x: 0, y: 0, z: 1}, 0.5, {x: 0, y: 1, z: 0});
    drive(high, 1, IDLE); drive(high, 2.2, FORWARD);
    expect(high.grounded).toBe(true);
    expect(high.altitude).toBeLessThan(0.3);
    // Parou encostado na face, a um raio de cápsula dela.
    expect(frame.arcDistance(at, high.position)).toBeGreaterThan(1.4);
    expect(frame.arcDistance(at, high.position)).toBeLessThan(2.1);
  });

  it('escorrega numa face acima da inclinação máxima em vez de ficar pendurado', () => {
    const at = frame.fromDirection({x: 0, y: 0, z: 1});
    const heading = frame.basisAt(at, {x: 0, y: 1, z: 0}).forward;
    const ramp = frame.geodesicStep(at, scale(heading, 5)).position;
    const collision = planetWorld(soup => {
      // 10 m de avanço subindo 20 m ⇒ 63,4°, bem acima dos 50° jogáveis.
      tangentSlab(soup, frame, ramp, {along: 10, across: 16, height: 0.1, riseAlong: 20, heading: {x: 0, y: 1, z: 0}});
    });
    // Cai 3 m sobre a face a 3 m do pé da rampa, onde ela já está a 6,1 m de altura.
    const drop = frame.geodesicStep(at, scale(heading, 3)).position;
    const motor = new PlanetMotor({
      frame, collision,
      spawn: add(drop, scale(frame.up(drop), 9)),
      heading: {x: 0, y: 1, z: 0},
    });
    let slid = false, contact = 0;
    for (let i = 0; i < 60 * 5; i++) {
      motor.fixedUpdate(STEP, IDLE);
      if (motor.sliding && contact === 0) contact = motor.altitude;
      slid ||= motor.sliding;
    }
    expect(slid).toBe(true);
    expect(motor.slides).toBeGreaterThan(0);
    // Escorregou ladeira abaixo: terminou bem mais baixo do que o ponto do primeiro contato.
    expect(motor.altitude).toBeLessThan(contact - 2);
    expect(motor.grounded || motor.sliding || motor.altitude < 1).toBe(true);
  });
});

describe('PlanetMotor — recuperação de queda', () => {
  it('cair no vão entre ilhas devolve o jogador a um apoio real da ilha', () => {
    const collision = planetWorld();
    const motor = motorAt(collision, {x: 0, y: 0, z: 1}, 0.5);
    drive(motor, 1.5, IDLE);
    expect(motor.grounded).toBe(true);
    const safe = {...motor.safe};
    expect(frame.arcDistance(safe, frame.fromDirection({x: 0, y: 0, z: 1}))).toBeLessThan(1);

    // Empurrado para o vazio sobre um trecho sem ilha nem ponte.
    motor.teleport(frame.fromDirection(normalize({x: 0.7, y: 0.7, z: 0.2}), 4));
    drive(motor, 8, IDLE);
    expect(motor.recoveries).toBe(1);
    expect(motor.grounded).toBe(true);
    expect(Math.abs(motor.altitude)).toBeLessThan(0.2);
    const sample = collision.supportBelow(motor.position, motor.up, 0.3, 1);
    expect(sample).toBeDefined();
    expect(sample!.slopeDegrees).toBeLessThanOrEqual(t.maxSlopeDegrees);
  });

  it('avisa o consumidor com a fração de dano do contrato', () => {
    let damage = 0;
    const motor = new PlanetMotor({
      frame, collision: planetWorld(),
      spawn: frame.fromDirection({x: 0, y: 0, z: 1}, 0.5),
      listener: {recovered: fraction => {damage = fraction;}},
    });
    drive(motor, 1.5, IDLE);
    motor.teleport(frame.fromDirection(normalize({x: 0.7, y: 0.7, z: 0.2}), 4));
    drive(motor, 8, IDLE);
    expect(damage).toBeCloseTo(t.voidDamageFraction, 9);
  });

  it('avisa o pouso com a velocidade de impacto', () => {
    let impact = -1;
    const motor = new PlanetMotor({
      frame, collision: planetWorld(),
      spawn: frame.fromDirection({x: 0, y: 0, z: 1}, 8),
      listener: {landed: value => {if (impact < 0) impact = value;}},
    });
    drive(motor, 3, IDLE);
    expect(motor.grounded).toBe(true);
    // Queda livre de 8 m a 20 m/s² ⇒ ~17,9 m/s.
    expect(impact).toBeGreaterThan(14);
    expect(impact).toBeLessThan(20);
  });

  it('o ponto seguro só é gravado sobre apoio caminhável', () => {
    const motor = motorAt(planetWorld(), {x: 0, y: 0, z: 1}, 0.5);
    const spawn = {...motor.safe};
    drive(motor, 3, FORWARD);
    expect(frame.arcDistance(spawn, motor.safe)).toBeGreaterThan(1);
    expect(Math.abs(frame.altitude(motor.safe))).toBeLessThan(0.2);
  });
});

describe('PlanetMotor — orientação sem yaw global', () => {
  it('girar no plano tangente preserva tangência inclusive no polo', () => {
    const motor = motorAt(planetWorld(), {x: 0, y: 1, z: 0}, 0.5);
    drive(motor, 1.5, IDLE);
    let worst = 0;
    for (let i = 0; i < 720; i++) {
      motor.turn(Math.PI / 180);
      worst = Math.max(worst, Math.abs(dot(motor.forward, motor.up)), Math.abs(length(motor.forward) - 1));
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('a marcha é reorientada por uma direção de mundo qualquer', () => {
    const motor = motorAt(planetWorld(), {x: 0, y: 0, z: 1}, 0.5);
    drive(motor, 1, IDLE);
    motor.setHeading({x: 3, y: 9, z: 0});
    expect(dot(motor.forward, motor.up)).toBeCloseTo(0, 12);
    expect(dot(motor.forward, {x: 0, y: 1, z: 0})).toBeGreaterThan(0.9);
    // Uma dica paralela à vertical não destrói a marcha anterior.
    const before = {...motor.forward};
    motor.setHeading(motor.up);
    expect(distance(motor.forward, before)).toBeLessThan(1e-12);
  });
});

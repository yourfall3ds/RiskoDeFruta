import {describe, expect, it} from 'vitest';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents, Vec3} from '../src/core/contracts';
import type {InputFrame} from '../src/input/InputFrame';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {PLAYER_TUNING as t} from '../src/player/PlayerTuning';
import {PLANET, PlanetFrame, cross, distance, dot, length, normalize, scale} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {BRIDGE_SPANS, ISLAND_SLOTS, islandSlot} from '../src/planet/PlanetLayout';
import {TriangleSoup, bridgeDeck, islandDeck, tangentSlab} from './planet-fixture';

/**
 * O MESMO `PlayerMotor` do jogo, agora sobre o planeta literal.
 *
 * O que estes testes travam:
 *   1. o caminho plano continua sendo o caminho plano (`kind === 'flat'`, `yaw` global);
 *   2. toda habilidade original existe e funciona nos SEIS polos, com gravidade radial de verdade;
 *   3. as MEDIDAS de toque (apex de salto, distância de esquiva, distância de dash, velocidade de
 *      caminhada e corrida, cargas, i-frames) batem entre mundo plano e mundo esfera — é isso que
 *      prova que não há um segundo motor simplificado por baixo;
 *   4. pouso, queda no vazio e volta ao apoio real.
 */

const frame = new PlanetFrame(PLANET);
const STEP = 1 / 60;
const IDLE: InputFrame = {x: 0, z: 0, jump: false, dodge: false, fire: false, charging: false};
const FORWARD: InputFrame = {...IDLE, z: 1};

function planetCollision(extra?: (soup: TriangleSoup) => void): PlanetCollision {
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

interface Rig {motor: PlayerMotor; events: EventBus<GameEvents>; skills: string[]; dodges: Vec3[]; world: CollisionWorld}

function radialRig(direction: Vec3, altitude = 0.05, extra?: (soup: TriangleSoup) => void): Rig {
  const world = new CollisionWorld();
  world.configurePlanet(frame, planetCollision(extra));
  return rig(world, frame.fromDirection(direction, altitude));
}

/** Planície plana equivalente: o oráculo de toque contra o qual o planeta é medido. */
function flatRig(): Rig {
  const world = new CollisionWorld();
  world.surfaces.push({id: 'plain', x: 0, z: 0, width: 4000, depth: 4000, height: 0});
  return rig(world, {x: 0, y: 0, z: 0});
}

function rig(world: CollisionWorld, spawn: Vec3): Rig {
  const events = new EventBus<GameEvents>();
  const skills: string[] = [], dodges: Vec3[] = [];
  events.on('SkillUsed', ({skillId}) => skills.push(skillId));
  events.on('Dodged', ({direction}) => dodges.push(direction));
  return {motor: new PlayerMotor(world, events, spawn), events, skills, dodges, world};
}

/** Marcha sempre na frente TANGENTE do corpo — o que a câmera do planeta entrega. */
function drive(rig: Rig, seconds: number, input: InputFrame): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) rig.motor.fixedUpdate(STEP, input, {...rig.motor.forward});
}

/** Distância caminhada segundo a própria superfície: arco no planeta, hipotenusa no plano. */
const walked = (rig: Rig, from: Vec3): number => rig.world.surface.planarDistance(from, rig.motor.position);

describe('PlayerMotor — o mundo plano continua exatamente o mundo plano', () => {
  it('sem configurePlanet o motor é plano, com yaw GLOBAL e up (0,1,0)', () => {
    const {motor} = flatRig();
    expect(motor.spherical).toBe(false);
    expect(motor.up).toEqual({x: 0, y: 1, z: 0});
    expect(motor.reference).toEqual({x: 0, y: 0, z: 1});
    motor.fixedUpdate(STEP, IDLE, 0.8);
    // `yaw` numérico é o yaw de mundo de sempre, e a frente é (sin yaw, 0, cos yaw).
    expect(motor.yaw).toBe(0.8);
    expect(motor.forward.x).toBeCloseTo(Math.sin(0.8), 12);
    expect(motor.forward.z).toBeCloseTo(Math.cos(0.8), 12);
    expect(motor.forward.y).toBe(0);
    // Uma frente de MUNDO também é aceita e vira o mesmo yaw.
    motor.fixedUpdate(STEP, IDLE, {x: Math.sin(-0.4), y: 7, z: Math.cos(-0.4)});
    expect(motor.yaw).toBeCloseTo(-0.4, 12);
  });

  it('andar para a frente no plano cobre a distância de sempre', () => {
    const flat = flatRig();
    drive(flat, 0.5, IDLE);
    const from = {...flat.motor.position};
    drive(flat, 3, FORWARD);
    expect(flat.motor.grounded).toBe(true);
    expect(flat.motor.position.y).toBe(0);
    expect(walked(flat, from)).toBeGreaterThan(t.speed * 2.85);
    expect(walked(flat, from)).toBeLessThan(t.speed * 3.05);
  });
});

describe('PlayerMotor — gravidade radial de verdade nos seis polos', () => {
  it('cai na direção do CENTRO e assenta no convés em qualquer lado do planeta', () => {
    for (const slot of ISLAND_SLOTS) {
      const r = radialRig(slot.direction, 6);
      drive(r, 2.5, IDLE);
      expect(r.motor.spherical).toBe(true);
      expect(r.motor.grounded).toBe(true);
      expect(Math.abs(r.motor.altitude)).toBeLessThan(0.12);
      expect(distance(r.motor.up, normalize(slot.direction))).toBeLessThan(1e-9);
      // A queda foi radial: no polo sul foi para −Y, na ilha leste foi para −X.
      expect(dot(normalize(r.motor.position), normalize(slot.direction))).toBeCloseTo(1, 9);
    }
  });

  it('de cabeça para baixo o salto vai para FORA do planeta', () => {
    const r = radialRig({x: 0, y: -1, z: 0}, 2);
    drive(r, 2, IDLE);
    expect(r.motor.grounded).toBe(true);
    expect(r.motor.position.y).toBeLessThan(-PLANET.surfaceRadius + 0.3);
    r.motor.fixedUpdate(STEP, {...IDLE, jump: true}, {...r.motor.forward});
    expect(r.motor.jumps).toBe(1);
    expect(r.skills).toContain('jump');
    // Radial positiva = afastando do centro; em Y de mundo isso é DESCER.
    expect(r.motor.verticalSpeed).toBeGreaterThan(5);
    expect(r.motor.velocity.y).toBeLessThan(-5);
  });

  it('parado no convés não afunda nem deriva', () => {
    const r = radialRig({x: 0, y: 0, z: 1}, 0.5);
    drive(r, 1, IDLE);
    const settled = {...r.motor.position};
    drive(r, 4, IDLE);
    expect(r.motor.grounded).toBe(true);
    expect(distance(r.motor.position, settled)).toBeLessThan(0.03);
    expect(r.motor.tangentialSpeed).toBeLessThan(0.06);
  });

  it('a base do corpo continua ortonormal e o quaternion unitário durante 30 s de corrida', () => {
    const r = radialRig({x: 0, y: 0, z: 1}, 0.5);
    drive(r, 1, IDLE);
    r.motor.sprinting = true;
    let worst = 0;
    for (let i = 0; i < 60 * 30; i++) {
      r.motor.sprinting = true;
      r.motor.fixedUpdate(STEP, FORWARD, {...r.motor.forward});
      const b = r.motor.basis;
      worst = Math.max(worst, Math.abs(dot(b.forward, b.up)), Math.abs(length(b.forward) - 1),
        distance(b.right, cross(b.up, b.forward)));
    }
    expect(worst).toBeLessThan(1e-9);
    const q = r.motor.rotation;
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
  });

  it('VOLTA COMPLETA pelo anel equatorial: fecha sem deriva e sem perder o apoio', () => {
    const start = frame.fromDirection({x: 0, y: 0, z: 1});
    const r = radialRig({x: 0, y: 0, z: 1}, 0.5);
    drive(r, 1, IDLE);
    r.motor.setHeading({x: 1, y: 0, z: 0});
    let travelled = 0, grounded = 0, steps = 0, farthest = 0, worstAltitude = 0;
    let previous = {...r.motor.position};
    for (; steps < 60 * 240 && travelled < frame.circumference; steps++) {
      r.motor.sprinting = true;
      r.motor.fixedUpdate(STEP, FORWARD, {...r.motor.forward});
      travelled += distance(previous, r.motor.position);
      previous = {...r.motor.position};
      if (r.motor.grounded) grounded++;
      farthest = Math.max(farthest, frame.arcDistance(start, r.motor.position));
      worstAltitude = Math.max(worstAltitude, Math.abs(r.motor.altitude));
    }
    expect(travelled).toBeGreaterThanOrEqual(frame.circumference);
    // Passou pelo antípoda: não foi um círculo pequeno.
    expect(farthest).toBeGreaterThan(frame.circumference / 2 - 4);
    expect(r.motor.respawns).toBe(0);
    expect(grounded / steps).toBeGreaterThan(0.95);
    expect(worstAltitude).toBeLessThan(0.8);
    expect(frame.arcDistance(start, r.motor.position)).toBeLessThan(5);
    expect(distance(r.motor.up, {x: 0, y: 0, z: 1})).toBeLessThan(0.04);
  });
});

describe('PlayerMotor — paridade de habilidades entre plano e planeta', () => {
  /** Mede um conjunto de números de toque, com a marcha sempre alinhada à frente do corpo. */
  function measure(make: () => Rig): Record<string, number> {
    const r = make();
    drive(r, 1, IDLE);
    const from = {...r.motor.position};

    // Caminhada
    drive(r, 3, FORWARD);
    const walk = walked(r, from);
    const walkSpeed = r.motor.tangentialSpeed;

    // Corrida
    const sprintFrom = {...r.motor.position};
    for (let i = 0; i < 180; i++) {r.motor.sprinting = true; r.motor.fixedUpdate(STEP, FORWARD, {...r.motor.forward});}
    const sprint = walked(r, sprintFrom);
    r.motor.sprinting = false;
    drive(r, 1, IDLE);

    // Salto: ápice medido em ALTITUDE, que no planeta é raio − R.
    const base = r.motor.altitude;
    r.motor.fixedUpdate(STEP, {...IDLE, jump: true}, {...r.motor.forward});
    let apex = r.motor.altitude;
    for (let i = 0; i < 90; i++) {r.motor.fixedUpdate(STEP, IDLE, {...r.motor.forward}); apex = Math.max(apex, r.motor.altitude);}
    drive(r, 1, IDLE);

    // Esquiva: distância e i-frames
    const dodgeFrom = {...r.motor.position};
    r.motor.fixedUpdate(STEP, {...IDLE, dodge: true}, {...r.motor.forward});
    const iframes = r.motor.invulnerable;
    const chargesLeft = r.motor.charges;
    for (let i = 0; i < Math.round(t.dodgeSeconds / STEP) + 4; i++) r.motor.fixedUpdate(STEP, IDLE, {...r.motor.forward});
    const dodge = walked(r, dodgeFrom);
    drive(r, 1, IDLE);

    // Dash: duplo toque explícito em `input.dash`
    const dashFrom = {...r.motor.position};
    r.motor.fixedUpdate(STEP, {...IDLE, z: 1, dash: true}, {...r.motor.forward});
    for (let i = 0; i < Math.round(t.dashSeconds / STEP) + 4; i++) r.motor.fixedUpdate(STEP, IDLE, {...r.motor.forward});
    const dash = walked(r, dashFrom);
    const dashCooldown = r.motor.dashCooldown;
    drive(r, 2, IDLE);

    // Salto aéreo extra
    r.motor.extraJumps = 1;
    r.motor.fixedUpdate(STEP, {...IDLE, jump: true}, {...r.motor.forward});
    for (let i = 0; i < 12; i++) r.motor.fixedUpdate(STEP, IDLE, {...r.motor.forward});
    r.motor.fixedUpdate(STEP, {...IDLE, jump: true}, {...r.motor.forward});
    const airJumps = r.motor.airJumpsUsed;
    for (let i = 0; i < 120; i++) r.motor.fixedUpdate(STEP, IDLE, {...r.motor.forward});
    drive(r, 1, IDLE);

    // Backflip
    const flipFrom = {...r.motor.position};
    r.motor.barrageRetreat();
    expect(r.motor.backflipProgress).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 60; i++) r.motor.fixedUpdate(STEP, IDLE, {...r.motor.forward});
    const flip = walked(r, flipFrom);
    drive(r, 1.5, IDLE);

    // Knockback com direção de MUNDO (a frente tangente do corpo)
    const pushFrom = {...r.motor.position};
    r.motor.knockback({...r.motor.forward}, 14);
    for (let i = 0; i < 60; i++) r.motor.fixedUpdate(STEP, IDLE, {...r.motor.forward});
    const push = walked(r, pushFrom);

    // Dano, armadura e regeneração
    r.motor.armor = 100;
    r.motor.invulnerable = 0;
    const before = r.motor.hp;
    r.motor.applyDamage({
      attackerId: 2, victimId: 1, sourceId: 'praga', attackId: 'bite', baseDamage: 40, finalDamage: 40,
      crit: false, procCoefficient: 1, procChainDepth: 0, damageTags: ['melee'],
      hitPosition: {...r.motor.position}, hitNormal: {...r.motor.up},
      forceDirection: {...r.motor.forward}, forceMagnitude: 6,
    });
    const damage = before - r.motor.hp;
    r.motor.regenerationDelay = 0;
    drive(r, 2, IDLE);
    const regenerated = r.motor.hp - (before - damage);

    return {
      walk, walkSpeed, sprint, apex: apex - base, dodge, dash, dashCooldown, iframes,
      chargesLeft, airJumps, flip, push, damage, regenerated,
      jumps: r.motor.jumps, dodgeCount: r.motor.dodges, dashes: r.motor.dashes,
      skills: r.skills.length, respawns: r.motor.respawns,
    };
  }

  it('as mesmas entradas produzem os mesmos números de toque nos dois mundos', () => {
    const flat = measure(flatRig);
    const planet = measure(() => radialRig({x: 0, y: 0, z: 1}, 0.05));

    // Contagens de habilidade: IGUAIS, não aproximadas.
    for (const key of ['jumps', 'dodgeCount', 'dashes', 'airJumps', 'chargesLeft', 'skills', 'respawns'] as const) {
      expect(planet[key], key).toBe(flat[key]);
    }
    expect(planet.respawns).toBe(0);
    // Armadura de 100 corta o dano pela metade nos dois: 40 → 20.
    expect(planet.damage).toBeCloseTo(20, 9);
    expect(planet.damage).toBeCloseTo(flat.damage!, 9);
    expect(planet.regenerated).toBeCloseTo(flat.regenerated!, 6);
    expect(planet.iframes).toBeCloseTo(flat.iframes!, 9);
    expect(planet.dashCooldown).toBeCloseTo(flat.dashCooldown!, 9);

    // Medidas de deslocamento: dentro de 2 % — a diferença é a curvatura do convés facetado.
    const near = (key: string, tolerance: number): void => {
      expect(Math.abs(planet[key]! - flat[key]!), `${key}: plano ${flat[key]} vs planeta ${planet[key]}`)
        .toBeLessThan(tolerance);
    };
    near('walk', Math.abs(flat.walk!) * 0.02);
    near('walkSpeed', 0.1);
    near('sprint', Math.abs(flat.sprint!) * 0.02);
    near('apex', 0.12);
    near('dodge', Math.abs(flat.dodge!) * 0.03);
    near('dash', Math.abs(flat.dash!) * 0.03);
    near('flip', Math.abs(flat.flip!) * 0.06 + 0.05);
    near('push', Math.abs(flat.push!) * 0.06 + 0.05);

    // E os valores absolutos são os do ajuste original, não números inventados.
    expect(planet.apex).toBeGreaterThan(t.jumpApex - 0.2);
    expect(planet.apex).toBeLessThan(t.jumpApex + 0.2);
    expect(planet.dodge).toBeGreaterThan(t.dodgeDistance * 0.9);
    expect(planet.dash).toBeGreaterThan(t.dashDistance * 0.85);
    expect(planet.sprint! / planet.walk!).toBeGreaterThan(1.4);
  });

  it('a esquiva do planeta emite direção de MUNDO tangente e gasta carga com i-frames', () => {
    const r = radialRig({x: 0, y: -1, z: 0}, 0.05);
    drive(r, 1.5, IDLE);
    expect(r.motor.charges).toBe(t.dodgeCharges);
    r.motor.fixedUpdate(STEP, {...IDLE, x: 1, dodge: true}, {...r.motor.forward});
    expect(r.motor.charges).toBe(t.dodgeCharges - 1);
    expect(r.motor.invulnerable).toBeCloseTo(t.dodgeIFrames, 9);
    expect(r.dodges).toHaveLength(1);
    const direction = r.dodges[0]!;
    expect(length(direction)).toBeCloseTo(1, 9);
    // Tangente à superfície no polo sul: perpendicular à radial, e NÃO um vetor com y=0 do mundo.
    // O evento sai no INÍCIO do passo, então a tangência é medida na vertical daquele instante —
    // depois do passo a vertical já girou o arco andado, e é por isso a folga de 1e-3 e não 0.
    expect(Math.abs(dot(direction, r.motor.up))).toBeLessThan(1e-3);
    expect(distance(r.motor.dodgeWorldDirection, direction)).toBeLessThan(1e-3);
    expect(Math.abs(dot(r.motor.dodgeWorldDirection, r.motor.up))).toBeLessThan(1e-12);
    // A carga volta com o tempo, no mesmo ritmo do ajuste.
    drive(r, t.dodgeRechargeSeconds + 0.1, IDLE);
    expect(r.motor.charges).toBe(t.dodgeCharges);
  });

  it('wall jump numa face vertical do planeta, uma vez por parede', () => {
    const at = frame.fromDirection({x: 1, y: 0, z: 0}, 0.05);
    const heading = frame.basisAt(at, {x: 0, y: 1, z: 0}).forward;
    const r = radialRig({x: 1, y: 0, z: 0}, 0.05, soup => {
      tangentSlab(soup, frame, frame.geodesicStep(at, scale(heading, 2.2)).position,
        {along: 1, across: 24, height: 6, heading: {x: 0, y: 1, z: 0}});
    });
    drive(r, 1, IDLE);
    r.motor.setHeading(heading);
    // Salta e continua avançando contra a parede: o contato no ombro habilita o wall jump.
    r.motor.fixedUpdate(STEP, {...IDLE, z: 1, jump: true}, {...r.motor.forward});
    for (let i = 0; i < 90 && r.motor.wallJumps === 0; i++) {
      r.motor.fixedUpdate(STEP, {...IDLE, z: 1, jump: true}, {...r.motor.forward});
    }
    expect(r.motor.wallJumps).toBe(1);
    expect(r.skills).toContain('wall_jump');
    // Empurrado para LONGE da parede, ao longo da tangente, e com subida radial.
    expect(r.motor.verticalSpeed).toBeGreaterThan(5);
    expect(dot(r.motor.velocity, heading)).toBeLessThan(0);
  });

  it('o dash aéreo tem uma carga só, e ela volta ao pousar', () => {
    const r = radialRig({x: -1, y: 0, z: 0}, 0.05);
    drive(r, 1, IDLE);
    r.motor.fixedUpdate(STEP, {...IDLE, jump: true}, {...r.motor.forward});
    r.motor.fixedUpdate(STEP, {...IDLE, z: 1, dash: true}, {...r.motor.forward});
    expect(r.motor.dashes).toBe(1);
    // Segunda tentativa no ar: sem carga (e o cooldown também barra).
    for (let i = 0; i < 20; i++) r.motor.fixedUpdate(STEP, IDLE, {...r.motor.forward});
    r.motor.fixedUpdate(STEP, {...IDLE, z: 1, dash: true}, {...r.motor.forward});
    expect(r.motor.dashes).toBe(1);
    drive(r, 3, IDLE);
    expect(r.motor.grounded).toBe(true);
    r.motor.fixedUpdate(STEP, {...IDLE, z: 1, dash: true}, {...r.motor.forward});
    expect(r.motor.dashes).toBe(2);
  });
});

describe('PlayerMotor — pouso, vazio e volta ao apoio no planeta', () => {
  it('pousa de uma queda de 8 m sem atravessar o convés', () => {
    const r = radialRig({x: 0, y: 0, z: 1}, 8);
    let worst = 0;
    for (let i = 0; i < 180; i++) {
      r.motor.fixedUpdate(STEP, IDLE, {...r.motor.forward});
      worst = Math.min(worst, r.motor.altitude);
    }
    expect(r.motor.grounded).toBe(true);
    expect(Math.abs(r.motor.altitude)).toBeLessThan
      (0.12);
    // Nunca ficou abaixo do convés: a cápsula não passou pelo chão.
    expect(worst).toBeGreaterThan(-0.2);
  });

  it('cair no vão entre ilhas cobra dano de vazio e devolve a um apoio REAL', () => {
    const r = radialRig({x: 0, y: 0, z: 1}, 0.5);
    drive(r, 1.5, IDLE);
    expect(r.motor.grounded).toBe(true);
    const safe = {...r.motor.safe};
    expect(frame.arcDistance(safe, frame.fromDirection({x: 0, y: 0, z: 1}))).toBeLessThan(1.5);

    // Empurrado para o vazio sobre um trecho sem ilha nem ponte.
    Object.assign(r.motor.position, frame.fromDirection(normalize({x: 0.7, y: 0.7, z: 0.2}), 4));
    r.motor.grounded = false;
    r.motor.invulnerable = 0;
    const hp = r.motor.hp;
    for (let i = 0; i < 60 * 12 && r.motor.respawns === 0; i++) r.motor.fixedUpdate(STEP, IDLE, {...r.motor.forward});
    expect(r.motor.respawns).toBe(1);
    expect(hp - r.motor.hp).toBeCloseTo(t.maxHP * t.voidDamageFraction, 6);
    drive(r, 1, IDLE);
    expect(r.motor.grounded).toBe(true);
    // O destino tem apoio caminhável medido, não é um piso falso em y = 0.
    const support = r.world.surface.support(r.motor.position, 0.4, 1, t.maxSlopeDegrees);
    expect(support).toBeDefined();
    expect(Math.abs(support!.offset)).toBeLessThan(0.15);
    expect(Math.abs(frame.radius(r.motor.position) - PLANET.surfaceRadius)).toBeLessThan(0.3);
  });

  it('o vazio do planeta é RAIO, não "y < −25": o polo sul cai com y positivo crescente', () => {
    const r = radialRig({x: 0, y: -1, z: 0}, 0.5);
    drive(r, 1.5, IDLE);
    expect(r.motor.position.y).toBeLessThan(-PLANET.surfaceRadius + 0.3);
    Object.assign(r.motor.position, frame.fromDirection(normalize({x: 0.6, y: -0.75, z: 0.28}), 2));
    r.motor.grounded = false;
    for (let i = 0; i < 60 * 12 && r.motor.respawns === 0; i++) r.motor.fixedUpdate(STEP, IDLE, {...r.motor.forward});
    expect(r.motor.respawns).toBe(1);
    expect(frame.radius(r.motor.position)).toBeGreaterThan(frame.voidRadius);
  });

  it('o ponto seguro só é gravado sobre apoio caminhável e acompanha a caminhada', () => {
    const r = radialRig({x: 0, y: 1, z: 0}, 0.5);
    drive(r, 1, IDLE);
    const spawn = {...r.motor.safe};
    drive(r, 3, FORWARD);
    expect(frame.arcDistance(spawn, r.motor.safe)).toBeGreaterThan(1);
    expect(Math.abs(frame.altitude(r.motor.safe))).toBeLessThan(0.25);
  });

  it('nascer enfiado no convés desencrava sem teleportar para o outro lado do planeta', () => {
    const r = radialRig({x: 0, y: 0, z: -1}, -0.25);
    const buried = {...r.motor.position};
    drive(r, 1.5, IDLE);
    expect(r.motor.grounded).toBe(true);
    expect(r.motor.altitude).toBeGreaterThan(-0.1);
    expect(frame.arcDistance(buried, r.motor.position)).toBeLessThan(2);
    expect(r.motor.respawns).toBe(0);
  });
});

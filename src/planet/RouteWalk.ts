import type {Vec3} from '../core/contracts';
import {PLANET_MOTOR_TUNING, PlanetMotor, type PlanetInput} from './PlanetMotor';
import type {PlanetCollision} from './PlanetCollision';
import {PlanetFrame, add, copy, distance, dot, length, normalize, reject, scale, sub} from './PlanetFrame';

/**
 * Condutor de QA: leva um `PlanetMotor` por uma polilinha de rota real e MEDE a travessia.
 *
 * Existe para que o teste de integração e o script de auditoria meçam exatamente a mesma coisa.
 * Não é IA de jogo: não desvia de obstáculo, não pula por conta própria, não improvisa caminho.
 * Se a arte barra o corpo, a travessia PARA e o ponto exato é registrado — a política é reportar
 * o bloqueio, nunca disfarçá-lo empurrando o corpo através da geometria.
 */

export interface RouteWalkOptions {
  dt: number;
  sprint: boolean;
  /** Distância para dar o waypoint por visitado e mirar o próximo. */
  arriveRadius: number;
  /** Distância do último waypoint que conta como travessia concluída. */
  endpointRadius: number;
  /** Teto duro de tempo simulado. */
  maxSeconds: number;
  /** Janela sem avanço ao longo da rota que caracteriza corpo preso. */
  stallSeconds: number;
  /** Avanço mínimo exigido dentro da janela, em metros. */
  stallProgress: number;
  /** Ticks entre sondagens de apoio (diagnóstico de flutuação), 1 = todo tick. */
  probeEvery: number;
}

export const ROUTE_WALK_DEFAULTS: RouteWalkOptions = {
  dt: 1 / 60,
  sprint: true,
  arriveRadius: 2,
  endpointRadius: 3,
  maxSeconds: 90,
  stallSeconds: 2.5,
  stallProgress: 0.35,
  probeEvery: 3,
};

export interface RouteBlockage {
  /** Índice do waypoint que o corpo estava perseguindo quando parou. */
  waypoint: number;
  position: Vec3;
  /** `wall`, `buried`, `no-floor` ou `unknown`. */
  reason: string;
  normal?: Vec3;
  depth?: number;
  /** Fração do passo até o contato, quando a causa é parede. */
  hitTime?: number;
}

export interface RouteWalkResult {
  reached: boolean;
  seconds: number;
  ticks: number;
  /** Comprimento da polilinha da rota. */
  routeLength: number;
  /** Avanço ao longo da rota, em metros. */
  progress: number;
  /** Caminho realmente percorrido pelo corpo (integral de |Δposição|). */
  travelled: number;
  /** Maior índice de waypoint alcançado. */
  reachedWaypoint: number;
  recoveries: number;
  jumps: number;
  slides: number;
  groundedRate: number;
  airborneTicks: number;
  /** Maior sequência contínua sem apoio, em segundos. */
  longestHangSeconds: number;
  /** Maior folga medida entre o pé e o piso enquanto o motor se diz APOIADO — flutuação. */
  maxGapWhileGrounded: number;
  /** Maior folga medida enquanto o corpo está no ar — altura de salto involuntário. */
  maxGapWhileAirborne: number;
  /** Maior afastamento lateral da polilinha. */
  maxLateralDeviation: number;
  minAltitude: number;
  maxAltitude: number;
  endPosition: Vec3;
  blockage?: RouteBlockage;
}

/** Projeção de um ponto na polilinha: distância percorrida, afastamento lateral e segmento. */
export function projectOnRoute(route: readonly Vec3[], point: Vec3): {along: number; lateral: number; segment: number} {
  let along = 0, best = {along: 0, lateral: Infinity, segment: 0}, cursor = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!, b = route[i]!;
    const edge = sub(b, a), span = length(edge);
    if (span < 1e-9) continue;
    const t = Math.max(0, Math.min(1, dot(sub(point, a), edge) / (span * span)));
    const lateral = distance(point, add(a, scale(edge, t)));
    if (lateral < best.lateral) best = {along: cursor + t * span, lateral, segment: i - 1};
    cursor += span;
  }
  along = best.along;
  return {along, lateral: best.lateral, segment: best.segment};
}

export function routeLength(route: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += distance(route[i - 1]!, route[i]!);
  return total;
}

/**
 * Por que o corpo parou. Consulta a malha real e nomeia a causa; não muda nada.
 *
 * Os extremos das pontes encostam de propósito no solo das ilhas, então `buried` e `wall` aqui
 * costumam ser arte a ajustar, não física a corrigir.
 */
export function describeBlockage(
  collision: PlanetCollision, motor: PlanetMotor, heading: Vec3, waypoint: number,
): RouteBlockage {
  const t = PLANET_MOTOR_TUNING;
  const up = motor.up, position = copy(motor.position);
  const floorCos = Math.cos(t.maxSlopeDegrees * Math.PI / 180);
  const buried = collision.deepestContact(position, up, t.radius, t.height);
  if (buried && buried.depth > 0.03) {
    return {waypoint, position, reason: 'buried', normal: buried.normal, depth: buried.depth};
  }
  const forward = reject(heading, up);
  if (length(forward) > 1e-6) {
    const step = scale(normalize(forward), Math.max(0.4, t.radius * 2));
    const wall = collision.sweepCapsule(position, up, step, t.radius, t.height, floorCos);
    if (wall) return {waypoint, position, reason: 'wall', normal: wall.normal, hitTime: wall.time};
  }
  const support = collision.supportBelow(position, up, 0.1, t.stepHeight * 2);
  if (!support) return {waypoint, position, reason: 'no-floor'};
  return {waypoint, position, reason: 'unknown', normal: support.normal, depth: support.slopeDegrees};
}

/** Pé pousado no apoio medido sob `point`, ou `undefined` se não há piso caminhável ali. */
export function footAt(
  collision: PlanetCollision, frame: PlanetFrame, point: Vec3, above = 2, below = 3,
): Vec3 | undefined {
  const up = frame.up(point);
  const support = collision.supportBelow(point, up, above, below);
  if (!support || support.slopeDegrees > PLANET_MOTOR_TUNING.maxSlopeDegrees) return undefined;
  return add(support.point, scale(up, 0.02));
}

/**
 * Percorre `route` do começo ao fim com um `PlanetMotor`, apontando sempre para o waypoint
 * corrente. Tudo é limitado: passo fixo, teto de tempo e detecção de corpo preso.
 */
export function walkRoute(
  collision: PlanetCollision, frame: PlanetFrame, route: readonly Vec3[],
  options: Partial<RouteWalkOptions> = {},
): RouteWalkResult & {motor?: PlanetMotor} {
  const o: RouteWalkOptions = {...ROUTE_WALK_DEFAULTS, ...options};
  const total = routeLength(route);
  const first = route[0]!, last = route[route.length - 1]!;
  const empty = (blockage?: RouteBlockage): RouteWalkResult => ({
    reached: false, seconds: 0, ticks: 0, routeLength: total, progress: 0, travelled: 0,
    reachedWaypoint: 0, recoveries: 0, jumps: 0, slides: 0, groundedRate: 0, airborneTicks: 0,
    longestHangSeconds: 0, maxGapWhileGrounded: 0, maxGapWhileAirborne: 0, maxLateralDeviation: 0,
    minAltitude: frame.altitude(first), maxAltitude: frame.altitude(first), endPosition: copy(first),
    ...(blockage ? {blockage} : {}),
  });
  const spawn = footAt(collision, frame, first);
  if (!spawn) return empty({waypoint: 0, position: copy(first), reason: 'no-floor'});

  const motor = new PlanetMotor({frame, collision, spawn, heading: sub(route[1] ?? last, first)});
  const idle: PlanetInput = {x: 0, z: 0, jump: false, sprint: false};
  const drive: PlanetInput = {x: 0, z: 1, jump: false, sprint: o.sprint};
  // Assentar antes de medir: o primeiro quadro após o nascimento ainda está caindo os 2 cm de folga.
  for (let i = 0; i < 12; i++) motor.fixedUpdate(o.dt, idle);

  let target = 1, ticks = 0, travelled = 0, airborne = 0, hang = 0, longestHang = 0;
  let grounded = 0, maxGapGrounded = 0, maxGapAir = 0, maxLateral = 0;
  let minAltitude = Infinity, maxAltitude = -Infinity;
  let previous = copy(motor.position);
  let bestProgress = projectOnRoute(route, motor.position).along;
  let stallTicks = 0;
  const maxTicks = Math.ceil(o.maxSeconds / o.dt);
  const stallWindow = Math.ceil(o.stallSeconds / o.dt);
  let heading = sub(route[target] ?? last, motor.position);
  let blockage: RouteBlockage | undefined;

  while (ticks < maxTicks) {
    const aim = route[Math.min(target, route.length - 1)]!;
    heading = sub(aim, motor.position);
    motor.fixedUpdate(o.dt, drive, heading);
    ticks++;
    travelled += distance(previous, motor.position);
    previous = copy(motor.position);

    if (motor.grounded) grounded++; else airborne++;
    hang = motor.grounded ? 0 : hang + 1;
    longestHang = Math.max(longestHang, hang);
    const altitude = frame.altitude(motor.position);
    minAltitude = Math.min(minAltitude, altitude);
    maxAltitude = Math.max(maxAltitude, altitude);

    const projected = projectOnRoute(route, motor.position);
    maxLateral = Math.max(maxLateral, projected.lateral);
    if (projected.along > bestProgress + o.stallProgress) {bestProgress = projected.along; stallTicks = 0;}
    else stallTicks++;

    if (ticks % o.probeEvery === 0) {
      const support = collision.supportBelow(motor.position, motor.up, 0.05, 3);
      const gap = support ? support.offset : 3;
      if (motor.grounded) maxGapGrounded = Math.max(maxGapGrounded, gap);
      else maxGapAir = Math.max(maxGapAir, gap);
    }

    // Avança o alvo quando chega perto ou quando já passou dele.
    const toAim = sub(aim, motor.position);
    const passed = dot(reject(toAim, motor.up), motor.forward) < 0;
    if (target < route.length - 1 && (length(toAim) < o.arriveRadius || passed)) target++;
    if (distance(motor.position, last) < o.endpointRadius) break;
    if (motor.recoveries > 0) {blockage = {waypoint: target, position: copy(motor.position), reason: 'void-recovery'}; break;}
    if (stallTicks >= stallWindow) {
      blockage = describeBlockage(collision, motor, heading, target);
      break;
    }
  }

  const reached = distance(motor.position, last) < o.endpointRadius && motor.recoveries === 0;
  if (!reached && !blockage && ticks >= maxTicks) {
    blockage = {...describeBlockage(collision, motor, heading, target), reason: 'timeout'};
  }
  return {
    reached,
    seconds: ticks * o.dt,
    ticks,
    routeLength: total,
    progress: projectOnRoute(route, motor.position).along,
    travelled,
    reachedWaypoint: Math.min(target, route.length - 1),
    recoveries: motor.recoveries,
    jumps: motor.jumps,
    slides: motor.slides,
    groundedRate: ticks ? grounded / ticks : 0,
    airborneTicks: airborne,
    longestHangSeconds: longestHang * o.dt,
    maxGapWhileGrounded: maxGapGrounded,
    maxGapWhileAirborne: maxGapAir,
    maxLateralDeviation: maxLateral,
    minAltitude: Number.isFinite(minAltitude) ? minAltitude : 0,
    maxAltitude: Number.isFinite(maxAltitude) ? maxAltitude : 0,
    endPosition: copy(motor.position),
    ...(blockage ? {blockage} : {}),
    motor,
  };
}

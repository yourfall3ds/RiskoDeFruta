import type {Vec3} from '../core/contracts';
import {
  PlanetFrame, add, cross, length, normalize, quaternionFromBasis, reject, rotateAbout, scale, sub,
  type Quat,
} from './PlanetFrame';
import {islandSlot, type BridgeSpanPlan, type IslandSlotId} from './PlanetLayout';

/**
 * Colocação de ARTE AUTORAL sobre o planeta.
 *
 * Nada aqui cria geometria: são transformações para GLB que já existem. Convenção do asset:
 * Y-up, +Z para a frente, pivô no CENTRO DO CONVÉS. `deckOffset` corrige assets cujo pivô não
 * está no piso (positivo eleva o convés acima do raio nominal).
 */

export interface Placement {
  position: Vec3;
  rotation: Quat;
  up: Vec3;
  forward: Vec3;
  right: Vec3;
  /** Distância de arco do início do vão, quando a colocação vem de uma ponte. */
  arcOffset?: number;
}

/** Transformação de uma ilha num slot: `up` radial, `forward` no norte geográfico girado por `spin`. */
export function islandPlacement(
  frame: PlanetFrame, direction: Vec3, spinDegrees = 0, deckOffset = 0,
): Placement {
  const up = normalize(direction);
  const {north} = PlanetFrame.compass(up);
  const spin = spinDegrees * Math.PI / 180;
  const forward = normalize(reject(rotateAbout(north, up, Math.cos(spin), Math.sin(spin)), up), north);
  const right = cross(up, forward);
  return {
    position: add(frame.centre, scale(up, frame.surfaceRadius + deckOffset)),
    rotation: quaternionFromBasis(right, up, forward),
    up, forward, right,
  };
}

export function islandPlacementFor(frame: PlanetFrame, id: IslandSlotId, deckOffset = 0): Placement {
  const slot = islandSlot(id);
  return islandPlacement(frame, slot.direction, slot.spinDegrees, deckOffset);
}

export interface BridgeOptions {
  /** Quantos módulos de ponte distribuir no vão livre. */
  modules: number;
  /** Recuo em cada ponta, normalmente o raio da ilha. */
  islandRadius?: number;
  deckOffset?: number;
}

export interface BridgePath {
  /** Comprimento do arco de centro a centro das duas ilhas. */
  arcLength: number;
  /** Comprimento livre entre as bordas das ilhas. */
  freeLength: number;
  /** Comprimento de cada módulo para preencher o vão sem folga. */
  moduleLength: number;
  modules: Placement[];
}

/**
 * Distribui módulos ao longo do círculo máximo entre dois slots.
 * Cada módulo sai com `up` radial e `forward` TANGENTE ao arco — o transporte paralelo do passo
 * geodésico entrega a tangente correta em cada ponto, sem interpolar ângulos.
 */
export function bridgeSpan(
  frame: PlanetFrame, from: Vec3, to: Vec3, options: BridgeOptions,
): BridgePath {
  const start = frame.fromDirection(from), end = frame.fromDirection(to);
  const arcLength = frame.arcDistance(start, end);
  const inset = options.islandRadius ?? frame.islandRadius;
  const freeLength = Math.max(0, arcLength - inset * 2);
  const count = Math.max(1, Math.floor(options.modules));
  const moduleLength = freeLength / count;
  const heading = reject(sub(frame.up(end), frame.up(start)), frame.up(start));
  if (length(heading) < 1e-9) throw new Error('Pontas de ponte coincidentes ou antipodais: arco indefinido');
  const direction = normalize(heading);
  const deckOffset = options.deckOffset ?? 0;
  const modules: Placement[] = [];
  for (let i = 0; i < count; i++) {
    const arcOffset = inset + moduleLength * (i + 0.5);
    const step = frame.geodesicStep(start, scale(direction, arcOffset));
    const up = frame.up(step.position);
    const forward = normalize(reject(step.direction, up), step.direction);
    const right = cross(up, forward);
    modules.push({
      position: add(frame.centre, scale(up, frame.surfaceRadius + deckOffset)),
      rotation: quaternionFromBasis(right, up, forward),
      up, forward, right,
      arcOffset: arcOffset - inset,
    });
  }
  return {arcLength, freeLength, moduleLength, modules};
}

export function bridgeSpanFor(frame: PlanetFrame, plan: BridgeSpanPlan, options: BridgeOptions): BridgePath {
  return bridgeSpan(frame, islandSlot(plan.from).direction, islandSlot(plan.to).direction, options);
}

/**
 * Pontos igualmente espaçados no arco entre dois pontos da superfície. Serve para trilhas,
 * corrimão de colisão invisível, marcadores de objetivo e checagem de rota.
 */
export function arcPoints(frame: PlanetFrame, from: Vec3, to: Vec3, count: number, altitude = 0): Vec3[] {
  const start = frame.fromDirection(from, altitude), end = frame.fromDirection(to, altitude);
  const total = frame.arcDistance(start, end);
  const heading = reject(sub(frame.up(end), frame.up(start)), frame.up(start));
  if (length(heading) < 1e-9) throw new Error('Arco indefinido entre pontos coincidentes ou antipodais');
  const direction = normalize(heading);
  const steps = Math.max(1, Math.floor(count));
  const points: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push(frame.geodesicStep(start, scale(direction, total * i / steps)).position);
  }
  return points;
}

import type {Vec3} from '../core/contracts';
import type {Ray} from '@babylonjs/core/Culling/ray';
import {PLAYER_TUNING} from '../player/PlayerTuning';
import type {CollisionWorld} from './CollisionWorld';
import {
  FLOOR_COS, quaternionFromBasis,
  type OrientTarget, type Quat, type SlideOptions, type SlideResult, type SupportPoint,
  type SurfaceBasis, type SurfaceFrame, type SurfaceRayHit, type SurfaceSweepHit,
} from './SurfaceFrame';

/**
 * `SurfaceFrame` do mundo plano: **adaptador fino sobre o `CollisionWorld` de hoje**.
 *
 * Toda chamada aqui é a mesma chamada que o jogo já faz, com as mesmas tolerâncias e na mesma
 * ordem. As bases são exatas — `up = (0,1,0)`, `reference = (0,0,1)`, `right = (1,0,0)` — então os
 * produtos escalares da camada genérica (`v · right === v.x`) não introduzem um único bit de erro.
 * É por isso que `FlatSurface` pode servir de ORÁCULO de regressão: `tests/surface-frame.test.ts`
 * compara os dois caminhos em amostras aleatórias e exige igualdade exata.
 */
export class FlatSurface implements SurfaceFrame {
  readonly kind = 'flat' as const;

  constructor(private readonly world: CollisionWorld) {}

  up(_p: Vec3): Vec3 {return {x: 0, y: 1, z: 0};}
  down(_p: Vec3): Vec3 {return {x: 0, y: -1, z: 0};}
  altitude(p: Vec3): number {return p.y;}
  atAltitude(p: Vec3, altitude: number): Vec3 {return {x: p.x, y: altitude, z: p.z};}
  belowVoid(p: Vec3): boolean {return p.y < PLAYER_TUNING.voidHeight;}

  /**
   * `groundAt` com o teto expresso como folga acima do pé. `below = Infinity` reproduz o
   * comportamento original (que não tem limite inferior nenhum).
   *
   * A normal não vem do `groundAt` — ele só devolve altura. Ela é lida do `surfaceAt` no mesmo
   * ponto e só é aceita quando coincide com o piso caminhável; senão o apoio é tratado como plano,
   * que é exatamente a hipótese do motor plano de hoje para caixas e superfícies autoradas.
   */
  support(p: Vec3, above: number, below: number, maxSlopeDegrees = PLAYER_TUNING.maxSlopeDegrees): SupportPoint | undefined {
    const height = this.world.groundAt(p.x, p.z, p.y + above, maxSlopeDegrees);
    if (!Number.isFinite(height)) return undefined;
    const offset = p.y - height;
    if (offset > below) return undefined;
    const sample = this.world.surfaceAt?.(p.x, p.z, p.y + above);
    const matched = sample && Math.abs(sample.height - height) < 1e-6 ? sample : undefined;
    return {
      point: {x: p.x, y: height, z: p.z},
      normal: matched ? {...matched.normal} : {x: 0, y: 1, z: 0},
      offset,
      slopeDegrees: matched ? matched.slopeDegrees : 0,
    };
  }

  steepSupport(p: Vec3, above: number, below: number): SupportPoint | undefined {
    const sample = this.world.surfaceAt?.(p.x, p.z, p.y + above);
    if (!sample) return undefined;
    const offset = p.y - sample.height;
    if (offset > below) return undefined;
    return {
      point: {x: p.x, y: sample.height, z: p.z},
      normal: {...sample.normal},
      offset,
      slopeDegrees: sample.slopeDegrees,
    };
  }

  /**
   * Os DOIS modos de deslocamento do jogo plano, selecionados por `ignoreFloors`:
   *
   *   `ignoreFloors: true`  → passo de quem está apoiado: `move` horizontal com degrau + soma
   *                           vertical direta. Quem acompanha o relevo é `support`.
   *   `ignoreFloors: false` → passo aéreo: `moveAirborne`, varredura contínua 3D que devolve
   *                           `verticalContact` quando o contato é piso ou teto DE VERDADE.
   *
   * `floor`/`wall` ficam vazios: as rotinas planas não devolvem normal. Quem precisa da normal de
   * parede (wall jump) usa `sweep`, como o motor plano já faz.
   */
  slide(p: Vec3, delta: Vec3, radius: number, height: number, step: number, options?: SlideOptions): SlideResult {
    const beforeX = p.x, beforeY = p.y, beforeZ = p.z;
    let verticalContact = false;
    if (options?.ignoreFloors) {
      this.world.move(p, delta.x, delta.z, radius, height, options.stepUp === false ? 0 : step, true);
      p.y += delta.y;
    } else {
      verticalContact = this.world.moveAirborne(p, delta, radius, height, options?.floorCos ?? FLOOR_COS);
    }
    const moved = {x: p.x - beforeX, y: p.y - beforeY, z: p.z - beforeZ};
    return {
      moved, verticalContact, blocked: Math.hypot(moved.x - delta.x, moved.z - delta.z) > 1e-4, stepped: false,
    };
  }

  sweep(from: Vec3, delta: Vec3, radius: number): SurfaceSweepHit | undefined {
    const hit = this.world.sweepSphere(from, delta, radius, true);
    if (!hit) return undefined;
    return {time: hit.time, normal: hit.normal, id: hit.collider.id, topGap: hit.collider.max.y - from.y};
  }

  raycast(ray: Ray): SurfaceRayHit | undefined {return this.world.raycast(ray);}
  insideSolid(p: Vec3, height: number): boolean {return this.world.insideSolid(p, height);}
  /** O mundo plano não desencrava por empurrão: quem cuida disso é o ponto seguro. */
  depenetrate(_p: Vec3, _radius: number, _height: number): undefined {return undefined;}

  planarDistance(a: Vec3, b: Vec3): number {return Math.hypot(a.x - b.x, a.z - b.z);}
  heightGap(a: Vec3, b: Vec3): number {return a.y - b.y;}
  walk(p: Vec3, tangentDelta: Vec3): Vec3 {
    return {x: p.x + tangentDelta.x, y: p.y + tangentDelta.y, z: p.z + tangentDelta.z};
  }
  transport(v: Vec3, _from: Vec3, _to: Vec3): Vec3 {return {x: v.x, y: v.y, z: v.z};}
  bucket(p: Vec3, size: number): string {
    return `${Math.floor(p.x / size)},${Math.floor(p.y / size)},${Math.floor(p.z / size)}`;
  }

  basis(_p: Vec3, forwardHint: Vec3): SurfaceBasis {
    const length = Math.hypot(forwardHint.x, forwardHint.z);
    const forward = length < 1e-6 ? {x: 0, y: 0, z: 1} : {x: forwardHint.x / length, y: 0, z: forwardHint.z / length};
    // right = up × forward, com up = (0,1,0) exato.
    return {up: {x: 0, y: 1, z: 0}, forward, right: {x: forward.z, y: 0, z: -forward.x}};
  }

  quaternion(p: Vec3, forward: Vec3): Quat {
    const b = this.basis(p, forward);
    return quaternionFromBasis(b.right, b.up, b.forward);
  }

  /** O comportamento de hoje: posição e `rotation.y`. Nada de quaternion no mundo plano. */
  orient(node: OrientTarget, p: Vec3, forward: Vec3): void {
    node.position.x = p.x; node.position.y = p.y; node.position.z = p.z;
    node.rotationQuaternion = null;
    node.rotation.x = 0;
    node.rotation.y = Math.hypot(forward.x, forward.z) < 1e-9 ? node.rotation.y : Math.atan2(forward.x, forward.z);
    node.rotation.z = 0;
  }
}

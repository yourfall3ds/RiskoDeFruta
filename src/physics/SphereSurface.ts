import type {Vec3} from '../core/contracts';
import type {Ray} from '@babylonjs/core/Culling/ray';
import {Quaternion} from '@babylonjs/core/Maths/math.vector';
import {PLAYER_TUNING} from '../player/PlayerTuning';
import type {PlanetCollision} from '../planet/PlanetCollision';
import {
  PlanetFrame, add, copy, dot, length, normalize, reject, scale, sub, transport,
} from '../planet/PlanetFrame';
import {
  FLOOR_COS, contactLift, quaternionFromBasis,
  type OrientTarget, type Quat, type SlideOptions, type SlideResult, type SupportPoint,
  type SurfaceBasis, type SurfaceFrame, type SurfaceRayHit, type SurfaceSweepHit,
} from './SurfaceFrame';

/**
 * `SurfaceFrame` do planeta literal: **gravidade radial de verdade**, sem carta plana e sem
 * aproximação tangente.
 *
 * Delega para duas peças já testadas (`tests/planet-frame.test.ts`, `tests/planet-collision.test.ts`,
 * `tests/planet-motor.test.ts`):
 *   - `PlanetFrame` — vertical local, passo geodésico exato, transporte paralelo, arco;
 *   - `PlanetCollision` — BVH em espaço de MUNDO, sonda de apoio radial (`supportBelow`), cápsula
 *     orientada (`sweepCapsule`), contato estático (`deepestContact`) e destruição
 *     (`disableTriangles`).
 *
 * O deslocamento é uma varredura LINEAR por iteração (é o que a cápsula orientada sabe fazer) com o
 * apoio re-encaixado pela sonda radial ao fim do passo — o mesmo kernel do `PlanetMotor`. A folga
 * corda-vs-arco de um passo de 60 Hz a 6,8 m/s é `d²/2R ≈ 3·10⁻⁵ m`, e o encaixe a zera; o passo
 * geodésico exato fica disponível em `walk` para quem precisa de deslocamento sem colisão
 * (spawners, rotas, anéis de recuperação).
 */
export class SphereSurface implements SurfaceFrame {
  readonly kind = 'sphere' as const;

  constructor(
    private readonly frame: PlanetFrame,
    private readonly collision: PlanetCollision,
    /** Raio da cápsula usado pelas consultas que não o recebem (`insideSolid`). */
    private readonly probeRadius = PLAYER_TUNING.radius,
  ) {}

  get planetFrame(): PlanetFrame {return this.frame;}
  get planetCollision(): PlanetCollision {return this.collision;}

  up(p: Vec3): Vec3 {return this.frame.up(p);}
  down(p: Vec3): Vec3 {return this.frame.down(p);}
  altitude(p: Vec3): number {return this.frame.altitude(p);}
  atAltitude(p: Vec3, altitude: number): Vec3 {return this.frame.atAltitude(p, altitude);}
  belowVoid(p: Vec3): boolean {return this.frame.radius(p) < this.frame.voidRadius;}

  /**
   * Sonda radial. `above`/`below` infinitos são recortados na casca útil do planeta (teto de
   * enquadramento acima, limite do vazio abaixo) — é o análogo honesto de "sem limite" numa esfera.
   */
  support(p: Vec3, above: number, below: number, maxSlopeDegrees?: number): SupportPoint | undefined {
    const radius = this.frame.radius(p);
    const reach = Number.isFinite(above) ? above : Math.max(0, this.frame.ceilingRadius - radius);
    const depth = Number.isFinite(below) ? below : Math.max(0, radius - this.frame.voidRadius);
    const sample = this.collision.supportBelow(p, this.frame.up(p), reach, depth);
    if (!sample) return undefined;
    if (maxSlopeDegrees !== undefined && sample.slopeDegrees > maxSlopeDegrees) return undefined;
    return {point: sample.point, normal: sample.normal, offset: sample.offset, slopeDegrees: sample.slopeDegrees};
  }

  /** A sonda radial já devolve a superfície real mais próxima, íngreme ou não. */
  steepSupport(p: Vec3, above: number, below: number): SupportPoint | undefined {
    return this.support(p, above, below);
  }

  /**
   * Varredura + deslizamento + degrau ao longo da vertical LOCAL.
   *
   * `ignoreFloors` descarta contatos de piso, para o passo de quem já está apoiado: sem isso um
   * leque de triângulos coplanares (o ápice de uma calota) devolve contato em `time = 0` por
   * iteração e o corpo trava sem sair do lugar.
   */
  slide(p: Vec3, delta: Vec3, radius: number, height: number, step: number, options?: SlideOptions): SlideResult {
    const start = copy(p);
    const floorCos = options?.floorCos ?? FLOOR_COS;
    const ignoreFloors = options?.ignoreFloors ?? false;
    const swept = this.sweepAndSlide(p, delta, radius, height, floorCos, ignoreFloors);
    let floor = swept.floor, wall = swept.wall, stepped = false;
    if (wall && (options?.stepUp ?? true) && step > 0) {
      const lift = this.stepUpOver(start, delta, radius, height, step, floorCos);
      if (lift) {
        p.x = lift.point.x; p.y = lift.point.y; p.z = lift.point.z;
        floor = lift.normal;
        wall = undefined;
        stepped = true;
      }
    }
    return {
      moved: sub(p, start),
      verticalContact: floor !== undefined || swept.ceiling !== undefined,
      ...(floor ? {floor} : {}),
      ...(swept.ceiling ? {ceiling: swept.ceiling} : {}),
      ...(wall ? {wall} : {}),
      blocked: wall !== undefined,
      stepped,
    };
  }

  private sweepAndSlide(
    p: Vec3, delta: Vec3, radius: number, height: number, floorCos: number, ignoreFloors: boolean,
  ): {floor?: Vec3; wall?: Vec3; ceiling?: Vec3} {
    const up = this.frame.up(p);
    const remaining = copy(delta);
    let floor: Vec3 | undefined, wall: Vec3 | undefined, ceiling: Vec3 | undefined;
    for (let i = 0; i < 4; i++) {
      if (length(remaining) < 1e-9) break;
      const hit = this.collision.sweepCapsule(
        p, up, remaining, radius, height, ignoreFloors ? floorCos : undefined,
      );
      if (!hit) {
        p.x += remaining.x; p.y += remaining.y; p.z += remaining.z;
        break;
      }
      const advance = Math.max(0, hit.time - 1e-4);
      p.x += remaining.x * advance; p.y += remaining.y * advance; p.z += remaining.z * advance;
      const left = 1 - advance;
      remaining.x *= left; remaining.y *= left; remaining.z *= left;
      const into = dot(remaining, hit.normal);
      if (into < 0) {
        remaining.x -= hit.normal.x * into; remaining.y -= hit.normal.y * into; remaining.z -= hit.normal.z * into;
      }
      const facing = dot(hit.normal, up);
      if (facing >= floorCos) floor = hit.normal;
      else if (facing <= -0.2) ceiling = hit.normal;
      else wall = hit.normal;
    }
    return {...(floor ? {floor} : {}), ...(wall ? {wall} : {}), ...(ceiling ? {ceiling} : {})};
  }

  /**
   * Degrau: sonda o piso logo ADIANTE da face que barrou e sobe direto para ele.
   *
   * Erguer a cápsula, repetir a varredura e descer não funciona sobre geometria autoral — o corpo
   * erguido continua encostado na face lateral, cada iteração devolve contato em `time = 0` e o
   * personagem oscila. Sondar adiante decide numa consulta só, e `deepestContact` impede subir para
   * um lugar onde a cápsula não cabe.
   */
  private stepUpOver(
    start: Vec3, delta: Vec3, radius: number, height: number, step: number, floorCos: number,
  ): {point: Vec3; normal: Vec3} | undefined {
    const up = this.frame.up(start);
    const tangent = reject(delta, up), travel = length(tangent);
    if (travel < 1e-6) return undefined;
    const reach = radius + Math.min(travel, radius) + 0.08;
    const ahead = this.frame.geodesicStep(start, scale(tangent, reach / travel)).position;
    const raised = add(ahead, scale(this.frame.up(ahead), step + 0.05));
    const landing = this.collision.supportBelow(raised, this.frame.up(raised), 0.02, step * 2 + 0.1);
    if (!landing) return undefined;
    if (dot(landing.normal, up) < floorCos) return undefined;
    const rise = dot(sub(landing.point, start), up);
    if (rise < 0.02 || rise > step) return undefined;
    const lift = contactLift(radius, dot(landing.normal, up)) + 0.005;
    const point = add(landing.point, scale(this.frame.up(landing.point), lift));
    const contact = this.collision.deepestContact(point, this.frame.up(point), radius, height);
    if (contact && contact.depth > 0.02) return undefined;
    return {point, normal: landing.normal};
  }

  /**
   * Varredura de esfera: a cápsula orientada com `height = 2·radius` degenera numa esfera única
   * centrada em `from`, exatamente como `CollisionWorld.sweepSphere` faz contra a malha.
   *
   * `topGap` é `Infinity` porque a malha autoral curva não tem "topo de caixa". Quem usa isso
   * (wall jump) já exige que o contato seja de PAREDE e sondado na altura do ombro, o que é a
   * mesma intenção do teste de altura do mundo plano.
   */
  sweep(from: Vec3, delta: Vec3, radius: number): SurfaceSweepHit | undefined {
    const up = this.frame.up(from);
    const base = sub(from, scale(up, radius));
    const hit = this.collision.sweepCapsule(base, up, delta, radius, radius * 2);
    if (!hit) return undefined;
    const n = hit.normal;
    return {
      time: hit.time,
      normal: n,
      // Chave por DIREÇÃO de face: uma parede plana inteira responde a mesma coisa, então o
      // "um wall jump por parede" continua valendo mesmo com a face partida em triângulos.
      id: `wall:${Math.round(n.x * 8)},${Math.round(n.y * 8)},${Math.round(n.z * 8)}`,
      topGap: Infinity,
    };
  }

  raycast(ray: Ray): SurfaceRayHit | undefined {
    const hit = this.collision.raycast(ray.origin, ray.direction, ray.length);
    return hit ? {distance: hit.distance, point: hit.point, normal: hit.normal} : undefined;
  }

  /** Enterrado de verdade — não um roçar de faceta, que é resolvido por `depenetrate`. */
  insideSolid(p: Vec3, height: number): boolean {
    const contact = this.collision.deepestContact(p, this.frame.up(p), this.probeRadius, height);
    return contact !== undefined && contact.depth > this.probeRadius * 0.75;
  }

  depenetrate(p: Vec3, radius: number, height: number): {depth: number; normal: Vec3} | undefined {
    const contact = this.collision.deepestContact(p, this.frame.up(p), radius, height);
    return contact && contact.depth > 1e-3 ? contact : undefined;
  }

  planarDistance(a: Vec3, b: Vec3): number {return this.frame.arcDistance(a, b);}
  heightGap(a: Vec3, b: Vec3): number {return dot(sub(a, b), this.frame.up(b));}
  walk(p: Vec3, tangentDelta: Vec3): Vec3 {return this.frame.geodesicStep(p, tangentDelta).position;}
  transport(v: Vec3, from: Vec3, to: Vec3): Vec3 {return transport(v, this.frame.up(from), this.frame.up(to));}
  bucket(p: Vec3, size: number): string {
    return `${Math.floor(p.x / size)},${Math.floor(p.y / size)},${Math.floor(p.z / size)}`;
  }

  basis(p: Vec3, forwardHint: Vec3): SurfaceBasis {return this.frame.basisAt(p, forwardHint);}

  quaternion(p: Vec3, forward: Vec3): Quat {
    const b = this.frame.basisAt(p, forward);
    return quaternionFromBasis(b.right, b.up, b.forward);
  }

  /**
   * Pose radial completa. O `rotationQuaternion` existente é mutado no lugar; quando não existe,
   * um é criado (o Babylon exige um `Quaternion` de verdade para montar a matriz).
   */
  orient(node: OrientTarget, p: Vec3, forward: Vec3): void {
    node.position.x = p.x; node.position.y = p.y; node.position.z = p.z;
    const q = this.quaternion(p, forward);
    if (node.rotationQuaternion) {
      node.rotationQuaternion.x = q.x; node.rotationQuaternion.y = q.y;
      node.rotationQuaternion.z = q.z; node.rotationQuaternion.w = q.w;
    } else {
      node.rotationQuaternion = new Quaternion(q.x, q.y, q.z, q.w);
    }
    node.rotation.x = 0; node.rotation.y = 0; node.rotation.z = 0;
  }

  /** Direção tangente unitária estável, para quem precisa de uma frente sem dica. */
  anyTangent(p: Vec3): Vec3 {return normalize(this.frame.basisAt(p, {x: 0, y: 0, z: 1}).forward);}
}

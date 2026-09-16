import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Material} from '@babylonjs/core/Materials/material';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../core/contracts';
import type {FragmentSlice} from './FragmentGeometry';

/**
 * Pool de cacos de cenário.
 *
 * Cada caco recebe uma fatia REAL da geometria do prop que quebrou (ver `FragmentGeometry`) e o
 * MATERIAL original daquela malha — a textura não muda, porque trocar material por um cinza
 * genérico é justamente o defeito que o pedido proíbe.
 *
 * Teto duro, TTL e reciclagem do mais velho: um leque de 21 raios pode quebrar cinco barris no mesmo
 * quadro, e sem teto isso vira chuva de polígonos até o quadro morrer.
 */

/** Sonda de apoio: distância do ponto até o chão ao longo de `up`, ou `undefined` se não há chão. */
export type SupportProbe = (point: Vec3, up: Vec3) => number | undefined;

export interface DebrisOptions {
  /** Cacos vivos ao mesmo tempo. */
  readonly budget?: number;
  /** Aceleração da gravidade, m/s². */
  readonly gravity?: number;
  /** Centro do planeta. Presente ⇒ gravidade RADIAL; ausente ⇒ −Y do mundo (jogo plano). */
  readonly centre?: Vec3;
  readonly support?: SupportProbe;
}

export const DEBRIS_BUDGET = 48;

interface Debris {
  mesh: Mesh;
  velocity: Vector3;
  spin: Vector3;
  up: Vector3;
  half: number;
  life: number;
  maxLife: number;
  active: boolean;
  resting: boolean;
}

export class DestructionDebris {
  private readonly pool: Debris[] = [];
  private readonly budget: number;
  private readonly gravity: number;
  private readonly centre: Vec3 | undefined;
  private readonly support: SupportProbe | undefined;
  private spawns = 0;
  private disposed = false;

  constructor(private readonly scene: Scene, options: DebrisOptions = {}) {
    this.budget = Math.max(4, options.budget ?? DEBRIS_BUDGET);
    this.gravity = options.gravity ?? 15;
    this.centre = options.centre;
    this.support = options.support;
  }

  get active(): number {return this.pool.reduce((n, debris) => n + (debris.active ? 1 : 0), 0);}
  get capacity(): number {return this.budget;}

  /** Vertical local no ponto: radial no planeta, +Y no mundo plano. */
  private upAt(point: Vec3, target: Vector3): Vector3 {
    if (!this.centre) return target.set(0, 1, 0);
    const x = point.x - this.centre.x, y = point.y - this.centre.y, z = point.z - this.centre.z;
    const n = Math.hypot(x, y, z);
    return n > 1e-6 ? target.set(x / n, y / n, z / n) : target.set(0, 1, 0);
  }

  private take(): Debris {
    let debris = this.pool.find(item => !item.active);
    if (!debris && this.pool.length < this.budget) {
      const mesh = new Mesh('destruction-debris', this.scene);
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.rotationQuaternion = null;
      mesh.doNotSyncBoundingInfo = true;
      mesh.setEnabled(false);
      debris = {
        mesh, velocity: Vector3.Zero(), spin: Vector3.Zero(), up: new Vector3(0, 1, 0),
        half: 0.1, life: 0, maxLife: 1, active: false, resting: false,
      };
      this.pool.push(debris);
    }
    // Pool cheio: recicla o mais perto de morrer em vez de crescer.
    return debris ?? this.pool.reduce((a, b) => (a.life <= b.life ? a : b));
  }

  /**
   * Lança os cacos de uma quebra. `direction` é a direção do golpe; os pedaços saem dela abertos em
   * leque e sobem um pouco ao longo da vertical local, que é o que faz a quebra ler como explosão de
   * madeira e não como queda de tijolos.
   */
  burst(
    slices: readonly FragmentSlice[],
    material: Material | null,
    direction: Vec3,
    speed: number,
    life: number,
  ): number {
    if (this.disposed || slices.length === 0) return 0;
    const push = new Vector3(direction.x, direction.y, direction.z);
    if (push.lengthSquared() < 1e-6) push.set(0, 1, 0); else push.normalize();
    let spawned = 0;
    for (const slice of slices) {
      const debris = this.take();
      const data = new VertexData();
      data.positions = slice.positions as unknown as number[];
      data.indices = slice.indices as unknown as number[];
      if (slice.normals) data.normals = slice.normals as unknown as number[];
      if (slice.uvs) data.uvs = slice.uvs as unknown as number[];
      data.applyToMesh(debris.mesh, false);
      debris.mesh.material = material;
      debris.mesh.position.set(slice.centre[0], slice.centre[1], slice.centre[2]);
      debris.mesh.rotation.setAll(0);
      debris.mesh.visibility = 1;
      debris.half = Math.max(slice.half[0], slice.half[1], slice.half[2]);

      const point: Vec3 = {x: slice.centre[0], y: slice.centre[1], z: slice.centre[2]};
      this.upAt(point, debris.up);
      const roll = this.spawns++;
      const angle = roll * 2.399;
      // Componente de abertura: perpendicular à vertical local, para o leque acompanhar a superfície.
      const lateral = new Vector3(Math.sin(angle), 0, Math.cos(angle));
      lateral.subtractInPlace(debris.up.scale(Vector3.Dot(lateral, debris.up)));
      if (lateral.lengthSquared() < 1e-6) lateral.set(1, 0, 0); else lateral.normalize();
      const variation = 0.75 + 0.5 * fract(roll * 0.6180339887);
      debris.velocity
        .copyFrom(push).scaleInPlace(speed * 0.55)
        .addInPlace(lateral.scale(speed * 0.7 * variation))
        .addInPlace(debris.up.scale(speed * (0.55 + 0.35 * fract(roll * 0.7548776662))));
      debris.spin.set(3.1 - variation, 2.2 + variation, 1.7 + variation * 0.6);
      debris.maxLife = life;
      debris.life = life;
      debris.active = true;
      debris.resting = false;
      debris.mesh.setEnabled(true);
      spawned++;
    }
    return spawned;
  }

  update(dt: number): void {
    if (this.disposed || !(dt > 0)) return;
    for (const debris of this.pool) {
      if (!debris.active) continue;
      debris.life -= dt;
      if (debris.life <= 0) {this.retire(debris); continue;}
      // Último segundo desaparece em vez de sumir de um quadro para o outro.
      debris.mesh.visibility = Math.min(1, debris.life);
      if (debris.resting) continue;

      const position = debris.mesh.position;
      this.upAt(position, debris.up);
      debris.velocity.addInPlace(debris.up.scale(-this.gravity * dt));
      position.addInPlace(debris.velocity.scale(dt));
      debris.mesh.rotation.addInPlace(debris.spin.scale(dt));

      if (!this.support) continue;
      const point: Vec3 = {x: position.x, y: position.y, z: position.z};
      const drop = this.support(point, {x: debris.up.x, y: debris.up.y, z: debris.up.z});
      if (drop === undefined) {
        // Caiu no vazio entre as ilhas: recolhe em vez de cair para sempre.
        if (this.centre) {
          const radius = Math.hypot(position.x - this.centre.x, position.y - this.centre.y, position.z - this.centre.z);
          if (radius < 40) this.retire(debris);
        } else if (position.y < -60) this.retire(debris);
        continue;
      }
      if (drop > debris.half) continue;
      position.addInPlace(debris.up.scale(drop - debris.half));
      const along = Vector3.Dot(debris.velocity, debris.up);
      debris.velocity.subtractInPlace(debris.up.scale(along * 1.68));   // quique curto (e ≈ 0,32)
      const friction = Math.exp(-dt * 7);
      debris.velocity.scaleInPlace(friction);
      debris.spin.scaleInPlace(friction);
      if (debris.velocity.lengthSquared() < 0.4) {
        debris.resting = true;
        debris.velocity.setAll(0);
        debris.spin.setAll(0);
      }
    }
  }

  private retire(debris: Debris): void {
    debris.active = false;
    debris.resting = false;
    debris.mesh.setEnabled(false);
  }

  clear(): void {for (const debris of this.pool) this.retire(debris);}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const debris of this.pool) {
      debris.mesh.geometry?.releaseForMesh(debris.mesh);
      debris.mesh.dispose();
    }
    this.pool.length = 0;
  }
}

const fract = (n: number): number => n - Math.floor(n);

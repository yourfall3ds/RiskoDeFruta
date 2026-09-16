import {FreeCamera} from '@babylonjs/core/Cameras/freeCamera';
import {Matrix, Quaternion, Vector3} from '@babylonjs/core/Maths/math.vector';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../core/contracts';
import {PlanetCamera} from '../planet/PlanetCamera';
import type {PlanetCollision} from '../planet/PlanetCollision';
import type {PlanetFrame} from '../planet/PlanetFrame';
import {add, cross, dot, length, normalize, reject, scale, sub} from '../planet/PlanetFrame';
import {CAMERA_TUNING as t} from '../player/PlayerTuning';
import type {GameCamera} from './GameCamera';

/**
 * A câmera do jogo original, com "para cima" de verdade.
 *
 * `PlanetCamera` resolve o enquadramento sem polo (pivô suavizado, ombro, recuo por colisão,
 * transporte paralelo do rumo). O que ele NÃO tem é o TOQUE: tremor de impacto, chute de dano com
 * roll, abertura de FOV na corrida, antecipação na direção do movimento e o close das três
 * habilidades. Sem isso o planeta pareceria outro jogo — e o pedido é o contrário.
 *
 * Esta classe é essa camada de toque, portada uma a uma de `ThirdPersonCamera`, com a única
 * diferença de que cada "para cima" virou a vertical local:
 *
 *   `lead` em XZ            → antecipação no plano TANGENTE
 *   `kick` somado em `+Y`   → somado ao longo de `up`
 *   `rotation.z` do horizonte → roll VERDADEIRO pela base ortonormal (o `PlanetaryHorizon`, que é
 *                               roll cosmético sobre simulação plana, fica obsoleto aqui)
 *   `groundAt` do recuo     → sonda radial de apoio
 */
export class RadialCamera implements GameCamera {
  readonly camera: FreeCamera;
  readonly forward = new Vector3(0, 0, 1);
  private planet: PlanetCamera;
  private frame: PlanetFrame;
  private collision: PlanetCollision | undefined;
  private readonly rotation = Quaternion.Identity();
  private readonly matrix = Matrix.Identity();
  private readonly axisX = new Vector3();
  private readonly axisY = new Vector3();
  private readonly axisZ = new Vector3();
  private readonly closeHidden: AbstractMesh[] = [];

  private upValue: Vec3 = {x: 0, y: 1, z: 0};
  /** Antecipação tangente, em espaço de MUNDO; é transportada junto com a vertical. */
  private lead: Vec3 = {x: 0, y: 0, z: 0};
  private kick = 0;
  private hurtKick = 0;
  private hurtSide = 1;
  private fovBlend = 0;
  private baseFov: number = t.fov;
  private lastYaw: number | undefined;
  private lastPitch = 0;
  private initialized = false;

  shake: number = t.shake;
  sprintBlendTarget = 0;
  /**
   * Distância de enquadramento. Escreve no núcleo de propósito: é lá que o recuo por colisão é
   * medido, e aplicar a distância depois (escalando a pose já recuada) enfiaria a câmera na parede.
   */
  get preferredDistance(): number {return this.planet.preferredDistance;}
  set preferredDistance(metres: number) {this.planet.preferredDistance = metres;}

  constructor(scene: Scene, frame: PlanetFrame, anchor: Vec3, collision?: PlanetCollision, heading?: Vec3) {
    this.frame = frame;
    if (collision) this.collision = collision;
    this.planet = new PlanetCamera(frame, anchor, {...(collision ? {collision} : {}), ...(heading ? {heading} : {})});
    this.camera = new FreeCamera('player-camera', new Vector3(anchor.x, anchor.y, anchor.z), scene);
    this.camera.minZ = t.near;
    // O planeta inteiro tem de caber: da órbita de chegada a casca oposta passa de dois raios.
    this.camera.maxZ = Math.max(1200, frame.ceilingRadius * 6);
    this.camera.fov = t.fov;
    this.camera.inputs.clear();
    this.camera.rotationQuaternion = this.rotation;
    this.camera.updateUpVectorFromRotation = true;
    this.upValue = frame.up(anchor);
  }

  /**
   * Adota o planeta REAL depois que o manifesto chega.
   *
   * A cena é construída de forma síncrona e o mapa carrega depois, então a câmera nasce com o
   * contrato nominal do planeta e é reapontada aqui para o raio e a casca de verdade. A
   * `FreeCamera` do Babylon é a MESMA — nada que já a segura (luz, sombra, armas) precisa ser
   * reassinado. Isto acontece durante o carregamento, antes de o jogador ter controle.
   */
  retarget(frame: PlanetFrame, collision: PlanetCollision, anchor: Vec3, heading?: Vec3): void {
    this.frame = frame;
    this.collision = collision;
    this.planet = new PlanetCamera(frame, anchor, {collision, ...(heading ? {heading} : {})});
    this.camera.maxZ = Math.max(1200, frame.ceilingRadius * 6);
    this.upValue = frame.up(anchor);
    this.lead = {x: 0, y: 0, z: 0};
    this.lastYaw = undefined;
    this.initialized = false;
  }

  get heading(): Vec3 {return this.planet.motorHeading;}
  get up(): Vec3 {return this.upValue;}
  setSprint(sprinting: boolean): void {this.sprintBlendTarget = sprinting ? 1 : 0;}
  setFovDegrees(degrees: number): void {this.baseFov = degrees * Math.PI / 180;}
  impulse(strength: number): void {this.kick = Math.min(0.05, this.kick + strength * this.shake);}
  hurt(strength: number, side: number): void {
    this.hurtKick = Math.min(0.13, this.hurtKick + strength * this.shake);
    this.hurtSide = side < 0 ? -1 : 1;
  }

  snapTo(position: Vec3, heading?: Vec3): void {
    this.planet.snapTo(position, heading);
    this.upValue = this.frame.up(position);
    this.lead = {x: 0, y: 0, z: 0};
    this.lastYaw = undefined;
    this.initialized = false;
  }

  /**
   * `yaw`/`pitch` chegam como o acumulador absoluto do `GameInput`. Aqui só a DIFERENÇA importa:
   * ela vira giro no plano tangente. O primeiro quadro não gira nada (não há diferença ainda), o
   * que impede o salto de enquadramento ao entrar na cena com o acumulador longe de zero.
   */
  update(position: Vec3, yaw: number, pitch: number, dt: number, velocity?: Vec3): void {
    for (const mesh of this.closeHidden) mesh.isVisible = true;
    this.closeHidden.length = 0;
    const step = Math.min(dt, 0.1);
    const up = this.frame.up(position);

    if (this.lastYaw !== undefined) {
      const sensitivity = t.sensitivity || 1;
      const dx = (yaw - this.lastYaw) / sensitivity;
      const dy = (pitch - this.lastPitch) / sensitivity;
      if (Number.isFinite(dx) && Number.isFinite(dy)) this.planet.look(dx, dy, up);
    }
    if(this.lastYaw===undefined)this.planet.pitch=Math.max(t.pitchMin,Math.min(t.pitchMax,pitch));
    this.lastYaw = yaw;
    this.lastPitch = pitch;

    // ---- antecipação, no plano tangente ------------------------------------------------------
    const planarVelocity = velocity ? reject(velocity, up) : undefined;
    const planar = planarVelocity ? length(planarVelocity) : 0;
    const leadFactor = this.initialized ? 1 - Math.exp(-step / t.lookAheadSmoothing) : 1;
    const wanted = planar > 0.6 ? Math.min(1, planar / 8) * t.lookAheadMeters : 0;
    const target = planarVelocity && planar > 0.6 ? scale(planarVelocity, wanted / planar) : {x: 0, y: 0, z: 0};
    this.lead = reject(add(this.lead, scale(sub(target, this.lead), leadFactor)), up);

    // ---- FOV de corrida ----------------------------------------------------------------------
    this.fovBlend += (this.sprintBlendTarget - this.fovBlend)
      * (this.initialized ? 1 - Math.exp(-step / t.fovSmoothing) : 1);
    this.camera.fov = this.baseFov + this.fovBlend * t.sprintFovDegrees * Math.PI / 180;

    // ---- pose do núcleo, com a distância pedida pelo jogador ---------------------------------
    const anchor = add(position, this.lead);
    const pose = this.planet.update(anchor, dt);
    this.upValue = pose.up;
    this.forward.set(pose.forward.x, pose.forward.y, pose.forward.z);

    const position2 = pose.position;

    this.kick *= Math.exp(-dt * 30);
    const look = add(position2, add(pose.forward, scale(pose.up, this.kick + this.hurtKick)));
    this.applyPose(position2, sub(look, position2), pose.up, this.hurtKick * this.hurtSide * 0.4);
    this.hurtKick *= Math.exp(-dt * 9);
    this.initialized = true;
  }

  /**
   * Close das habilidades, com a MESMA busca do jogo plano: cinco ângulos em volta, o mais aberto
   * que a colisão permitir vence, e um close bloqueado é abandonado em vez de enfiar a câmera
   * dentro do corpo. O plano de busca é o tangente, não o XZ do mundo.
   */
  skillClose(position: Vec3, _yaw: number, tier: 1 | 2 | 3, progress: number): void {
    const up = this.frame.up(position);
    const forward = normalize(reject(this.planet.motorHeading, up), {x: 0, y: 0, z: 1});
    const right = cross(up, forward);
    const pivot = add(position, scale(up, 1.05));
    let close: Vec3 | undefined, bestDistance = 0;
    for (const angle of [0, 0.65, -0.65, 1.25, -1.25]) {
      const direction = add(scale(forward, Math.cos(angle)), scale(right, Math.sin(angle)));
      const delta = add(
        add(scale(direction, 3.45 - progress * 0.22), scale(right, tier === 2 ? -0.38 : 0.38)),
        scale(up, 0.22),
      );
      const hit = this.collision?.sweepCapsule(sub(pivot, scale(up, 0.16)), up, delta, 0.16, 0.32);
      const fraction = hit ? Math.max(0, hit.time - 0.05) : 1;
      const distance = length(delta) * fraction;
      if (distance > bestDistance) {bestDistance = distance; close = add(pivot, scale(delta, fraction));}
      if (distance > 2.6) break;
    }
    if (!close || bestDistance < 1.35) return;
    const weight = Math.min(1, progress * 9);
    const from = {x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z};
    const mixed = add(from, scale(sub(close, from), weight));
    const normalTarget = add(from, scale({x: this.forward.x, y: this.forward.y, z: this.forward.z}, 3));
    const look = add(normalTarget, scale(sub(pivot, normalTarget), weight));
    this.applyPose(mixed, sub(look, mixed), up, (tier === 3 ? -0.035 : 0.025) * weight);
    this.hideFoliageAround(mixed);
  }

  blend(position: Vec3, target: Vec3, weight: number, up?: Vec3): void {
    const w = Math.max(0, Math.min(1, weight));
    if (w <= 0) return;
    const from = {x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z};
    const mixed = add(from, scale(sub(position, from), w));
    const forward = {x: this.forward.x, y: this.forward.y, z: this.forward.z};
    const look = normalize(sub(target, mixed), forward);
    const blended = add(forward, scale(sub(look, forward), w));
    const wantedUp = up ?? this.frame.up(mixed);
    const mixedUp = add(this.upValue, scale(sub(wantedUp, this.upValue), w));
    this.applyPose(mixed, blended, mixedUp, 0);
  }

  /**
   * Escreve posição e orientação por QUATERNION.
   *
   * `TargetCamera.setTarget` não serve num planeta: ele reconstrói a rotação com um `LookAtLH` que
   * usa o `Y` do mundo e depois força `rotation.z = 0`. Quem está no equador e olha para o polo
   * passa exatamente por essa degeneração, e a imagem gira sozinha.
   */
  private applyPose(position: Vec3, forward: Vec3, up: Vec3, roll: number): void {
    if (!finite(position) || !finite(forward) || !finite(up)) return;
    const z = normalize(forward, {x: 0, y: 0, z: 1});
    let y = reject(up, z);
    if (length(y) < 1e-6) y = perpendicular(z);
    y = normalize(y, {x: 0, y: 1, z: 0});
    if (roll) {
      const x0 = cross(y, z);
      y = normalize(add(scale(y, Math.cos(roll)), scale(x0, Math.sin(roll))), y);
    }
    const x = cross(y, z);
    this.axisX.set(x.x, x.y, x.z);
    this.axisY.set(y.x, y.y, y.z);
    this.axisZ.set(z.x, z.y, z.z);
    Matrix.FromXYZAxesToRef(this.axisX, this.axisY, this.axisZ, this.matrix);
    Quaternion.FromRotationMatrixToRef(this.matrix, this.rotation);
    this.camera.position.set(position.x, position.y, position.z);
    this.forward.set(z.x, z.y, z.z);
  }

  /** Mesma cortesia do jogo plano: folhagem entre a câmera e o corpo some durante o close. */
  private hideFoliageAround(at: Vec3): void {
    for (const mesh of this.camera.getScene().meshes) {
      if (!mesh.isVisible || !mesh.isEnabled() || !/fern|grass/i.test(mesh.name)) continue;
      const box = mesh.getBoundingInfo().boundingBox;
      if (at.x > box.minimumWorld.x - 0.25 && at.x < box.maximumWorld.x + 0.25
        && at.y > box.minimumWorld.y - 0.25 && at.y < box.maximumWorld.y + 0.25
        && at.z > box.minimumWorld.z - 0.25 && at.z < box.maximumWorld.z + 0.25) {
        mesh.isVisible = false;
        this.closeHidden.push(mesh);
      }
    }
  }

  dispose(): void {this.camera.dispose();}
}

const finite = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

const perpendicular = (axis: Vec3): Vec3 => {
  const seed = Math.abs(axis.y) < 0.9 ? {x: 0, y: 1, z: 0} : {x: 1, y: 0, z: 0};
  return normalize(cross(axis, cross(seed, axis)), {x: 0, y: 1, z: 0});
};

/** Ângulo de marcha da câmera medido contra uma tangente de referência — para HUD e melee. */
export const headingAngle = (up: Vec3, reference: Vec3, heading: Vec3): number => {
  const forward = normalize(reject(reference, up), {x: 0, y: 0, z: 1});
  const right = cross(up, forward);
  const value = Math.atan2(dot(heading, right), dot(heading, forward));
  return Number.isFinite(value) ? value : 0;
};

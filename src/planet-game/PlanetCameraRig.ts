import {FreeCamera} from '@babylonjs/core/Cameras/freeCamera';
import {Matrix, Quaternion, Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../core/contracts';
import {CAMERA_TUNING} from '../player/PlayerTuning';
import {PlanetCamera, type CameraPose} from '../planet/PlanetCamera';
import type {PlanetCollision} from '../planet/PlanetCollision';
import type {PlanetFrame} from '../planet/PlanetFrame';
import {cross, dot, normalize, scale, sub} from '../planet/PlanetFrame';

/**
 * Ponte entre a pose pura do núcleo (`PlanetCamera`) e a `FreeCamera` do Babylon.
 *
 * **Por que não `camera.setTarget(...)`.** `TargetCamera.setTarget` reconstrói a rotação a partir
 * de um `LookAtLH` com o `Y` do MUNDO e depois força `rotation.z = 0`. Num planeta o olhar passa
 * exatamente por ±Y de mundo o tempo todo (quem está no equador e olha para o polo), e é ali que
 * essa extração de Euler degenera. Aqui a orientação entra como quaternion e
 * `updateUpVectorFromRotation` recalcula o `upVector` a cada quadro a partir dele — roll verdadeiro
 * do planeta, sem polo e sem `PlanetaryHorizon` (que é roll cosmético sobre simulação plana).
 */
export class PlanetCameraRig {
  readonly camera: FreeCamera;
  readonly planet: PlanetCamera;
  private readonly rotation = Quaternion.Identity();
  private readonly matrix = Matrix.Identity();
  private readonly axisX = new Vector3();
  private readonly axisY = new Vector3();
  private readonly axisZ = new Vector3();
  private pose: CameraPose;

  constructor(scene: Scene, frame: PlanetFrame, anchor: Vec3, options: {collision?: PlanetCollision; heading?: Vec3} = {}) {
    this.planet = new PlanetCamera(frame, anchor, options);
    this.camera = new FreeCamera('planet-camera', new Vector3(anchor.x, anchor.y, anchor.z), scene);
    this.camera.minZ = CAMERA_TUNING.near;
    // O planeta inteiro tem de caber no plano distante: da órbita de chegada a casca oposta fica
    // a mais de dois raios de distância.
    this.camera.maxZ = Math.max(1200, frame.ceilingRadius * 6);
    this.camera.fov = CAMERA_TUNING.fov;
    this.camera.inputs.clear();
    this.camera.rotationQuaternion = this.rotation;
    this.camera.updateUpVectorFromRotation = true;
    this.pose = this.planet.update(anchor, 1 / 60);
    this.apply(this.pose.position, this.pose.forward, this.pose.up);
  }

  /** Giro do mouse: `dx` roda em torno do `up` TRANSPORTADO do corpo, nunca do Y do mundo. */
  look(dx: number, dy: number, up: Vec3): void {this.planet.look(dx, dy, up);}

  /** Avança a pose do núcleo e aplica na câmera real. */
  update(anchor: Vec3, dt: number): CameraPose {
    this.pose = this.planet.update(anchor, dt);
    this.apply(this.pose.position, this.pose.forward, this.pose.up);
    return this.pose;
  }

  /** Direção de visão do quadro corrente, já com o pitch. */
  get forward(): Vec3 {return this.pose.forward;}
  /** Tangente de marcha que o motor consome. */
  get heading(): Vec3 {return this.planet.motorHeading;}
  get pitch(): number {return this.planet.pitch;}
  get up(): Vec3 {return this.pose.up;}

  /**
   * Escreve posição e orientação direto na câmera.
   *
   * `up` é só uma dica: o que orienta de fato é a base ortonormal construída aqui, então um `up`
   * quase paralelo ao olhar não produz NaN — cai numa perpendicular estável.
   */
  apply(position: Vec3, forward: Vec3, up: Vec3): void {
    if (!finite(position) || !finite(forward) || !finite(up)) return;
    const z = normalize(forward, {x: 0, y: 0, z: 1});
    let y = sub(up, scale(z, dot(up, z)));
    if (Math.hypot(y.x, y.y, y.z) < 1e-6) y = perpendicular(z);
    y = normalize(y, {x: 0, y: 1, z: 0});
    const x = cross(y, z);
    this.axisX.set(x.x, x.y, x.z);
    this.axisY.set(y.x, y.y, y.z);
    this.axisZ.set(z.x, z.y, z.z);
    Matrix.FromXYZAxesToRef(this.axisX, this.axisY, this.axisZ, this.matrix);
    Quaternion.FromRotationMatrixToRef(this.matrix, this.rotation);
    this.camera.position.set(position.x, position.y, position.z);
  }

  /** Mistura a pose atual com uma pose de apresentação (chegada em órbita, morte, revisão). */
  blend(position: Vec3, target: Vec3, up: Vec3, weight: number): void {
    const w = Math.max(0, Math.min(1, weight));
    if (w <= 0) return;
    const current = this.camera.position;
    const mixed = {
      x: current.x + (position.x - current.x) * w,
      y: current.y + (position.y - current.y) * w,
      z: current.z + (position.z - current.z) * w,
    };
    const look = normalize(sub(target, mixed), this.pose.forward);
    const blendedForward = normalize({
      x: this.pose.forward.x + (look.x - this.pose.forward.x) * w,
      y: this.pose.forward.y + (look.y - this.pose.forward.y) * w,
      z: this.pose.forward.z + (look.z - this.pose.forward.z) * w,
    }, look);
    const blendedUp = normalize({
      x: this.pose.up.x + (up.x - this.pose.up.x) * w,
      y: this.pose.up.y + (up.y - this.pose.up.y) * w,
      z: this.pose.up.z + (up.z - this.pose.up.z) * w,
    }, up);
    this.apply(mixed, blendedForward, blendedUp);
  }

  dispose(): void {this.camera.dispose();}
}

const finite = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

const perpendicular = (axis: Vec3): Vec3 => {
  const seed = Math.abs(axis.y) < 0.9 ? {x: 0, y: 1, z: 0} : {x: 1, y: 0, z: 0};
  return normalize(cross(axis, cross(seed, axis)), {x: 0, y: 1, z: 0});
};

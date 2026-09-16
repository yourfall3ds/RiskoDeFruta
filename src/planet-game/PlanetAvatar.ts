import {Matrix, Quaternion, Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {CharacterVisual} from '../animation/CharacterVisual';
import {aimArmAt} from '../animation/AimArm';
import type {PlayerMotor} from '../player/PlayerMotor';
import type {Vec3} from '../core/contracts';
import {cross, dot, normalize, scale, sub} from '../planet/PlanetFrame';

/**
 * O gunslinger autoral andando num planeta, SEM tocar no rig nem na `CharacterVisual`.
 *
 * A ideia inteira é uma troca de referencial:
 *
 *  - um `TransformNode` pai (`frame`) carrega a pose RADIAL do mundo — posição do pé, `up` local
 *    e uma tangente de referência transportada;
 *  - a `CharacterVisual` continua vendo um mundo Y-up comum, porque recebe uma *pose local*: a
 *    posição é a origem do pai, a velocidade vem projetada na base tangente e o `yaw` é o ângulo
 *    em torno do `up` local medido contra a tangente de referência.
 *
 * Assim os clipes importados (Idle/Walk/Run/Jump/Land/Dodge…) tocam exatamente como no jogo plano,
 * inclusive a mistura direcional e o amortecimento de orientação, e nada aqui posiciona osso.
 *
 * ## Campos de `PlayerMotor` realmente lidos pela `CharacterVisual`
 *
 * O elenco de compatibilidade abaixo existe porque `PlayerMotor` tem estado privado que não dá
 * para reproduzir estruturalmente. Estes — e só estes — são os campos consumidos:
 *
 * `position`, `previous`, `velocity`, `yaw`, `grounded`, `sprinting`, `bumpRemaining`,
 * `wallSliding`, `dodgeRemaining`, `dodgeYaw`, `backflipProgress`, `jumpMultiplier`.
 *
 * Qualquer campo novo que a `CharacterVisual` passe a ler aparece como `undefined` aqui; por isso
 * `LOCAL_POSE_FIELDS` está escrito e é verificado por teste.
 */
export const LOCAL_POSE_FIELDS = [
  'position', 'previous', 'velocity', 'yaw', 'grounded', 'sprinting',
  'bumpRemaining', 'wallSliding', 'dodgeRemaining', 'dodgeYaw', 'backflipProgress', 'jumpMultiplier',
] as const;

/** Pose local Y-up entregue à `CharacterVisual`. Nenhum destes valores é espaço de mundo. */
export interface LocalMotorPose {
  position: Vec3;
  previous: Vec3;
  velocity: Vec3;
  yaw: number;
  grounded: boolean;
  sprinting: boolean;
  bumpRemaining: number;
  wallSliding: boolean;
  dodgeRemaining: number;
  dodgeYaw: number;
  backflipProgress: number;
  jumpMultiplier: number;
}

export function createLocalPose(): LocalMotorPose {
  return {
    position: {x: 0, y: 0, z: 0},
    previous: {x: 0, y: 0, z: 0},
    velocity: {x: 0, y: 0, z: 0},
    yaw: 0, grounded: true, sprinting: false,
    bumpRemaining: 0, wallSliding: false,
    dodgeRemaining: 0, dodgeYaw: 0, backflipProgress: -1, jumpMultiplier: 1,
  };
}

/** Estado de mundo de um quadro, já interpolado pela apresentação. */
export interface AvatarFrameState {
  /** Posição do pé em espaço de mundo. */
  readonly position: Vec3;
  /** Vertical local (unitária). */
  readonly up: Vec3;
  /** Tangente de referência transportada (unitária, perpendicular a `up`). */
  readonly reference: Vec3;
  /** Direção para onde o corpo olha, em espaço de mundo (tangente). */
  readonly facing: Vec3;
  /** Velocidade em espaço de mundo. */
  readonly velocity: Vec3;
  readonly grounded: boolean;
  readonly sprinting: boolean;
}

/**
 * Ângulo em torno de `up` que leva a tangente `reference` até `facing`.
 * Mesma convenção de mão-esquerda do jogo: `right = up × forward`, `facing = (sin y, 0, cos y)`.
 */
export function localYaw(up: Vec3, reference: Vec3, facing: Vec3): number {
  const forward = normalize(reference), right = cross(up, forward);
  const value = Math.atan2(dot(facing, right), dot(facing, forward));
  return Number.isFinite(value) ? value : 0;
}

/** Componentes de `v` na base local `{right, up, forward}`. */
export function localVector(up: Vec3, reference: Vec3, v: Vec3): Vec3 {
  const forward = normalize(reference), right = cross(up, forward);
  return {x: dot(v, right), y: dot(v, up), z: dot(v, forward)};
}

export class PlanetAvatar {
  /** Pai radial: leva a `CharacterVisual` inteira do espaço local Y-up para o mundo. */
  readonly frame: TransformNode;
  readonly visual: CharacterVisual;
  private readonly pose = createLocalPose();
  private readonly rotation = Quaternion.Identity();
  private readonly matrix = Matrix.Identity();
  private readonly axisX = new Vector3();
  private readonly axisY = new Vector3();
  private readonly axisZ = new Vector3();
  private readonly aimDirection = new Vector3();
  private disposed = false;

  constructor(scene: Scene, onReady: () => void) {
    this.frame = new TransformNode('planet-avatar-frame', scene);
    this.frame.rotationQuaternion = this.rotation;
    this.visual = new CharacterVisual(scene, onReady);
    this.visual.root.parent = this.frame;
  }

  get ready(): boolean {return this.visual.ready;}
  get error(): string {return this.visual.error;}
  load(): Promise<void> {return this.visual.load();}

  /**
   * Orienta o pai e entrega a pose local à visual.
   *
   * `aimWorld`, quando presente, corrige a mira dos braços DEPOIS que a visual roda: a
   * `CharacterVisual` monta a direção de mira supondo Y-up de mundo, o que sob o pai rotacionado
   * apontaria para um canto fixo do espaço. `aimArmAt` é um alinhamento de "onde aponta" para
   * "onde deve apontar", então reaplicá-lo com a direção verdadeira corrige sem acumular.
   */
  update(state: AvatarFrameState, alpha: number, dt: number, options: {
    aiming: boolean; charging?: boolean; pitch?: number; chargeProgress?: number; aimWorld?: Vec3;
    /**
     * Pose de chegada (deck, corrida, salto, mergulho, levantar) em espaço LOCAL Y-up.
     *
     * A `CharacterVisual` já sabe tratar isto — é o mesmo campo do jogo plano — e o caminho dela
     * sai cedo, então nada da locomoção normal interfere. Aqui só é repassado: o pai radial
     * orientado logo abaixo é quem leva a pose ao planeta. Ausente, o comportamento é o de antes.
     */
    arrival?: CharacterVisual['arrivalPose'];
  }): void {
    if (this.disposed) return;
    const up = safeUnit(state.up, {x: 0, y: 1, z: 0});
    const reference = tangentOrFallback(state.reference, up);
    const facing = tangentOrFallback(state.facing, up, reference);
    this.axisY.set(up.x, up.y, up.z);
    this.axisZ.set(reference.x, reference.y, reference.z);
    const right = cross(up, reference);
    this.axisX.set(right.x, right.y, right.z);
    Matrix.FromXYZAxesToRef(this.axisX, this.axisY, this.axisZ, this.matrix);
    Quaternion.FromRotationMatrixToRef(this.matrix, this.rotation);
    this.frame.position.set(state.position.x, state.position.y, state.position.z);

    const velocity = localVector(up, reference, state.velocity);
    this.pose.velocity.x = velocity.x; this.pose.velocity.y = velocity.y; this.pose.velocity.z = velocity.z;
    this.pose.yaw = localYaw(up, reference, facing);
    this.pose.grounded = state.grounded;
    this.pose.sprinting = state.sprinting;
    this.visual.arrivalPose = options.arrival;
    this.visual.update(
      this.pose as unknown as PlayerMotor,
      alpha, dt,
      options.aiming, options.charging ?? false, options.pitch ?? 0, options.chargeProgress ?? 0,
    );
    if (options.aimWorld && options.aiming) this.applyWorldAim(options.aimWorld);
  }

  /** Re-alinha cada braço com a direção de mira VERDADEIRA em espaço de mundo. */
  private applyWorldAim(direction: Vec3): void {
    const length = Math.hypot(direction.x, direction.y, direction.z);
    if (!(length > 1e-6)) return;
    this.aimDirection.set(direction.x / length, direction.y / length, direction.z / length);
    for (const [index, side] of ['Right', 'Left'].entries()) {
      const arm = this.visual.root.getScene().getTransformNodeByName(`${side}Arm`);
      const grip = this.visual.grips[index];
      if (!arm?.rotationQuaternion || !arm.parent || !grip) continue;
      aimArmAt(arm, grip, this.aimDirection);
    }
  }

  /** Posição de mundo do pé no quadro corrente (o pai já carrega a interpolação). */
  get worldPosition(): Vector3 {return this.frame.position;}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.visual.dispose();
    this.frame.dispose();
  }
}

const safeUnit = (v: Vec3, fallback: Vec3): Vec3 => {
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return fallback;
  const length = Math.hypot(v.x, v.y, v.z);
  return length < 1e-9 ? fallback : {x: v.x / length, y: v.y / length, z: v.z / length};
};

/** Projeta no plano tangente de `up`; degenerado cai numa tangente estável (ou na de reserva). */
const tangentOrFallback = (v: Vec3, up: Vec3, reserve?: Vec3): Vec3 => {
  const safe = Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? v : {x: 0, y: 0, z: 1};
  const planar = sub(safe, scale(up, dot(safe, up)));
  if (Math.hypot(planar.x, planar.y, planar.z) > 1e-6) return normalize(planar);
  if (reserve) return reserve;
  const seed = Math.abs(up.y) < 0.9 ? {x: 0, y: 1, z: 0} : {x: 1, y: 0, z: 0};
  return normalize(cross(seed, up), {x: 0, y: 0, z: 1});
};

import {Matrix, Quaternion, Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {Vec3} from '../core/contracts';
import type {PlayerMotor} from '../player/PlayerMotor';
import type {SurfaceFrame} from '../physics/SurfaceFrame';
import {localComponents} from '../physics/SurfaceFrame';
import type {CharacterPose, CharacterVisual} from './CharacterVisual';

/**
 * O gunslinger autoral andando num planeta — sem tocar no rig e sem tocar na `CharacterVisual`.
 *
 * A ideia é uma troca de referencial, não uma animação nova:
 *
 * - um `TransformNode` pai carrega a pose RADIAL de mundo (posição do pé + base `{right, up,
 *   reference}`, onde `reference` é a tangente transportada que o `PlayerMotor` já mantém);
 * - a `CharacterVisual` continua vendo um mundo Y-up comum, porque recebe uma **pose local**.
 *
 * Com o motor radial da física, quase tudo já vem pronto: `motor.yaw` **já é** o yaw local em torno
 * de `up` medido a partir de `reference`, e `dodgeYaw`/`dashYaw` também. Sobra converter três
 * campos — posição, posição anterior e velocidade — que continuam (corretamente) em mundo.
 *
 * No mundo plano esta classe não é usada: `PlayerScene` entrega o motor direto para a
 * `CharacterVisual`, exatamente como sempre fez.
 */

/** Os campos que a `CharacterVisual` realmente lê. Verificado por teste. */
export const LOCAL_POSE_FIELDS = [
  'position', 'previous', 'velocity', 'yaw', 'grounded', 'sprinting',
  'bumpRemaining', 'wallSliding', 'dodgeRemaining', 'dodgeYaw', 'backflipProgress', 'jumpMultiplier',
] as const;

export type LocalMotorPose = CharacterPose;

export class RadialAvatar {
  /** Pai radial: leva a `CharacterVisual` inteira do espaço local Y-up para o mundo. */
  readonly frame: TransformNode;
  /** Posição de MUNDO do pé neste quadro (o pai já carrega a interpolação). */
  readonly worldPosition = new Vector3();

  private readonly pose: LocalMotorPose = {
    position: {x: 0, y: 0, z: 0}, previous: {x: 0, y: 0, z: 0}, velocity: {x: 0, y: 0, z: 0},
    yaw: 0, grounded: true, sprinting: false,
    bumpRemaining: 0, wallSliding: false,
    dodgeRemaining: 0, dodgeYaw: 0, backflipProgress: -1, jumpMultiplier: 1,
  };
  private readonly rotation = Quaternion.Identity();
  private readonly matrix = Matrix.Identity();
  private readonly axisX = new Vector3();
  private readonly axisY = new Vector3();
  private readonly axisZ = new Vector3();
  private readonly inverse = new Matrix();
  private readonly scratch = new Vector3();

  /**
   * O referencial é consultado A CADA QUADRO, nunca guardado.
   *
   * O mapa do planeta carrega de forma assíncrona: quando o avatar é construído, o
   * `CollisionWorld` ainda não passou por `configurePlanet` e `collision.surface` responde o
   * referencial PLANO. Guardar essa referência congelaria o avatar em `up = +Y` para sempre — o
   * corpo ficaria deitado em qualquer ilha fora do polo norte, mesmo depois de o planeta existir.
   * Por isso o construtor recebe um PROVEDOR, e não um `SurfaceFrame`.
   */
  constructor(scene: Scene, readonly visual: CharacterVisual, private readonly surfaceOf: () => SurfaceFrame) {
    this.frame = new TransformNode('player-radial-frame', scene);
    this.frame.rotationQuaternion = this.rotation;
    this.visual.root.parent = this.frame;
  }

  private get surface(): SurfaceFrame {return this.surfaceOf();}

  /**
   * Orienta o pai e entrega a pose local à visual.
   *
   * A ordem importa: o pai é escrito ANTES de `visual.update`, porque a visual chama
   * `computeWorldMatrix` e posiciona mãos, coldres e efeitos a partir da matriz de mundo já
   * resolvida. Escrever o pai depois deixaria arma e corpo um quadro fora de fase.
   */
  update(
    motor: PlayerMotor, alpha: number, dt: number,
    aiming: boolean, charging: boolean, pitch: number, chargeProgress: number,
    aimWorld?: Vec3,
  ): void {
    const t = Math.max(0, Math.min(1, alpha));
    const position = {
      x: motor.previous.x + (motor.position.x - motor.previous.x) * t,
      y: motor.previous.y + (motor.position.y - motor.previous.y) * t,
      z: motor.previous.z + (motor.position.z - motor.previous.z) * t,
    };
    // A base do PAI usa `reference`, não `forward`: é contra a referência transportada que o
    // `yaw` do motor é medido, então é ela que tem de ser o `+Z` local. Usar `forward` aqui
    // giraria o corpo duas vezes.
    const basis = this.surface.basis(position, motor.reference);
    this.axisX.set(basis.right.x, basis.right.y, basis.right.z);
    this.axisY.set(basis.up.x, basis.up.y, basis.up.z);
    this.axisZ.set(basis.forward.x, basis.forward.y, basis.forward.z);
    Matrix.FromXYZAxesToRef(this.axisX, this.axisY, this.axisZ, this.matrix);
    Quaternion.FromRotationMatrixToRef(this.matrix, this.rotation);
    this.frame.position.set(position.x, position.y, position.z);
    this.worldPosition.set(position.x, position.y, position.z);

    const velocity = localComponents(basis, motor.velocity);
    this.pose.velocity.x = velocity.x; this.pose.velocity.y = velocity.y; this.pose.velocity.z = velocity.z;
    // `yaw`, `dodgeYaw` e `backflipProgress` já saem do motor no referencial LOCAL.
    this.pose.yaw = motor.yaw;
    this.pose.dodgeYaw = motor.dodgeYaw;
    this.pose.dodgeRemaining = motor.dodgeRemaining;
    this.pose.backflipProgress = motor.backflipProgress;
    this.pose.grounded = motor.grounded;
    this.pose.sprinting = motor.sprinting;
    this.pose.bumpRemaining = motor.bumpRemaining;
    this.pose.wallSliding = motor.wallSliding;
    this.pose.jumpMultiplier = motor.jumpMultiplier;

    // A pose de chegada/morte chega em MUNDO (a coreografia da nave não conhece referencial);
    // sob o pai ela precisa virar local, senão o corpo salta para o outro lado do planeta.
    const arrival = this.visual.arrivalPose;
    const worldArrivalPosition = arrival?.position;
    if (worldArrivalPosition) this.visual.arrivalPose = {...arrival!, position: this.toLocal(worldArrivalPosition)};
    const death = this.visual.deathPosition;
    if (death) this.visual.deathPosition = this.toLocal(death);

    this.visual.update(this.pose, alpha, dt, aiming, charging, pitch, chargeProgress, aimWorld);

    // A visual guarda `position` em espaço LOCAL (o pai carrega o mundo). Armas, efeitos e
    // apresentação querem MUNDO, então ela é reescrita aqui, depois da raiz.
    this.visual.position.copyFrom(Vector3.TransformCoordinates(this.visual.position, this.frame.getWorldMatrix()));
    if (worldArrivalPosition && arrival) this.visual.arrivalPose = arrival;
    if (death) this.visual.deathPosition = death;

  }

  /** Ponto de mundo → espaço do pai radial. */
  private toLocal(world: Vec3): Vec3 {
    this.frame.getWorldMatrix().invertToRef(this.inverse);
    this.scratch.set(world.x, world.y, world.z);
    const local = Vector3.TransformCoordinates(this.scratch, this.inverse);
    return {x: local.x, y: local.y, z: local.z};
  }

  dispose(): void {
    this.visual.root.parent = null;
    this.frame.dispose();
  }
}

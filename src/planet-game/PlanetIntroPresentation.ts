import {Matrix, Quaternion, Vector3} from '@babylonjs/core/Maths/math.vector';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../core/contracts';
import {DropshipDeck} from '../world/DropshipDeck';
import {cross} from '../planet/PlanetFrame';
import type {PlanetArrival} from './PlanetArrival';
import type {PlanetAvatar} from './PlanetAvatar';

/**
 * Lado de cena da chegada: a nave autoral e o corpo, desenhados sob uma base RADIAL.
 *
 * A `PlanetArrival` resolve a coreografia inteira num espaço local Y-up (ver a documentação dela).
 * Esta classe só existe para dar corpo a esse espaço dentro do Babylon:
 *
 *  - um `TransformNode` pai (`root`) carrega a base do desembarque — posição do pouso, vertical
 *    radial e tangente de corrida;
 *  - o `DropshipDeck` autoral (`public/models/dropship-deck.glb`, nenhum asset novo) pendura nesse
 *    pai e recebe a borda em coordenadas LOCAIS, então o `place`/`update` dele continua sendo o
 *    mesmo código Y-up do jogo plano, inclusive a flutuação do voo estacionário;
 *  - o `PlanetAvatar` recebe a base do pouso e a pose local da entrada, e o pai radial DELE faz o
 *    resto. Nenhum osso é tocado e nenhuma primitiva é criada.
 *
 * **Sem colisão e sem física.** O deck é cenário a centenas de metros de altitude; o corpo só o
 * "pisa" porque a entrada é apresentação pura com o motor travado.
 */
export class PlanetIntroPresentation {
  /** Pai radial do deck. Fica desligado junto com a nave quando a chegada acaba. */
  readonly root: TransformNode;
  private readonly deck: DropshipDeck;
  private readonly rotation = Quaternion.Identity();
  private readonly matrix = Matrix.Identity();
  private readonly axisX = new Vector3();
  private readonly axisY = new Vector3();
  private readonly axisZ = new Vector3();
  private disposed = false;

  constructor(scene: Scene) {
    this.root = new TransformNode('planet-intro-frame', scene);
    this.root.rotationQuaternion = this.rotation;
    this.deck = new DropshipDeck(scene);
    this.deck.root.parent = this.root;
  }

  /** A nave está em cena: sem ela a entrada precisa cair direto no mergulho. */
  get ready(): boolean {return this.deck.ready;}
  get error(): string {return this.deck.error;}
  /** `true` quando o prólogo no deck pode ser encenado (carregado ou ainda carregando é `ready`). */
  get prologue(): boolean {return this.deck.ready;}

  load(): Promise<void> {return this.deck.load();}

  /**
   * Desenha o quadro da chegada e devolve a posição de MUNDO do corpo (`undefined` quando a
   * entrada não está mais desenhando).
   *
   * Quem chama repassa esse retorno para `avatar.visual.position`, exatamente como já faz com a
   * posição interpolada do motor: as armas e os efeitos leem dali e precisam do mundo.
   */
  render(arrival: PlanetArrival, avatar: PlanetAvatar, alpha: number, dt: number): Vec3 | undefined {
    if (this.disposed) return undefined;
    const body = arrival.body;
    if (!body || !avatar.ready) {
      this.deck.update(0, false);
      this.root.setEnabled(false);
      return body?.world;
    }
    this.root.setEnabled(true);
    this.orient(body.anchor, body.up, body.reference);
    this.deck.place(arrival.deckEdgeLocal, 0);
    this.deck.update(dt, arrival.deckVisible);
    avatar.update({
      position: body.anchor,
      up: body.up,
      reference: body.reference,
      // O corpo olha ao longo da própria tangente de referência: o `yaw` local sai 0 e a entrada
      // fica dona de toda a orientação, como no jogo plano.
      facing: body.reference,
      velocity: ZERO,
      grounded: body.phase === 'standby' || body.phase === 'run' || body.phase === 'recover',
      sprinting: body.phase === 'run',
    }, alpha, dt, {aiming: false, arrival: body.local});
    avatar.visual.position.copyFromFloats(body.world.x, body.world.y, body.world.z);
    return body.world;
  }

  /** Esconde a nave sem destruir nada — usado ao pular a entrada, ao morrer e ao trocar de ilha. */
  hide(): void {
    if (this.disposed) return;
    this.deck.update(0, false);
    this.root.setEnabled(false);
  }

  /** Base do pai: eixo X = `right`, Y = vertical do pouso, Z = tangente de corrida. */
  private orient(anchor: Vec3, up: Vec3, reference: Vec3): void {
    const right = cross(up, reference);
    this.axisX.set(right.x, right.y, right.z);
    this.axisY.set(up.x, up.y, up.z);
    this.axisZ.set(reference.x, reference.y, reference.z);
    Matrix.FromXYZAxesToRef(this.axisX, this.axisY, this.axisZ, this.matrix);
    Quaternion.FromRotationMatrixToRef(this.matrix, this.rotation);
    this.root.position.set(anchor.x, anchor.y, anchor.z);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.deck.dispose();
    this.root.dispose(false, false);
  }
}

const ZERO: Vec3 = {x: 0, y: 0, z: 0};

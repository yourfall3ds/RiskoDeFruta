import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {InstantiatedEntries} from '@babylonjs/core/assetContainer';
import type {Scene} from '@babylonjs/core/scene';
import type {Skeleton} from '@babylonjs/core/Bones/skeleton';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Matrix, Quaternion, Vector3} from '@babylonjs/core/Maths/math.vector';
import {Axis} from '@babylonjs/core/Maths/math.axis';
import type {Observer} from '@babylonjs/core/Misc/observable';
import {Ragdoll, type RagdollBoneProperties} from '@babylonjs/core/Physics/v2/ragdoll';
import {PhysicsConstraintAxis, PhysicsConstraintAxisLimitMode, PhysicsConstraintType} from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import type {IPhysicsEnginePluginV2} from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import type {Vec3} from '../core/contracts';
import {ensureRagdollPhysics} from '../physics/RagdollWorld';
import {applyBonePoses, bodyFrame, openLimb, readBonePoses, segmentLength, skeletonHeight, type BodyFrame, type BonePose} from './CorpsePose';

/**
 * Queda articulada REAL do jogador — corpos rígidos por segmento, juntas do Havok, gravidade local.
 *
 * Substitui a morte "dura" (o clipe `FinalDeath` do asset) por simulação. O que existe aqui é físico:
 * sixteen corpos ligados por restrições, cada um com massa e tamanho MEDIDOS no rig autoral.
 *
 * ## O rig, medido (não suposto) — `public/models/gunslinger.glb`
 *
 * `__root__` é uma Mesh com `scaling = (1, 1, −1)` (reflexão do glTF, determinante −1); 1 esqueleto
 * `Gunslinger_Rig` com 24 ossos e uma única raiz `Hips`; **todos** os ossos têm
 * `linkedTransformNode`; uma única malha skinada `char1` (16 816 vértices); `bone.length` é
 * `undefined` nos 24 ossos; escala de osso 1; coordenadas do rig em centímetros, convertidas pela matriz da malha.
 *
 * Três consequências que este arquivo trata de frente:
 *
 * 1. **`putBoxInBoneCenter` do Babylon é proibido** — ele divide `bone.length / 2`, e aqui isso é
 *    `NaN`. Os offsets vêm de `segmentLength`, que mede a distância real ao osso filho no asset.
 * 2. **Os ossos do CLONE são desligados dos nós** (`linkTransformNode(null)`). Num rig ligado, a
 *    `Skeleton.prepare` reconstrói a matriz do osso a partir do nó a cada quadro e descartaria o que
 *    a física escreve; desligar no clone — que é meu — elimina o conflito na origem em vez de
 *    disputar quadro a quadro com a reflexão da raiz. É também o que garante que **nenhuma escrita
 *    toque o rig VIVO**.
 * 3. **Os grupos de animação do clone são descartados**: cadáver não anima.
 *
 * ## Orçamento e independência
 *
 * A inicialização do Havok é a do jogo (`ensureRagdollPhysics`, da propriedade dos inimigos, usada
 * só para leitura). Mas a instância de `Ragdoll` e o observador são MEUS: o cadáver do jogador não
 * entra na lista do `RagdollWorld` e portanto **nunca é despejado pelo orçamento de quatro corpos
 * dos inimigos**. Teto próprio de 16 corpos (limite duro 20).
 *
 * Contrato publicado em `.temp/player-ragdoll-api.md`.
 */

/** O rig VIVO, lido só para copiar a pose. Nada aqui é escrito. */
export interface LivePose {
  readonly skeleton: Skeleton;
  /** Nó cuja matriz de mundo leva o espaço do esqueleto ao MUNDO (a malha skinada ou o pai dela). */
  readonly root: TransformNode;
}

export interface PlayerRagdollStart {
  pose: LivePose;
  /** Velocidade do corpo no instante da morte (m/s, MUNDO). */
  velocity?: Vec3;
  /** Golpe fatal — `forceDirection`/`forceMagnitude` do `DamageContext`. */
  lethal?: {direction: Vec3; magnitude: number; point?: Vec3};
  /** Equipamento que acompanha o cadáver; reparentado no osso pedido do CLONE. */
  equipment?: readonly {node: TransformNode; bone: string}[];
}

export interface PlayerRagdollTuning {
  /** Massa total, distribuída pelos segmentos por fração antropométrica. */
  mass: number;
  /** Espessura do membro como fração do comprimento medido. */
  limbThickness: number;
  /**
   * Abertura de cada junta, em graus, MEDIDA A PARTIR DA POSE DA MORTE — não da pose de bind.
   *
   * O limite é imposto por este arquivo (ver `limitJoints`), porque o `Ragdoll` do Babylon guarda
   * `min`/`max` e nunca os usa. Cada segmento escala este teto pelo próprio `limit`.
   */
  jointDegrees: number;
  restitution: number;
  friction: number;
  /** Teto da velocidade que o golpe fatal imprime, m/s. */
  maxLaunch: number;
  settleSpeed: number;
  settleSeconds: number;
  /** Teto do giro de abertura de cada membro na morte, em graus. */
  openDegrees: number;
  /** Fração do caminho até a direção aberta. `1` seria pose forçada; o default relaxa, não impõe. */
  openBlend: number;
  /** Empurrão de abertura dado aos membros no quadro da morte, m/s. */
  limbSpread: number;
  /** Amortecimento angular base; cada segmento o escala pelo próprio `damping`. */
  angularDamping: number;
}

export const PLAYER_RAGDOLL_TUNING: PlayerRagdollTuning = {
  mass: 78, limbThickness: .34, jointDegrees: 62, restitution: .04, friction: .7,
  maxLaunch: 9, settleSpeed: .35, settleSeconds: .6,
  openDegrees: 82, openBlend: .78, limbSpread: 1.15, angularDamping: .8,
};

export interface PlayerRagdollOptions {
  scene: Scene;
  corpse: AssetContainer | (() => Promise<AssetContainer>);
  /** Vertical local por PONTO, lida a cada quadro. Plano: `(0,−1,0)`. Planeta: `surface.down(p)`. */
  down?: (p: Vec3) => Vec3;
  /** Terreno físico em volta do cadáver; devolve o `release`. Reaproveite `addRagdollTerrain`. */
  terrain?: (centre: Vec3) => (() => void) | undefined;
  /** Teto de corpos articulados. Default 16; limite duro 20. */
  maxBodies?: number;
  tuning?: Partial<PlayerRagdollTuning>;
}

/** Limite duro de corpos simultâneos para um único cadáver. */
export const MAX_PLAYER_RAGDOLL_BODIES = 20;

/**
 * Esqueleto do corpo articulado, em ordem de prioridade.
 *
 * `child` é o osso usado para MEDIR o segmento no asset. `mass` é a fração antropométrica da massa
 * total (soma ≈ 1). Os dezesseis primeiros que existirem no rig entram; o resto é descartado, então
 * um asset com menos ossos degrada em vez de explodir.
 */
interface Segment {
  bone: string;
  /** Osso filho para medir o comprimento. Ausente (mãos) usa `fraction` da altura do personagem. */
  child?: string;
  /** Fração da altura do personagem, quando não há filho para medir. */
  fraction?: number;
  /** Fração da massa total. */
  mass: number;
  /** Multiplicador de espessura sobre o default. */
  girth: number;
  joint: number;
  /**
   * Abertura da junta como fração de `jointDegrees`. Coluna e pescoço curtos, ombro e cotovelo
   * largos: é o que separa um corpo que desaba de um corpo que só relaxa.
   */
  limit: number;
  /** Empurrão de abertura, como fração de `limbSpread`. Positivo afasta o membro da linha do corpo. */
  spread: number;
  /** Multiplicador do amortecimento angular: tronco pesado freia mais que a ponta de um braço. */
  damping: number;
}

const BALL = PhysicsConstraintType.BALL_AND_SOCKET;
const SEGMENTS: readonly Segment[] = [
  {bone: 'Hips', child: 'Spine02', mass: .16, girth: 1.5, joint: BALL, limit: 1, spread: 0, damping: 1.5},
  {bone: 'Spine01', child: 'Spine', mass: .14, girth: 1.5, joint: BALL, limit: .3, spread: 0, damping: 1.5},
  {bone: 'Spine', child: 'neck', mass: .20, girth: 1.6, joint: BALL, limit: .3, spread: 0, damping: 1.5},
  {bone: 'Head', child: 'head_end', mass: .08, girth: 1.3, joint: BALL, limit: .45, spread: 0, damping: 1.2},
  {bone: 'LeftUpLeg', child: 'LeftLeg', mass: .10, girth: 1, joint: BALL, limit: .95, spread: .3, damping: .9},
  {bone: 'RightUpLeg', child: 'RightLeg', mass: .10, girth: 1, joint: BALL, limit: .95, spread: .26, damping: .9},
  {bone: 'LeftLeg', child: 'LeftFoot', mass: .045, girth: .85, joint: BALL, limit: 1, spread: .34, damping: .7},
  {bone: 'RightLeg', child: 'RightFoot', mass: .045, girth: .85, joint: BALL, limit: 1, spread: .28, damping: .7},
  {bone: 'LeftArm', child: 'LeftForeArm', mass: .027, girth: .8, joint: BALL, limit: 1.15, spread: .85, damping: .55},
  {bone: 'RightArm', child: 'RightForeArm', mass: .027, girth: .8, joint: BALL, limit: 1.15, spread: .72, damping: .55},
  {bone: 'LeftForeArm', child: 'LeftHand', mass: .016, girth: .7, joint: BALL, limit: 1.1, spread: 1, damping: .45},
  {bone: 'RightForeArm', child: 'RightHand', mass: .016, girth: .7, joint: BALL, limit: 1.1, spread: .84, damping: .45},
  {bone: 'LeftFoot', child: 'LeftToeBase', mass: .014, girth: .9, joint: BALL, limit: .5, spread: .3, damping: .8},
  {bone: 'RightFoot', child: 'RightToeBase', mass: .014, girth: .9, joint: BALL, limit: .5, spread: .24, damping: .8},
  {bone: 'LeftHand', fraction: .055, mass: .006, girth: .9, joint: BALL, limit: .55, spread: 1.1, damping: .45},
  {bone: 'RightHand', fraction: .055, mass: .006, girth: .9, joint: BALL, limit: .55, spread: .92, damping: .45},
];

/** Lado do corpo lido no NOME do osso: `+1` esquerda, `−1` direita, `0` linha do meio. */
function boneSide(bone: string): number {
  return bone.startsWith('Left') ? 1 : bone.startsWith('Right') ? -1 : 0;
}

/**
 * Ruído determinístico em `[−.5, .5)` por corpo e por eixo.
 *
 * A queda tem de variar de membro para membro — dezesseis corpos com o MESMO giro inicial caem como
 * um bloco só. Mas não pode ser `Math.random`: a suíte repete a mesma morte e compara números.
 */
function wobble(index: number, salt: number): number {
  const v = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v) - .5;
}

/** Rascunhos: dezesseis corpos por quadro não podem alocar nada. */
const scratchVelocity = new Vector3();
const scratchPoint: Vec3 = {x: 0, y: 0, z: 0};

export class PlayerRagdoll {
  private readonly scene: Scene;
  private readonly tuning: PlayerRagdollTuning;
  private readonly maxBodies: number;
  private container: AssetContainer | undefined;
  private ownsContainer = false;
  private instance: InstantiatedEntries | undefined;
  private corpse: TransformNode | undefined;
  private corpseSkeleton: Skeleton | undefined;
  private corpseMesh: Mesh | undefined;
  private bind: BonePose[] = [];
  private rig: Ragdoll | undefined;
  private observer: Observer<Scene> | undefined;
  private releaseTerrain: (() => void) | undefined;
  private borrowed: {node: TransformNode; parent: TransformNode | null; position: Vector3; rotation: Vector3; quaternion: Quaternion | null; scaling: Vector3}[] = [];
  private count = 0;
  private quiet = 0;
  private preparing: Promise<void> | undefined;
  private readonly centre = new Vector3();
  private readonly hips = new Vector3();
  /** Corpos que receberam correção radial no último `update` — diagnóstico e teste. */
  bodiesUnderLocalGravity = 0;
  /** Juntas que receberam limite angular no `start` — uma por corpo, menos a raiz. */
  limitedJoints = 0;
  /** Membros que foram abertos no `start` (ver `openPose`). */
  openedLimbs = 0;
  error = '';

  constructor(private readonly options: PlayerRagdollOptions) {
    this.scene = options.scene;
    this.tuning = {...PLAYER_RAGDOLL_TUNING, ...options.tuning};
    this.maxBodies = Math.max(1, Math.min(MAX_PLAYER_RAGDOLL_BODIES, Math.floor(options.maxBodies ?? 16)));
  }

  get ready(): boolean {return this.corpseSkeleton !== undefined && this.corpseMesh !== undefined;}
  get active(): boolean {return this.rig !== undefined;}
  get bodies(): number {return this.count;}
  get settled(): boolean {return this.active && this.quiet >= this.tuning.settleSeconds;}
  /** Centro de massa do cadáver, em MUNDO. */
  get position(): Vector3 {return this.centre;}
  /** Quadril: foco natural do enquadramento da morte. */
  get focus(): Vector3 {return this.hips;}
  /** Raiz do clone, para quem precisa ligar sombra ou consultar. Nunca reparentar. */
  get corpseRoot(): TransformNode | undefined {return this.corpse;}

  /**
   * Instancia o clone e garante o Havok. Chame no CARREGAMENTO: na morte só sobra criar os corpos.
   * Idempotente e seguro contra chamadas concorrentes.
   */
  prepare(): Promise<void> {
    return this.preparing ??= this.build().catch(error => {
      this.error = 'Ragdoll do jogador: ' + String(error);
      this.preparing = undefined;
    });
  }

  private async build(): Promise<void> {
    await ensureRagdollPhysics(this.scene);
    if (this.scene.isDisposed || this.ready) return;
    if (typeof this.options.corpse === 'function') {
      this.container = await this.options.corpse();
      this.ownsContainer = true;
    } else this.container = this.options.corpse;
    if (this.scene.isDisposed) return;
    const instance = this.container.instantiateModelsToScene(name => 'player-corpse-' + name, false, {doNotInstantiate: true});
    const skeleton = instance.skeletons[0];
    const root = instance.rootNodes[0];
    if (!skeleton || !root) {instance.dispose(); throw Error('Cadáver sem esqueleto ou sem raiz');}
    // Cadáver não anima: os clipes clonados são descartados, não só parados.
    for (const clip of instance.animationGroups) {clip.stop(); clip.dispose();}
    /**
     * Desliga os ossos do clone dos nós autorais. Num rig ligado a `Skeleton.prepare` reconstrói a
     * matriz do osso a partir do nó e descartaria a pose física; desligar aqui resolve na origem.
     * O rig VIVO não é tocado — isto é o clone.
     */
    for (const bone of skeleton.bones) if (bone.getTransformNode()) bone.linkTransformNode(null);
    root.parent = null;
    const meshes = root.getChildMeshes().filter(m => m.getTotalVertices() > 0 && m.skeleton === skeleton);
    const mesh = (meshes[0] ?? root.getChildMeshes().find(m => m.getTotalVertices() > 0)) as Mesh | undefined;
    if (!mesh) {instance.dispose(); throw Error('Cadáver sem malha skinada');}
    for (const m of root.getChildMeshes()) {m.isPickable = false; m.alwaysSelectAsActiveMesh = true;}
    this.instance = instance;
    this.corpse = root as TransformNode;
    this.corpseSkeleton = skeleton;
    this.corpseMesh = mesh;
    this.bind = readBonePoses(skeleton);
    root.setEnabled(false);
  }

  /**
   * Captura a pose de mundo do rig vivo, cria os corpos articulados e solta o corpo.
   *
   * Devolve `false` quando falta física, clone ou esqueleto: aí o jogo segue com o que já faz hoje,
   * em vez de morrer numa exceção no quadro da morte.
   */
  start(input: PlayerRagdollStart): boolean {
    if (this.active || !this.ready || !this.scene.getPhysicsEngine()) return false;
    const skeleton = this.corpseSkeleton!, mesh = this.corpseMesh!, corpse = this.corpse!;
    try {
      // --- pose: LÊ o rig vivo, ESCREVE no clone -------------------------------------------------
      input.pose.skeleton.computeAbsoluteMatrices(true);
      input.pose.root.computeWorldMatrix(true);
      applyBonePoses(skeleton, readBonePoses(input.pose.skeleton));
      corpse.setEnabled(true);
      corpse.parent = null;
      const world = input.pose.root.getWorldMatrix();
      // Match the skinned mesh's complete world transform, including its imported rig scale.
      const meshLocal = mesh.computeWorldMatrix(true).multiply(Matrix.Invert(corpse.getWorldMatrix()));
      const desiredRoot = Matrix.Invert(meshLocal).multiply(world);
      desiredRoot.decompose(corpse.scaling, corpse.rotationQuaternion ??= new Quaternion(), corpse.position);
      corpse.computeWorldMatrix(true);
      mesh.computeWorldMatrix(true);
      skeleton.computeAbsoluteMatrices(true);

      // --- abre a pose ANTES de medir: é ela que vira o "zero" das juntas ------------------------
      const frame = this.openPose(skeleton, mesh);

      // --- corpos medidos no asset --------------------------------------------------------------
      const config = this.measure(skeleton, mesh);
      if (!config.length) return false;
      const layout = config.map(c => SEGMENTS.find(s => s.bone === c.bone)!);
      const bones = config.map(c => skeleton.bones.find(b => b.name === c.bone)!);
      const initial = bones.map(b => b.getAbsoluteMatrix().multiply(mesh.getWorldMatrix()).clone());
      const rig = new Ragdoll(skeleton, mesh, config);
      rig.ragdoll();
      rig.pauseSync = true;
      this.rig = rig;
      this.count = config.length;
      this.limitedJoints = this.limitJoints(rig, layout);

      // --- equipamento: preso ao OSSO do clone, então acompanha o membro na queda ---------------
      for (const item of input.equipment ?? []) {
        const bone = skeleton.bones.find(b => b.name === item.bone);
        if (!bone) continue;
        this.borrowed.push({node: item.node, parent: item.node.parent as TransformNode | null, position:item.node.position.clone(), rotation:item.node.rotation.clone(), quaternion:item.node.rotationQuaternion?.clone() ?? null, scaling:item.node.scaling.clone()});
        item.node.attachToBone(bone, mesh);
      }

      // --- arremesso: velocidade da morte + golpe fatal + abertura dos membros -------------------
      const launch = this.launchVelocity(input);
      const spread = Math.max(0, this.tuning.limbSpread);
      for (let i = 0; i < this.count; i++) {
        const segment = layout[i]!, body = rig.getAggregate(i).body;
        const velocity = launch.clone();
        const side = boneSide(segment.bone);
        if (frame && side !== 0 && segment.spread > 0) {
          // Empurrão GENTIL para fora, no eixo lateral MEDIDO do corpo: é o que desfaz o aperto da
          // pose de arma durante a queda, em vez de deixar os braços colados no tronco até o chão.
          const lateral = spread * segment.spread * side;
          velocity.addInPlace(frame.side.scale(lateral));
          velocity.addInPlace(frame.cross.scale(lateral * .38 * (1 + wobble(i, 4))));
          velocity.addInPlace(frame.up.scale(spread * segment.spread * .18));
        }
        body.setLinearVelocity(velocity);
        // Giro próprio por corpo: dezesseis corpos com o mesmo giro caem como um bloco só.
        body.setAngularVelocity(new Vector3(
          .8 + wobble(i, 1) * 1.1, .35 + wobble(i, 2) * .9, 1.1 + wobble(i, 3) * 1.1));
        body.setLinearDamping(.25);
        body.setAngularDamping(Math.max(.05, this.tuning.angularDamping * segment.damping));
      }
      // Reafirma a escala dos ossos DEPOIS de cada sincronização do Babylon: é a trava contra a
      // acumulação de escala sob a raiz refletida do glTF.
      const physicalStarts = bones.map((_, i) => {
        const node = rig.getAggregate(i).transformNode;
        return {rotation: (node.rotationQuaternion ?? Quaternion.Identity()).clone(),
          offset: node.position.subtract(initial[i]!.getTranslation())};
      });
      this.observer = this.scene.onBeforeRenderObservable.add(() => {
        for(let i=0;i<bones.length;i++) {
          const bone=bones[i]!, node=rig.getAggregate(i).transformNode;
          const delta=physicalStarts[i]!.rotation.conjugate().multiply(node.rotationQuaternion ?? Quaternion.Identity());
          const rotation=Matrix.Identity(); Matrix.FromQuaternionToRef(delta,rotation);
          const desired=initial[i]!.multiply(rotation);
          const offset=Vector3.TransformNormal(physicalStarts[i]!.offset,rotation);
          desired.setTranslation(node.position.subtract(offset));
          const parent=bone.getParent();
          const parentWorld=parent?parent.getAbsoluteMatrix().multiply(mesh.getWorldMatrix()):mesh.getWorldMatrix();
          const local=desired.multiply(Matrix.Invert(parentWorld));
          const q=new Quaternion(); local.decompose(undefined,q);
          bone.rotationQuaternion=q.normalize();
          if(!parent)bone.position=local.getTranslation();
          skeleton.computeAbsoluteMatrices(true);
        }
        this.holdScale();
        skeleton.prepare(true);
        this.readCentre();
      });
      this.releaseTerrain = this.options.terrain?.(this.readCentre());
      this.quiet = 0;
      this.readCentre();
      return true;
    } catch (error) {
      this.error = 'Ragdoll do jogador: ' + String(error);
      this.teardown();
      return false;
    }
  }

  /**
   * Gravidade LOCAL por corpo e acompanhamento do assentamento.
   *
   * Chame do laço de RENDER, não do passo fixo: o passo fixo para quando `started` vira falso na
   * morte, e o cadáver tem de continuar caindo.
   *
   * A gravidade da CENA não é reescrita. Cada corpo recebe por quadro a CORREÇÃO entre a gravidade
   * da cena e a radial do ponto onde ELE está — `Δv = (g_local − g_cena)·dt`, com
   * `|g_local| = |g_cena|`. Somada à integração que o Havok já faz, a resultante é exatamente a
   * gravidade local daquele corpo, individualmente. É a mesma matemática já validada para as pragas.
   */
  update(dt: number): void {
    this.bodiesUnderLocalGravity = 0;
    const rig = this.rig;
    if (!rig || !(dt > 0)) return;
    const engine = this.scene.getPhysicsEngine();
    if (!engine) return;
    const down = this.options.down;
    const gravity = engine.gravity, strength = gravity.length();
    let fastest = 0;
    for (let i = 0; i < this.count; i++) {
      const aggregate = rig.getAggregate(i), node = aggregate.transformNode;
      aggregate.body.getLinearVelocityToRef(scratchVelocity);
      fastest = Math.max(fastest, scratchVelocity.length());
      if (down && strength > 0) {
        scratchPoint.x = node.position.x; scratchPoint.y = node.position.y; scratchPoint.z = node.position.z;
        const d = down(scratchPoint), length = Math.hypot(d.x, d.y, d.z);
        if (Number.isFinite(length) && length > 1e-6) {
          const scale = strength / length;
          const dx = (d.x * scale - gravity.x) * dt, dy = (d.y * scale - gravity.y) * dt, dz = (d.z * scale - gravity.z) * dt;
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) >= 1e-9) {
            aggregate.body.getLinearVelocityToRef(scratchVelocity);
            aggregate.body.setLinearVelocity(scratchVelocity.addInPlaceFromFloats(dx, dy, dz));
          }
          this.bodiesUnderLocalGravity++;
        }
      }
    }
    this.quiet = fastest <= this.tuning.settleSpeed ? this.quiet + dt : 0;
    this.readCentre();
  }

  /** Volta ao estado pré-morte sem realocar o clone: pronto para a tentativa seguinte. */
  reset(): void {
    this.teardown();
    const skeleton = this.corpseSkeleton;
    if (skeleton && this.bind.length) applyBonePoses(skeleton, this.bind);
    this.corpse?.setEnabled(false);
    this.centre.setAll(0); this.hips.setAll(0);
  }

  dispose(): void {
    this.teardown();
    this.instance?.dispose();
    this.instance = undefined;
    this.corpse = undefined; this.corpseSkeleton = undefined; this.corpseMesh = undefined;
    this.bind = [];
    if (this.ownsContainer) this.container?.dispose();
    this.container = undefined; this.ownsContainer = false;
    this.preparing = undefined;
  }

  // ------------------------------------------------------------------------------------------------
  private teardown(): void {
    if (this.observer) {this.scene.onBeforeRenderObservable.remove(this.observer); this.observer = undefined;}
    this.releaseTerrain?.(); this.releaseTerrain = undefined;
    for (const item of this.borrowed) {
      item.node.detachFromBone(); item.node.parent = item.parent;
      item.node.position.copyFrom(item.position); item.node.rotation.copyFrom(item.rotation);
      item.node.rotationQuaternion = item.quaternion; item.node.scaling.copyFrom(item.scaling);
    }
    this.borrowed = [];
    this.rig?.dispose();
    this.rig = undefined;
    this.count = 0; this.quiet = 0; this.bodiesUnderLocalGravity = 0;
    this.limitedJoints = 0; this.openedLimbs = 0;
  }

  /**
   * Abre os membros ANTES de criar os corpos — a correção do cadáver "encolhido segurando o rifle".
   *
   * A pose copiada é a do instante da morte, e no jogo isso quase sempre é a pose de duas mãos na
   * arma: cotovelos colados no tronco, mãos juntas na frente do peito. Deixá-la intacta tem dois
   * efeitos ruins, e o segundo é o pior: as caixas nascem apertadas E, como o limite de junta é
   * medido A PARTIR da pose de criação (ver `limitJoints`), essa pose apertada vira o repouso do
   * corpo inteiro — o cadáver fica agarrado a uma arma que não existe mais.
   *
   * Aqui cada membro gira uma FRAÇÃO do caminho (`openBlend`) até uma direção aberta construída
   * sobre os eixos MEDIDOS do próprio rig, com teto em `openDegrees`. Não é uma pose em T: o resto da
   * pose da morte — tronco, pernas, cabeça, o giro do corpo — fica exatamente como estava, e os dois
   * lados recebem valores DIFERENTES, que é o que tira a simetria de boneco.
   *
   * Escreve só no CLONE. Devolve os eixos medidos, reaproveitados no empurrão de abertura.
   */
  private openPose(skeleton: Skeleton, mesh: Mesh): BodyFrame | undefined {
    this.openedLimbs = 0;
    const frame = bodyFrame(skeleton, mesh);
    if (!frame) return undefined;
    const {up, side, cross} = frame;
    const blend = Math.max(0, Math.min(1, this.tuning.openBlend));
    const cap = Math.max(0, this.tuning.openDegrees);
    const towards = (lateral: number, vertical: number, depth: number): Vector3 =>
      side.scale(lateral).add(up.scale(vertical)).add(cross.scale(depth));
    for (const opening of [
      // Ombros: para fora e para baixo, o braço esquerdo um pouco mais aberto que o direito.
      {bone: 'LeftArm', tip: 'LeftForeArm', towards: towards(.84, -.5, .22), blend, maxDegrees: cap},
      {bone: 'RightArm', tip: 'RightForeArm', towards: towards(-.78, -.58, -.3), blend: blend * .84, maxDegrees: cap},
      // Cotovelos: soltam o aperto sem esticar — continuam dobrados, só não colados no peito.
      {bone: 'LeftForeArm', tip: 'LeftHand', towards: towards(.48, -.86, .14), blend: blend * .9, maxDegrees: cap},
      {bone: 'RightForeArm', tip: 'RightHand', towards: towards(-.4, -.9, -.18), blend: blend * .78, maxDegrees: cap},
      // Pernas: quase nada, só para a base não sair travada numa passada.
      {bone: 'LeftUpLeg', tip: 'LeftLeg', towards: towards(.24, -.97, .1), blend: blend * .45, maxDegrees: cap * .35},
      {bone: 'RightUpLeg', tip: 'RightLeg', towards: towards(-.2, -.98, -.08), blend: blend * .38, maxDegrees: cap * .35},
    ]) if (openLimb(skeleton, mesh, opening) > 0) this.openedLimbs++;
    skeleton.prepare(true);
    skeleton.computeAbsoluteMatrices(true);
    mesh.computeWorldMatrix(true);
    return frame;
  }

  /**
   * Dá limite angular às juntas — o que o `Ragdoll` do Babylon NÃO faz.
   *
   * Medido na fonte da versão instalada: `Ragdoll._initJoints` monta a restrição só com
   * `pivotA`/`pivotB`/`axisA`/`axisB`/`collision:false`; o `min`/`max` de cada osso é guardado em
   * `_boxConfigs` e nunca chega ao motor. E o plugin do Havok, para `BALL_AND_SOCKET`, trava apenas
   * os três eixos LINEARES e deixa os três ANGULARES livres. Resultado: toda junta dobra 180°, e
   * como a mesma restrição desliga a colisão entre pai e filho, nada segura a corrente — o corpo
   * desaba sobre si mesmo e vira uma bola. Foi isso que a sonda mediu: quadril→pé caiu de 0,64 m
   * para 0,29 m, e a malha de 1,70 m virou um bloco de 1,0 m.
   *
   * A correção é fechar os três eixos angulares de cada junta em `±jointDegrees × limit`. O zero
   * dessa medida é a configuração do instante da criação — ou seja, a pose (já aberta) da morte —,
   * porque os dois corpos nascem com rotação identidade e as âncoras são gravadas nesse instante.
   * O corpo continua solto: o teto é por junta, e nenhum eixo vira trava.
   *
   * **O limite é POR EIXO, não um cone.** Medido no rig real, depois de 300 quadros: uma junta
   * configurada em 31° por eixo chegou a 67° de desvio TOTAL, e uma de 71° chegou a 97°. É o
   * esperado — três limites independentes compõem uma rotação maior que cada um deles. Então
   * `jointDegrees × limit` é o teto de cada eixo, e não uma promessa sobre o ângulo resultante; os
   * valores de `limit` da tabela foram escolhidos MEDINDO esse desvio composto, não no papel.
   *
   * Nada aqui inventa API: são os mesmos `setAxisMode`/`setAxisMinLimit`/`setAxisMaxLimit` do plugin
   * v2, os mesmos que o próprio `initConstraint` usa para montar um `SIX_DOF`. Devolve quantas
   * juntas foram limitadas — `0` quando o motor não é o v2, e aí o comportamento é o de antes.
   */
  private limitJoints(rig: Ragdoll, layout: readonly Segment[]): number {
    const engine = this.scene.getPhysicsEngine();
    if (!engine || engine.getPluginVersion() !== 2) return 0;
    const plugin = engine.getPhysicsPlugin() as IPhysicsEnginePluginV2 | null;
    if (!plugin?.setAxisMode || !plugin.setAxisMinLimit || !plugin.setAxisMaxLimit) return 0;
    const axes = [PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintAxis.ANGULAR_Y, PhysicsConstraintAxis.ANGULAR_Z];
    let limited = 0;
    for (const constraint of rig.getConstraints()) {
      // O segmento de cada junta sai do corpo FILHO, não da ordem do array: é o mesmo mapeamento
      // que o motor usa, então um dia em que o Babylon mudar a ordem isto continua certo.
      const child = constraint.getBodiesUsingConstraint()[0]?.childBody;
      let segment: Segment | undefined;
      for (let i = 0; i < this.count && !segment; i++) if (rig.getAggregate(i).body === child) segment = layout[i];
      const degrees = this.tuning.jointDegrees * (segment?.limit ?? 1);
      const limit = Math.max(.02, Math.min(Math.PI * .75, Math.abs(degrees) * Math.PI / 180));
      for (const axis of axes) {
        plugin.setAxisMode(constraint, axis, PhysicsConstraintAxisLimitMode.LIMITED);
        plugin.setAxisMinLimit(constraint, axis, -limit);
        plugin.setAxisMaxLimit(constraint, axis, limit);
      }
      limited++;
    }
    return limited;
  }

  /**
   * Configuração medida no asset: comprimento de cada segmento pela distância ao osso filho.
   *
   * A caixa é alongada ao longo do membro apenas quando o membro é aproximadamente VERTICAL na pose
   * de bind (tronco, coxa, canela, cabeça). O `Ragdoll` do Babylon cria a caixa alinhada ao mundo no
   * instante da criação, então alongar um braço — que aponta para o lado — deixaria a caixa
   * atravessada. Para esses, a caixa é quase isotrópica, do tamanho do próprio segmento. O eixo de
   * bind é MEDIDO (`bone.getDirection`), não presumido.
   */
  private measure(skeleton: Skeleton, mesh: Mesh): (RagdollBoneProperties & {bone: string})[] {
    const height = skeletonHeight(skeleton, mesh) || 1.7;
    const config: (RagdollBoneProperties & {bone: string})[] = [];
    for (const segment of SEGMENTS) {
      if (config.length >= this.maxBodies) break;
      const bone = skeleton.bones.find(b => b.name === segment.bone);
      if (!bone) continue;
      const measured = segment.child ? segmentLength(skeleton, segment.bone, segment.child, mesh) : undefined;
      const length = measured ?? (segment.fraction !== undefined ? segment.fraction * height : undefined);
      if (!length || !Number.isFinite(length)) continue;
      const thickness = Math.max(.05, length * this.tuning.limbThickness * segment.girth);
      const direction = bone.getDirection(Axis.Y, mesh);
      const upright = Math.abs(direction.y) > .7;
      const box = upright
        ? {width: thickness, depth: thickness, height: Math.max(thickness, length)}
        : {width: Math.max(thickness, length * .8), depth: thickness, height: thickness};
      config.push({
        bone: segment.bone, ...box,
        // `boxOffset` MEDIDO: metade do segmento ao longo do eixo do osso. Nunca `bone.length`,
        // que este rig não define — `putBoxInBoneCenter` daria NaN.
        boxOffset: length / 2, boneOffsetAxis: Axis.Y,
        joint: segment.joint, min: -this.tuning.jointDegrees, max: this.tuning.jointDegrees,
        mass: Math.max(.4, this.tuning.mass * segment.mass),
        // `friction` NÃO é passado: o `Ragdoll` do Babylon fixa 0,6 no agregado e ignoraria o campo.
        // Deixá-lo aqui seria prometer um ajuste que não existe. `tuning.friction` fica reservado.
        restitution: this.tuning.restitution,
      } as RagdollBoneProperties & {bone:string});
    }
    return config;
  }

  /** Velocidade inicial: a do corpo na morte mais o empurrão do golpe fatal, com teto. */
  private launchVelocity(input: PlayerRagdollStart): Vector3 {
    const velocity = new Vector3(input.velocity?.x ?? 0, input.velocity?.y ?? 0, input.velocity?.z ?? 0);
    const lethal = input.lethal;
    if (lethal) {
      const d = lethal.direction, length = Math.hypot(d.x, d.y, d.z);
      if (length > 1e-6 && Number.isFinite(lethal.magnitude)) {
        const push = Math.max(0, Math.min(this.tuning.maxLaunch, lethal.magnitude));
        velocity.addInPlaceFromFloats(d.x / length * push, d.y / length * push, d.z / length * push);
      }
    }
    const speed = velocity.length();
    if (speed > this.tuning.maxLaunch) velocity.scaleInPlace(this.tuning.maxLaunch / speed);
    return velocity;
  }

  /** Centro de massa e quadril, em MUNDO. Sem alocar. */
  private readCentre(): Vec3 {
    const rig = this.rig;
    if (!rig || !this.count) return scratchPoint;
    this.centre.setAll(0);
    for (let i = 0; i < this.count; i++) this.centre.addInPlace(rig.getAggregate(i).transformNode.position);
    this.centre.scaleInPlace(1 / this.count);
    this.hips.copyFrom(rig.getAggregate(0).transformNode.position);
    scratchPoint.x = this.centre.x; scratchPoint.y = this.centre.y; scratchPoint.z = this.centre.z;
    return scratchPoint;
  }

  /**
   * Reafirma a escala de bind de cada osso depois da sincronização do Babylon.
   *
   * A raiz refletida do glTF (`det = −1`) faz o caminho de "rotação em espaço de mundo" do Babylon
   * devolver uma escala contaminada; sem esta trava o cadáver esticaria a cada quadro. Como todo
   * osso deste rig tem escala 1, reafirmar é barato e não desfaz nada que a física precise.
   */
  private holdScale(): void {
    const skeleton = this.corpseSkeleton;
    if (!this.rig || !skeleton) return;
    let touched = false;
    for (const pose of this.bind) {
      const bone = skeleton.bones.find(b => b.name === pose.name);
      if (!bone) continue;
      const scaling = bone.scaling;
      if (Math.abs(scaling.x - pose.scaling.x) + Math.abs(scaling.y - pose.scaling.y) + Math.abs(scaling.z - pose.scaling.z) < 1e-6) continue;
      bone.scaling = pose.scaling.clone();
      touched = true;
    }
    if (touched) skeleton.computeAbsoluteMatrices(true);
  }
}

/**
 * Rotação de mão DIREITA de uma matriz de mundo, ignorando escala e reflexão.
 *
 * A raiz do gunslinger tem `scaling = (1,1,−1)`: decompor direto devolveria escala negativa e uma
 * rotação espelhada, e aplicá-la num clone que JÁ carrega a mesma reflexão a aplicaria duas vezes.
 * Aqui as duas primeiras linhas são reortonormalizadas por Gram-Schmidt e a terceira é recomposta por
 * produto vetorial, o que devolve exatamente a rotação autoral sem a reflexão.
 */
export function rightHandedRotation(world: Matrix, into = new Quaternion()): Quaternion {
  const m = world.asArray();
  const x = new Vector3(m[0]!, m[1]!, m[2]!), y = new Vector3(m[4]!, m[5]!, m[6]!);
  if (x.lengthSquared() < 1e-12 || y.lengthSquared() < 1e-12) return into.copyFrom(Quaternion.Identity());
  x.normalize();
  y.subtractInPlace(x.scale(Vector3.Dot(x, y)));
  if (y.lengthSquared() < 1e-12) return into.copyFrom(Quaternion.Identity());
  y.normalize();
  const basis = Matrix.Identity();
  Matrix.FromXYZAxesToRef(x, y, Vector3.Cross(x, y), basis);
  Quaternion.FromRotationMatrixToRef(basis, into);
  return into.normalize();
}

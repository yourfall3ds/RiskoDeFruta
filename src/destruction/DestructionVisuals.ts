import {CreatePlane} from '@babylonjs/core/Meshes/Builders/planeBuilder';
import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Quaternion, Vector3} from '@babylonjs/core/Maths/math.vector';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Node} from '@babylonjs/core/node';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../core/contracts';
import type {DestructibleState} from './DestructionModel';
import type {DestructionPresentationPort} from './DestructionPorts';
import {DestructionDebris, type DebrisOptions} from './DestructionDebris';
import {FRAGMENT_SOURCE_LIMIT, shatterGeometry, type GeometrySource} from './FragmentGeometry';

/**
 * A camada que se vê: marcas que acumulam, tranco do tiro, tombamento e estilhaço.
 *
 * Quatro compromissos assumidos aqui, todos por exigência do pedido ou por defeito já observado:
 *
 * 1. **Material original intocado.** Nada troca `mesh.material`. A rachadura é um decalque por cima
 *    — mesma técnica que `ShotEffects.mark` já usa para furo de bala —, então a textura autoral do
 *    prop continua exatamente como o artista entregou, inclusive nos cacos.
 * 2. **Nenhuma primitiva vira prop visível.** Os únicos `CreatePlane` deste arquivo são decalques de
 *    VFX; corpo e caco saem sempre da malha autoral.
 * 3. **O prop inteiro, não uma primitiva dele.** Um nó de glTF com dois materiais (casca + folha de
 *    uma árvore) chega ao Babylon como `Nome_primitive0` e `Nome_primitive1`. Mexer só na primeira
 *    faria a casca tombar e as folhas ficarem paradas no ar. Aqui o alvo é sempre o NÓ, e o
 *    estilhaço percorre todas as primitivas com o material de cada uma.
 * 4. **Árvore tomba pela raiz.** Não some no ar: gira em torno do pé por `toppleSeconds` e só então
 *    desaparece.
 *
 * Sobre matriz congelada: `PlanetWorldView` chama `freezeWorldMatrix()` em cada malha da casca, o
 * que é certo para cenário estático e fatal para cenário que se mexe. O grupo é descongelado quando
 * o prop entra em jogo (primeiro dano) e volta a congelar na restauração — o mundo parado continua
 * pagando zero.
 */

export interface VisualOptions extends DebrisOptions {
  /** Nó raiz onde procurar as malhas por nome. Ausente ⇒ a cena inteira. */
  readonly root?: Node;
  /** Decalques de rachadura vivos ao mesmo tempo. */
  readonly markBudget?: number;
}

/** O prop como ele existe na cena: um nó e todas as malhas dele. */
interface Group {
  /** Nó a mover, esconder ou tombar — mexer nele mexe em todas as primitivas de uma vez. */
  readonly body: TransformNode;
  /** Toda malha com geometria sob o nó, cada uma com o material dela. */
  readonly parts: AbstractMesh[];
  /** Quem estava com a matriz congelada antes de o prop entrar em jogo. */
  readonly frozen: TransformNode[];
}

interface Attachment {
  readonly group: Group | undefined;
  readonly components: (Group | undefined)[];
  /** Pivô criado só quando o corpo tomba; descartado na restauração. */
  pivot: TransformNode | undefined;
  parent: Node | null;
  readonly rest: Vector3;
  restRotation: Quaternion;
  /** Deslocamento do tranco, ou eixo do tombamento quando o corpo está caindo. */
  readonly impulse: Vector3;
  joltTime: number;
  /** Segundos de tombamento já corridos; −1 = não está tombando. */
  topple: number;
  readonly toppleSeconds: number;
  readonly linger: number;
  fade: number;
}

interface Mark {mesh: Mesh; owner: string}

const MARK_BUDGET = 96;
const JOLT_SECONDS = 0.16;

export class DestructionVisuals implements DestructionPresentationPort {
  readonly debris: DestructionDebris;
  /** Malhas pedidas pelo manifesto que não existem na cena. Diagnóstico para o autor do mapa. */
  readonly missing: string[] = [];

  private readonly attachments = new Map<string, Attachment>();
  private readonly marks: Mark[] = [];
  private readonly root: Node | undefined;
  private nextMark = 0;
  private disposed = false;

  constructor(private readonly scene: Scene, options: VisualOptions = {}) {
    this.debris = new DestructionDebris(scene, options);
    this.root = options.root;
    this.buildMarks(Math.max(8, options.markBudget ?? MARK_BUDGET));
  }

  get markCount(): number {return this.marks.filter(mark => mark.owner !== '').length;}

  /**
   * Textura de rachadura desenhada uma vez: fissuras radiais com bifurcação, fundo transparente.
   *
   * É desenhada e não carregada porque não existe arte de rachadura no acervo, e criar um arquivo de
   * textura novo seria arte — que é do root, não deste subsistema. `DynamicTexture` é VFX, e o
   * projeto já gera assim o furo de bala em `ShotEffects`.
   */
  private buildMarks(budget: number): void {
    // Sem canvas (teste, servidor) não há o que desenhar; o resto do sistema segue funcionando.
    if (!this.scene.getEngine().getRenderingCanvas()) return;
    const size = 128, half = size / 2;
    const texture = new DynamicTexture('destruction-cracks', size, this.scene, false);
    texture.hasAlpha = true;
    const ctx = texture.getContext();
    ctx.clearRect(0, 0, size, size);
    const core = ctx.createRadialGradient(half, half, 1, half, half, 26);
    core.addColorStop(0, '#120e0acc');
    core.addColorStop(0.55, '#241b1288');
    core.addColorStop(1, '#241b1200');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#0d0a07dd';
    for (let i = 0; i < 11; i++) {
      const start = i * 2.39996 + 0.4;
      let x = half + Math.cos(start) * 5, y = half + Math.sin(start) * 5, heading = start;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let step = 0; step < 5; step++) {
        heading += (fract(i * 7.13 + step * 3.77) - 0.5) * 0.9;
        x += Math.cos(heading) * (7 + step * 2.4);
        y += Math.sin(heading) * (7 + step * 2.4);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (i % 3 === 0) {
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(heading + 1.1) * 13, y + Math.sin(heading + 1.1) * 13);
        ctx.stroke();
      }
    }
    texture.update();
    const material = new StandardMaterial('destruction-crack-mark', this.scene);
    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    material.specularColor = Color3.Black();
    material.backFaceCulling = false;
    material.zOffset = -3;
    for (let i = 0; i < budget; i++) {
      const mesh = CreatePlane('destruction-crack', {size: 0.4}, this.scene);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.marks.push({mesh, owner: ''});
    }
  }

  /**
   * O subsistema consegue mesmo representar a quebra deste prop?
   *
   * `false` quando a malha do manifesto não existe na cena. O `DestructionSystem` usa isso para NÃO
   * tirar a colisão de um corpo que ficaria visível para sempre — um prop intacto na tela e vazado
   * ao tiro e ao corpo é pior defeito que um prop que simplesmente não quebra.
   */
  ready(state: DestructibleState): boolean {
    return this.attach(state).group !== undefined;
  }

  /** Liga o registro do manifesto às malhas reais da cena. Idempotente. */
  private attach(state: DestructibleState): Attachment {
    const known = this.attachments.get(state.id);
    if (known) return known;
    const group = this.findGroup(state.record.nodeName);
    if (state.record.nodeName && !group) this.missing.push(state.record.nodeName);
    const attachment: Attachment = {
      group,
      components: state.record.components.map(part => this.findGroup(part.nodeName)),
      pivot: undefined,
      parent: group?.body.parent ?? null,
      rest: group ? group.body.position.clone() : Vector3.Zero(),
      restRotation: group?.body.rotationQuaternion?.clone() ?? Quaternion.Identity(),
      impulse: Vector3.Zero(),
      joltTime: 0,
      topple: -1,
      toppleSeconds: state.profile.toppleSeconds,
      linger: state.profile.linger,
      fade: 0,
    };
    this.attachments.set(state.id, attachment);
    return attachment;
  }

  /**
   * Acha o NÓ do prop e todas as malhas dele.
   *
   * Aceita três formas, porque as três aparecem em glTF real: nó de transformação com malhas
   * filhas, malha única, e malha dividida em `Nome_primitiveN` por causa de múltiplos materiais.
   */
  private findGroup(name: string): Group | undefined {
    if (!name) return undefined;
    const body = this.pickNode(name);
    if (!body) return undefined;
    const parts: AbstractMesh[] = [];
    const candidate = body as AbstractMesh;
    if (typeof candidate.getTotalVertices === 'function' && candidate.getTotalVertices() > 0) parts.push(candidate);
    for (const child of body.getChildMeshes(false)) {
      if (child.getTotalVertices() > 0 && !parts.includes(child)) parts.push(child);
    }
    if (parts.length === 0) return undefined;
    // Descongelar agora: o prop passou a ser cenário que se mexe. O resto da casca segue congelado.
    const frozen: TransformNode[] = [];
    for (const node of [body, ...parts]) {
      if (!node.isWorldMatrixFrozen) continue;
      frozen.push(node);
      node.unfreezeWorldMatrix();
    }
    return {body, parts, frozen};
  }

  private pickNode(name: string): TransformNode | undefined {
    const scope: TransformNode[] = this.root
      ? this.root.getDescendants(false).filter((node): node is TransformNode => node instanceof TransformNode)
      : [...this.scene.meshes, ...this.scene.transformNodes];
    const exact = scope.find(node => node.name === name);
    if (exact) return exact;
    // `Nome_primitive0` e irmãs: o pai de todas é o nó do prop. Quando o importador não cria pai,
    // a primeira primitiva vira o corpo e as irmãs entram como partes pelo prefixo.
    const pieces = scope.filter(node => node.name.startsWith(`${name}_primitive`));
    if (pieces.length === 0) return undefined;
    const parent = pieces[0]!.parent;
    if (parent instanceof TransformNode && parent.name === name) return parent;
    const holder = new TransformNode(`${name}__destructible`, this.scene);
    holder.parent = parent;
    holder.position.setAll(0);
    holder.rotationQuaternion = Quaternion.Identity();
    for (const piece of pieces) {
      if (piece.isWorldMatrixFrozen) piece.unfreezeWorldMatrix();
      piece.setParent(holder);
    }
    return holder;
  }

  mark(state: DestructibleState, point: Vec3, normal: Vec3, stage: number): void {
    if (this.disposed || this.marks.length === 0 || stage <= 0) return;
    const item = this.marks[this.nextMark++ % this.marks.length]!;
    const direction = new Vector3(normal.x, normal.y, normal.z);
    if (direction.lengthSquared() < 1e-6) direction.set(0, 1, 0); else direction.normalize();
    item.mesh.position.set(point.x, point.y, point.z).addInPlace(direction.scale(0.01));
    item.mesh.rotationQuaternion = Quaternion.FromUnitVectorsToRef(
      new Vector3(0, 0, -1), direction, Quaternion.Identity(),
    );
    // A rachadura cresce e escurece com o estágio: o jogador lê o progresso sem número na tela.
    item.mesh.scaling.setAll(0.34 + stage * 0.26);
    item.mesh.visibility = Math.min(1, 0.55 + stage * 0.2);
    item.mesh.setEnabled(true);
    // Marca de cenário não expira por tempo como o furo de bala: ela É o estado do corpo, e some
    // junto com ele. Por isso o pool é maior e a reciclagem é circular.
    item.owner = state.id;
  }

  jolt(state: DestructibleState, direction: Vec3, power: number): void {
    const attachment = this.attach(state);
    if (!attachment.group || attachment.topple >= 0) return;
    const push = new Vector3(direction.x, direction.y, direction.z);
    if (push.lengthSquared() < 1e-6) return;
    attachment.impulse.copyFrom(push.normalize().scale(Math.min(0.09, 0.05 * power)));
    attachment.joltTime = JOLT_SECONDS;
  }

  fell(state: DestructibleState, component: number, point: Vec3, direction: Vec3): void {
    const attachment = this.attach(state);
    const group = attachment.components[component];
    if (!group || !group.body.isEnabled()) return;
    this.throwPieces(group, state, direction, 0.7);
    group.body.setEnabled(false);
    void point;
  }

  destroy(state: DestructibleState, point: Vec3, direction: Vec3): void {
    const attachment = this.attach(state);
    this.clearMarks(state.id);
    void point;
    if (state.profile.style === 'topple') {
      // Árvore: sem estilhaço. Tomba pela raiz e só depois some.
      this.prepareTopple(attachment, state, direction);
      return;
    }
    if (state.profile.style === 'components') {
      // Desabamento: o que ainda estava de pé cai junto, componente por componente.
      for (const group of attachment.components) {
        if (!group || !group.body.isEnabled()) continue;
        this.throwPieces(group, state, direction, 0.6);
        group.body.setEnabled(false);
      }
    }
    if (attachment.group) {
      this.throwPieces(attachment.group, state, direction, 1);
      attachment.group.body.setEnabled(false);
    }
  }

  /**
   * Prende o nó do prop a um pivô no PÉ dele, preservando a pose de mundo.
   *
   * `setParent` mantém a transformação; girar o pivô gira a árvore inteira — tronco, galho e folha —
   * em torno da raiz. Sem o pivô a rotação sairia do centro do modelo e o tronco atravessaria o
   * próprio chão na metade da queda.
   */
  private prepareTopple(attachment: Attachment, state: DestructibleState, direction: Vec3): void {
    const group = attachment.group;
    if (!group) return;
    const {centre, extents, up} = state.record;
    // Alcance da caixa envolvente ao longo da vertical local — a "meia altura" real do prop mesmo
    // quando o `up` não é +Y, que é a regra e não a exceção num planeta.
    const reach = Math.abs(up.x) * extents.x + Math.abs(up.y) * extents.y + Math.abs(up.z) * extents.z;
    const pivot = new TransformNode(`destruction-pivot-${state.id}`, this.scene);
    pivot.position.set(centre.x - up.x * reach, centre.y - up.y * reach, centre.z - up.z * reach);
    pivot.rotationQuaternion = Quaternion.Identity();
    attachment.parent = group.body.parent;
    attachment.rest.copyFrom(group.body.position);
    attachment.restRotation = group.body.rotationQuaternion?.clone() ?? Quaternion.Identity();
    group.body.setParent(pivot);
    attachment.pivot = pivot;
    attachment.topple = 0;
    attachment.fade = 0;
    attachment.joltTime = 0;

    // Eixo do tombo: perpendicular à vertical local e à direção do golpe, para a árvore cair para
    // longe de quem atirou — que é o que a intuição espera ver.
    const localUp = new Vector3(up.x, up.y, up.z).normalize();
    const push = new Vector3(direction.x, direction.y, direction.z);
    push.subtractInPlace(localUp.scale(Vector3.Dot(push, localUp)));
    if (push.lengthSquared() < 1e-6) push.copyFrom(anyPerpendicular(localUp)); else push.normalize();
    attachment.impulse.copyFrom(Vector3.Cross(localUp, push).normalize());
  }

  /**
   * Estilhaça o prop usando a geometria dele mesmo, primitiva por primitiva.
   *
   * Cada primitiva estilhaça com o MATERIAL dela: um tronco de duas primitivas devolve cacos de
   * casca com a textura de casca e cacos de folha com a textura de folha. Os pedaços são repartidos
   * proporcionalmente ao tamanho de cada primitiva, com um mínimo de dois, para a parte pequena não
   * sumir sem deixar caco.
   */
  private throwPieces(group: Group, state: DestructibleState, direction: Vec3, scale: number): void {
    const sources = group.parts
      .map(mesh => ({mesh, source: worldGeometry(mesh)}))
      .filter((entry): entry is {mesh: AbstractMesh; source: GeometrySource} => entry.source !== undefined);
    if (sources.length === 0) return;   // malha grande demais: some sem caco gigante
    const total = sources.reduce((sum, entry) => sum + entry.source.indices.length / 3, 0);
    const budget = Math.max(2, Math.round(state.profile.fragments * scale));
    const seed = hash(state.id);
    for (const [index, entry] of sources.entries()) {
      const share = total > 0 ? (entry.source.indices.length / 3) / total : 1 / sources.length;
      const pieces = Math.max(2, Math.round(budget * share));
      const slices = shatterGeometry(entry.source, pieces, seed + index);
      if (slices.length === 0) continue;
      this.debris.burst(
        slices, entry.mesh.material, direction,
        state.profile.fragmentSpeed * scale, state.profile.fragmentLife,
      );
    }
  }

  private clearMarks(owner: string): void {
    for (const mark of this.marks) {
      if (mark.owner !== owner) continue;
      mark.owner = '';
      mark.mesh.setEnabled(false);
    }
  }

  update(dt: number): void {
    if (this.disposed || !(dt > 0)) return;
    this.debris.update(dt);
    for (const attachment of this.attachments.values()) {
      const group = attachment.group;
      if (!group) continue;

      if (attachment.joltTime > 0 && attachment.topple < 0) {
        attachment.joltTime = Math.max(0, attachment.joltTime - dt);
        const t = attachment.joltTime / JOLT_SECONDS;
        // Tranco amortecido: entra num quadro, oscila e volta sozinho ao repouso exato.
        group.body.position.copyFrom(attachment.rest).addInPlace(attachment.impulse.scale(t * Math.sin(t * 9)));
      }

      if (attachment.topple < 0) continue;
      attachment.topple += dt;
      const fall = Math.min(1, attachment.topple / Math.max(0.05, attachment.toppleSeconds));
      // Queda acelerada: começa cedendo e termina batendo, como tronco partido.
      if (attachment.pivot) {
        attachment.pivot.rotationQuaternion = Quaternion.RotationAxis(attachment.impulse, fall ** 1.7 * (Math.PI / 2));
      }
      if (fall < 1) continue;
      attachment.fade += dt;
      const linger = Math.max(0.1, attachment.linger);
      const visibility = Math.max(0, 1 - attachment.fade / linger);
      for (const part of group.parts) part.visibility = visibility;
      if (attachment.fade >= linger) {group.body.setEnabled(false); attachment.topple = -1;}
    }
  }

  /** Volta corpos, marcas e cacos ao estado intacto. */
  restore(): void {
    this.debris.clear();
    for (const mark of this.marks) {mark.owner = ''; mark.mesh.setEnabled(false);}
    for (const attachment of this.attachments.values()) {
      const group = attachment.group;
      if (attachment.pivot && group) {
        group.body.setParent(attachment.parent);
        group.body.rotationQuaternion = attachment.restRotation.clone();
        attachment.pivot.dispose();
        attachment.pivot = undefined;
      }
      attachment.topple = -1;
      attachment.fade = 0;
      attachment.joltTime = 0;
      if (group) {
        group.body.position.copyFrom(attachment.rest);
        for (const part of group.parts) part.visibility = 1;
        group.body.setEnabled(true);
      }
      for (const component of attachment.components) component?.body.setEnabled(true);
    }
  }

  /**
   * Devolve ao mundo parado o que estava congelado antes de o prop entrar em jogo.
   * Chamar depois de `restore`, quando a cena volta a ser estática.
   */
  refreeze(): void {
    for (const attachment of this.attachments.values()) {
      for (const group of [attachment.group, ...attachment.components]) {
        if (!group || attachment.topple >= 0) continue;
        for (const node of group.frozen) node.freezeWorldMatrix();
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.debris.dispose();
    for (const mark of this.marks) mark.mesh.dispose();
    this.marks.length = 0;
    for (const attachment of this.attachments.values()) attachment.pivot?.dispose();
    this.attachments.clear();
  }
}

const fract = (n: number): number => n - Math.floor(n);

/** FNV-1a: mesma caixa quebra sempre nos mesmos pedaços, entre execuções e entre máquinas. */
const hash = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {h ^= text.charCodeAt(i); h = Math.imul(h, 16777619);}
  return (h >>> 0) % 4096 + 1;
};

function anyPerpendicular(up: Vector3): Vector3 {
  const axis = Math.abs(up.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  return Vector3.Cross(up, axis).normalize();
}

/**
 * Geometria da malha em espaço de MUNDO.
 *
 * Os cacos vivem soltos na cena, sem herdar o pai do prop; se as posições saíssem em espaço local, o
 * primeiro caco de uma caixa parentada apareceria no centro do planeta.
 */
function worldGeometry(mesh: AbstractMesh): GeometrySource | undefined {
  const positions = mesh.getVerticesData('position');
  const indices = mesh.getIndices();
  if (!positions || !indices || indices.length < 3) return undefined;
  if (indices.length / 3 > FRAGMENT_SOURCE_LIMIT) return undefined;
  const matrix = mesh.computeWorldMatrix(true);
  const world = new Float32Array(positions.length);
  const point = new Vector3();
  for (let i = 0; i + 2 < positions.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(positions[i]!, positions[i + 1]!, positions[i + 2]!, matrix, point);
    world[i] = point.x; world[i + 1] = point.y; world[i + 2] = point.z;
  }
  const rawNormals = mesh.getVerticesData('normal');
  let normals: Float32Array | undefined;
  if (rawNormals) {
    normals = new Float32Array(rawNormals.length);
    for (let i = 0; i + 2 < rawNormals.length; i += 3) {
      Vector3.TransformNormalFromFloatsToRef(rawNormals[i]!, rawNormals[i + 1]!, rawNormals[i + 2]!, matrix, point);
      point.normalize();
      normals[i] = point.x; normals[i + 1] = point.y; normals[i + 2] = point.z;
    }
  }
  const uvs = mesh.getVerticesData('uv');
  return {positions: world, indices, normals, uvs: uvs ? Float32Array.from(uvs) : undefined};
}

export type {Mesh};

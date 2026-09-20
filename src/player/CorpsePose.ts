import {Matrix, Quaternion, Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Bone} from '@babylonjs/core/Bones/bone';
import type {Skeleton} from '@babylonjs/core/Bones/skeleton';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';

/**
 * Cópia de pose entre dois rigs IGUAIS, e medição do corpo real do asset.
 *
 * Existe porque a queda tem de começar exatamente na pose em que o jogador morreu — correndo,
 * pulando, no meio de um combo — e porque os tamanhos dos membros do ragdoll precisam vir do asset
 * autoral, não de números chutados.
 *
 * Duas regras que este módulo respeita e que valem para o rig do gunslinger (medido:
 * `__root__` com `scaling = (1,1,−1)`, 24 ossos, **todos** com `linkedTransformNode`, `bone.length`
 * indefinido, escala de osso 1):
 *
 * 1. **O rig vivo é só LEITURA.** Nada aqui escreve no esqueleto de origem.
 * 2. **Quem recebe a pose é o nó ligado**, não o osso. Num rig com `linkedTransformNode`, a
 *    `Skeleton.prepare` reconstrói a matriz local do osso a partir do nó; escrever no osso seria
 *    sobrescrito no quadro seguinte.
 */

/** Pose local de um osso, no formato que o nó ligado aceita. */
export interface BonePose {
  readonly name: string;
  readonly position: Vector3;
  readonly rotation: Quaternion;
  readonly scaling: Vector3;
}

/** Onde escrever a pose de um osso: o nó ligado quando existe, senão o próprio osso. */
export function poseTarget(bone: Bone): {node: TransformNode} | {bone: Bone} {
  const node = bone.getTransformNode();
  return node ? {node} : {bone};
}

/**
 * Lê a pose LOCAL de cada osso de um esqueleto. Só leitura — é isto que se tira do rig vivo.
 *
 * A pose local (e não a de mundo) é o que se pode transplantar entre dois rigs do mesmo asset sem
 * arrastar a matriz de mundo do original, que no glTF vem refletida.
 */
export function readBonePoses(skeleton: Skeleton): BonePose[] {
  const poses: BonePose[] = [];
  for (const bone of skeleton.bones) {
    const node = bone.getTransformNode();
    if (node) {
      poses.push({
        name: bone.name,
        position: node.position.clone(),
        rotation: (node.rotationQuaternion ?? Quaternion.FromEulerAngles(node.rotation.x, node.rotation.y, node.rotation.z)).clone(),
        scaling: node.scaling.clone(),
      });
      continue;
    }
    const local = bone.getLocalMatrix();
    const scaling = new Vector3(), rotation = new Quaternion(), position = new Vector3();
    local.decompose(scaling, rotation, position);
    poses.push({name: bone.name, position, rotation, scaling});
  }
  return poses;
}

/** Escreve as poses lidas num esqueleto do MESMO asset, casando por nome. */
export function applyBonePoses(skeleton: Skeleton, poses: readonly BonePose[]): number {
  let applied = 0;
  for (const pose of poses) {
    const bone = skeleton.bones.find(b => b.name === pose.name);
    if (!bone) continue;
    const node = bone.getTransformNode();
    if (node) {
      node.position.copyFrom(pose.position);
      (node.rotationQuaternion ??= new Quaternion()).copyFrom(pose.rotation);
      node.scaling.copyFrom(pose.scaling);
    } else {
      bone.setPosition(pose.position);
      bone.rotationQuaternion = pose.rotation.clone();
      bone.scaling = pose.scaling.clone();
    }
    applied++;
  }
  skeleton.prepare(true);
  skeleton.computeAbsoluteMatrices(true);
  return applied;
}

/**
 * Comprimento REAL de um segmento, medido no asset: distância do osso ao filho escolhido, em
 * espaço de esqueleto (sem a matriz de mundo, logo sem a reflexão do glTF).
 *
 * `undefined` quando o osso não tem o filho pedido — quem chama decide o que fazer, em vez de
 * receber um número inventado. É por isto que `putBoxInBoneCenter` do Babylon não serve aqui: ele
 * depende de `bone.length`, que este rig não define (medido: indefinido nos 24 ossos).
 */
export function segmentLength(skeleton: Skeleton, bone: string, child: string, root: TransformNode): number | undefined {
  const from = skeleton.bones.find(b => b.name === bone);
  const to = skeleton.bones.find(b => b.name === child);
  if (!from || !to) return undefined;
  root.computeWorldMatrix(true);
  skeleton.computeAbsoluteMatrices(true);
  // MUNDO, não espaço de esqueleto: medido, este rig tem os ossos em CENTÍMETROS (a altura em
  // espaço de osso dá 166,8 para um personagem de 1,70 m). Medir em espaço de osso entregaria
  // extensões de caixa em centímetros e o corpo nasceria do tamanho de um prédio.
  const length = Vector3.Distance(from.getAbsolutePosition(root), to.getAbsolutePosition(root));
  return Number.isFinite(length) && length > 1e-4 ? length : undefined;
}

/** Altura do personagem em METROS de mundo — o tamanho real, já fora do espaço de osso. */
export function skeletonHeight(skeleton: Skeleton, root: TransformNode): number {
  root.computeWorldMatrix(true);
  skeleton.computeAbsoluteMatrices(true);
  let low = Infinity, high = -Infinity;
  const up = Vector3.TransformNormal(new Vector3(0, 1, 0), root.getWorldMatrix()).normalize();
  for (const bone of skeleton.bones) {
    const along = Vector3.Dot(bone.getAbsolutePosition(root), up);
    if (along < low) low = along;
    if (along > high) high = along;
  }
  return Number.isFinite(low) && Number.isFinite(high) ? high - low : 0;
}

/**
 * Matriz de mundo de um osso: `absoluta × mundo do nó raiz`.
 * Usada para colocar cada corpo físico onde o osso REALMENTE está no instante da morte.
 */
export function boneWorld(bone: Bone, root: TransformNode, into = new Matrix()): Matrix {
  bone.getAbsoluteMatrix().multiplyToRef(root.getWorldMatrix(), into);
  return into;
}

/**
 * Eixos do personagem MEDIDOS no rig no instante da morte — não presumidos a partir do mundo.
 *
 * O cadáver pode morrer de lado, de cabeça para baixo ou numa parede do planeta; qualquer "para o
 * lado" escrito em coordenadas de mundo estaria errado nessas horas. Aqui os eixos saem das posições
 * dos próprios ossos: a coluna (quadril→cabeça) e a linha dos ombros.
 */
export interface BodyFrame {
  /** Do quadril para a cabeça, normalizado. */
  readonly up: Vector3;
  /** Do ombro DIREITO para o ESQUERDO, já ortogonal a `up`. */
  readonly side: Vector3;
  /**
   * Terceiro eixo da base, `up × side`. É ortogonal aos outros dois — **não** afirmo que aponta
   * para a frente do personagem; quem usa só precisa de uma direção transversal consistente.
   */
  readonly cross: Vector3;
}

/**
 * Mede `BodyFrame` num esqueleto. `undefined` quando falta quadril, cabeça ou um dos ombros, ou
 * quando o rig está degenerado — quem chama decide o que fazer, em vez de receber eixos inventados.
 */
export function bodyFrame(skeleton: Skeleton, root: TransformNode): BodyFrame | undefined {
  root.computeWorldMatrix(true);
  skeleton.computeAbsoluteMatrices(true);
  const at = (name: string): Vector3 | undefined => skeleton.bones.find(b => b.name === name)?.getAbsolutePosition(root);
  const hips = at('Hips'), head = at('Head'), left = at('LeftArm'), right = at('RightArm');
  if (!hips || !head || !left || !right) return undefined;
  const up = head.subtract(hips), side = left.subtract(right);
  if (up.lengthSquared() < 1e-8 || side.lengthSquared() < 1e-8) return undefined;
  up.normalize();
  // Gram-Schmidt: a linha dos ombros raramente é perpendicular à coluna, e a base precisa ser.
  side.subtractInPlace(up.scale(Vector3.Dot(up, side)));
  if (side.lengthSquared() < 1e-8) return undefined;
  side.normalize();
  return {up, side, cross: Vector3.Cross(up, side).normalize()};
}

/**
 * Gira um osso NO LUGAR por uma rotação dada em espaço de MUNDO, escrevendo só a rotação local.
 *
 * A translação é reposta depois da rotação, então a articulação não sai do lugar: só a orientação
 * muda, e os ossos filhos acompanham pela hierarquia. A escala não é tocada — o `local` aqui é
 * `mundo desejado × inverso(mundo do pai)`, e a reflexão do glTF (`det = −1`) que existe nos dois
 * lados se cancela, que é o que impede a explosão de escala descrita no topo deste arquivo.
 */
export function rotateBoneInWorld(bone: Bone, root: TransformNode, rotation: Quaternion): void {
  const world = boneWorld(bone, root, Matrix.Identity());
  const pivot = world.getTranslation();
  const spin = Matrix.Identity();
  Matrix.FromQuaternionToRef(rotation, spin);
  const desired = world.multiply(spin);
  desired.setTranslation(pivot);
  const parent = bone.getParent();
  const parentWorld = parent ? boneWorld(parent, root, Matrix.Identity()) : root.getWorldMatrix();
  const local = desired.multiply(Matrix.Invert(parentWorld));
  const q = new Quaternion();
  local.decompose(undefined, q);
  q.normalize();
  const node = bone.getTransformNode();
  if (node) (node.rotationQuaternion ??= new Quaternion()).copyFrom(q);
  else bone.rotationQuaternion = q;
}

/** Um membro para abrir: o osso, o filho que dá a direção, e para onde ir — em MUNDO. */
export interface LimbOpening {
  /** Osso raiz do membro (ombro, coxa). */
  readonly bone: string;
  /** Osso filho que define a direção atual do membro (cotovelo, joelho, mão). */
  readonly tip: string;
  /** Direção desejada, em MUNDO. Não precisa vir normalizada. */
  readonly towards: Vector3;
  /** Fração do caminho até `towards`. Saturada em [0, 1]; `1` seria uma pose FORÇADA. */
  readonly blend: number;
  /** Teto absoluto do giro, em graus. */
  readonly maxDegrees: number;
}

/**
 * Abre um membro uma FRAÇÃO do caminho até uma direção — o contrário de impor uma pose.
 *
 * Existe porque a pose copiada na morte é a de segurar a arma com as duas mãos: cotovelos colados no
 * tronco, mãos juntas na frente do peito. Girar o membro uma fração até uma direção aberta desfaz o
 * aperto sem apagar a pose da morte (corrida, salto, giro continuam lá).
 *
 * Devolve o ângulo REALMENTE aplicado, em radianos — `0` quando o osso ou o filho não existem, a
 * direção é degenerada, ou não há nada a girar. Nunca lança.
 */
export function openLimb(skeleton: Skeleton, root: TransformNode, opening: LimbOpening): number {
  const bone = skeleton.bones.find(b => b.name === opening.bone);
  const tip = skeleton.bones.find(b => b.name === opening.tip);
  if (!bone || !tip) return 0;
  root.computeWorldMatrix(true);
  skeleton.computeAbsoluteMatrices(true);
  const from = tip.getAbsolutePosition(root).subtract(bone.getAbsolutePosition(root));
  const to = opening.towards.clone();
  if (from.lengthSquared() < 1e-10 || to.lengthSquared() < 1e-10) return 0;
  from.normalize(); to.normalize();
  const axis = Vector3.Cross(from, to);
  if (axis.lengthSquared() < 1e-10) return 0;   // já alinhado, ou oposto exato: sem eixo definido
  const blend = Math.max(0, Math.min(1, opening.blend));
  const full = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(from, to))));
  const angle = Math.min(full * blend, Math.max(0, opening.maxDegrees) * Math.PI / 180);
  if (!(angle > 1e-4)) return 0;
  rotateBoneInWorld(bone, root, Quaternion.RotationAxis(axis.normalize(), angle));
  skeleton.prepare(true);
  skeleton.computeAbsoluteMatrices(true);
  return angle;
}

/**
 * Rotação de mundo de um osso SEM escala e SEM reflexão.
 *
 * A raiz do glTF tem determinante −1; decompor a matriz de mundo direto devolveria escala negativa e
 * uma rotação espelhada. Aqui as colunas são reortonormalizadas por Gram-Schmidt e o terceiro eixo é
 * recomposto por produto vetorial, o que força uma base de mão direita — é isso que impede a
 * "explosão de escala" quando a rotação volta para o osso.
 */
export function boneWorldRotation(bone: Bone, root: TransformNode, into = new Quaternion()): Quaternion {
  const world = boneWorld(bone, root, Matrix.Identity());
  const m = world.asArray();
  const x = new Vector3(m[0]!, m[1]!, m[2]!);
  const y = new Vector3(m[4]!, m[5]!, m[6]!);
  if (x.lengthSquared() < 1e-12 || y.lengthSquared() < 1e-12) return into.copyFrom(Quaternion.Identity());
  x.normalize();
  y.subtractInPlace(x.scale(Vector3.Dot(x, y)));
  if (y.lengthSquared() < 1e-12) return into.copyFrom(Quaternion.Identity());
  y.normalize();
  const z = Vector3.Cross(x, y);
  const basis = Matrix.Identity();
  Matrix.FromXYZAxesToRef(x, y, z, basis);
  Quaternion.FromRotationMatrixToRef(basis, into);
  return into.normalize();
}

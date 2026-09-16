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

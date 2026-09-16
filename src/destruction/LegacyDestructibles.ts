import type {Vec3} from '../core/contracts';
import type {DestructibleKind, DestructibleRecord} from './DestructibleTypes';
import type {DestructibleState} from './DestructionModel';

/**
 * Suporte ao jogo plano legado (`PlayerScene`), onde **não existe manifesto de destrutíveis**.
 *
 * Diferença de fundo entre os dois mundos, e por isso este arquivo existe:
 *
 * | | planeta radial | legado plano |
 * |---|---|---|
 * | origem dos props | `manifest.destructibles` | varredura de nomes na cena |
 * | colisão | intervalo de triângulos em `PlanetCollision` | caixas em `CollisionWorld` |
 * | acerto | índice de triângulo do raio | posição do impacto |
 *
 * O `DestructionSystem` é o mesmo nos dois: quem muda é de onde vêm os registros e como a colisão
 * some. **Nada aqui edita `PlayerScene`** — é um adaptador que a cena pode chamar quando o root
 * quiser ligar, em duas linhas, sem risco de regressão em quem não chamar.
 */

/** Malha da cena, na medida exata do que este módulo lê. Evita importar Babylon no legado. */
export interface LegacyMeshLike {
  readonly name: string;
  computeWorldMatrix(force?: boolean): unknown;
  getBoundingInfo(): {boundingBox: {minimumWorld: Vec3; maximumWorld: Vec3}};
  getTotalVertices?(): number;
}

/** Caixa de colisão do `CollisionWorld`, na medida do que este módulo precisa. */
export interface LegacyBoxLike {readonly id: string; readonly min: Vec3; readonly max: Vec3}
export interface LegacyCollisionLike {boxes: LegacyBoxLike[]}

/**
 * Nome ⇒ tipo. A ordem importa: `tree-canopy` é copa e não deve virar árvore própria, então o
 * padrão que a recusa vem antes.
 */
export const LEGACY_PATTERNS: readonly {readonly pattern: RegExp; readonly kind: DestructibleKind | undefined}[] = [
  {pattern: /canopy|leaves|leaf|folha/i, kind: undefined},
  {pattern: /crate|caixa|box[-_ ]?prop/i, kind: 'crate'},
  {pattern: /barrel|barril|cask/i,       kind: 'barrel'},
  {pattern: /trunk|tree|arvore|árvore/i, kind: 'tree'},
  {pattern: /rock|stone|pedra|boulder/i, kind: 'rock'},
  {pattern: /barn|shed|greenhouse|silo|grain/i, kind: 'structure'},
];

/** Tipo de um nome de malha, ou `undefined` quando aquela malha não é destrutível. */
export function legacyKindOf(name: string): DestructibleKind | undefined {
  for (const entry of LEGACY_PATTERNS) if (entry.pattern.test(name)) return entry.kind;
  return undefined;
}

export interface LegacyScanOptions {
  /** Vertical do mundo plano. Padrão +Y. */
  readonly up?: Vec3;
  /** Maior meia-extensão aceita, em metros. Barra cenário inteiro que casou por acidente de nome. */
  readonly maxExtent?: number;
  /** Prefixo dos `id` gerados. */
  readonly prefix?: string;
}

/**
 * Constrói registros a partir das malhas da cena.
 *
 * Os registros saem com `triangleCount: 0` — **de propósito**: no legado não há intervalo de
 * triângulo, e o `DestructionField` trata zero como "resolve por posição". Estes registros são
 * montados à mão e não passam pelo parser do manifesto, que exige intervalo real justamente porque
 * no planeta um intervalo ausente seria erro de build.
 */
export function legacyRecordsFromMeshes(
  meshes: Iterable<LegacyMeshLike>, options: LegacyScanOptions = {},
): DestructibleRecord[] {
  const up = options.up ?? {x: 0, y: 1, z: 0};
  const maxExtent = options.maxExtent ?? 6;
  const prefix = options.prefix ?? 'legacy';
  const records: DestructibleRecord[] = [];
  let index = 0;
  for (const mesh of meshes) {
    const kind = legacyKindOf(mesh.name);
    if (!kind) continue;
    if (mesh.getTotalVertices && mesh.getTotalVertices() === 0) continue;
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    const extents: Vec3 = {
      x: (box.maximumWorld.x - box.minimumWorld.x) / 2,
      y: (box.maximumWorld.y - box.minimumWorld.y) / 2,
      z: (box.maximumWorld.z - box.minimumWorld.z) / 2,
    };
    if (!(extents.x > 0) || !(extents.y > 0) || !(extents.z > 0)) continue;
    // Estrutura é grande por definição; o teto vale para os props soltos.
    if (kind !== 'structure' && Math.max(extents.x, extents.y, extents.z) > maxExtent) continue;
    records.push({
      id: `${prefix}-${kind}-${index++}-${mesh.name}`,
      nodeName: mesh.name,
      kind,
      centre: {
        x: (box.maximumWorld.x + box.minimumWorld.x) / 2,
        y: (box.maximumWorld.y + box.minimumWorld.y) / 2,
        z: (box.maximumWorld.z + box.minimumWorld.z) / 2,
      },
      extents,
      up,
      triangleStart: 0,
      triangleCount: 0,
      components: [],
    });
  }
  return records;
}

/**
 * Remove do `CollisionWorld` as caixas que estão dentro do prop quebrado.
 *
 * Serve como `onBroken` do `DestructionSystem`. A caixa sai do array e o `CollisionWorld` refaz o
 * próprio grid na próxima consulta (ele já compara `boxCount` com `boxes.length`), então não há
 * reconstrução de geometria nem invalidação do índice de raios.
 *
 * Só remove caixa **contida** no prop, com folga: uma caixa que só encosta pode ser a parede ao lado,
 * e apagar parede de vizinho a partir de um barril seria o pior defeito possível deste sistema.
 */
export function legacyBoxRemover(world: LegacyCollisionLike, slack = 0.35): (state: DestructibleState) => number {
  return (state: DestructibleState): number => {
    const {centre, extents} = state.record;
    const minX = centre.x - extents.x - slack, maxX = centre.x + extents.x + slack;
    const minY = centre.y - extents.y - slack, maxY = centre.y + extents.y + slack;
    const minZ = centre.z - extents.z - slack, maxZ = centre.z + extents.z + slack;
    let removed = 0;
    for (let i = world.boxes.length - 1; i >= 0; i--) {
      const box = world.boxes[i]!;
      if (box.min.x < minX || box.max.x > maxX) continue;
      if (box.min.y < minY || box.max.y > maxY) continue;
      if (box.min.z < minZ || box.max.z > maxZ) continue;
      world.boxes.splice(i, 1);
      removed++;
    }
    return removed;
  };
}

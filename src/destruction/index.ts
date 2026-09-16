/**
 * Destruição de cenário — porta única de integração.
 *
 * Escopo, dito sem margem: **props, árvores e estruturas MARCADOS no manifesto**. Não é voxel, não
 * é destruição global, não é terreno deformável. O que não estiver marcado continua sólido para
 * sempre, e isso é a regra, não uma limitação a ser removida depois.
 *
 * O que já está pronto e testado:
 *  - vida por tipo, estágios de rachadura e quebra (`DestructionModel`)
 *  - colisão que some por intervalo de triângulos, sem refazer BVH (`PlanetCollision.disableTriangles`)
 *  - cacos recortados da GEOMETRIA ORIGINAL do prop, com o material original (`FragmentGeometry`)
 *  - árvore que tomba pela raiz, estrutura que cai por componentes (`DestructionVisuals`)
 *  - som pelos bancos de madeira/pedra/folhagem que já existem (`DestructionAudio`)
 *
 * ---------------------------------------------------------------------------------------------
 * RECEITA DE INTEGRAÇÃO NO PLANETA (para quem cuida de `PlanetScene`)
 *
 * 1. Manifesto — `PlanetManifest.parsePlanetManifest`, ao montar o retorno:
 *
 * ```ts
 * import {parseDestructibles} from '../destruction';
 * // ... no objeto devolvido por parsePlanetManifest:
 * destructibles: parseDestructibles(raw.destructibles, {
 *   centre: raw.centre === undefined ? {x:0,y:0,z:0} : vec3(raw.centre, 'centre'),
 *   triangleTotal: indices.length / 3,
 * }).records,
 * ```
 * (e `readonly destructibles: readonly DestructibleRecord[]` na interface `PlanetManifest`.)
 *
 * 2. Cena — depois de `collision.setGeometry(...)` e de o GLB estar na cena:
 *
 * ```ts
 * const destruction = new DestructionSystem({
 *   collision,                                   // o próprio PlanetCollision
 *   audio: materialDestructionAudio(this.audio), // WeaponAudio já existente
 *   presentation: new DestructionVisuals(scene, {
 *     root: worldRoot,                           // nó do GLB do planeta
 *     centre: manifest.centre,                   // gravidade RADIAL para os cacos
 *     support: (point, up) => collision.supportBelow(point, up, 0.6, 12)?.offset,
 *   }),
 * });
 * destruction.register(manifest.destructibles);
 * ```
 *
 * 3. Tiro — em `PlanetWeapons.fireRay`, no ramo que hoje só desenha marca de bala:
 *
 * ```ts
 * } else if (!shot.missed) {
 *   const broke = this.destruction?.hit({
 *     point: shot.point, direction, damage, triangle: shot.triangle, normal: shot.normal,
 *   });
 *   if (!broke) {                    // prop destrutível já tem marca e som próprios
 *     this.effects.mark(point, normal);
 *     this.effects.impact(point, normal);
 *   }
 * }
 * ```
 * `shot.triangle` precisa vir do `hitscan`: `HitscanResult` ainda não carrega o triângulo do
 * mundo — basta repassar `world.triangle` em `PlanetHitscan.hitscan` (uma linha). Sem ele o
 * sistema ainda funciona, resolvendo por posição (`field.atPoint`), só um pouco menos exato.
 *
 * 4. Habilidade em área (opcional): `destruction.splash(point, 4.5, 60)`.
 *
 * 5. Quadro: `destruction.update(dt)` junto com os outros `update` da cena.
 *    Reinício de tentativa: `destruction.resetAttempt()`.
 *
 * ---------------------------------------------------------------------------------------------
 * LEGADO PLANO (`PlayerScene`) — opcional, sem tocar no planeta
 *
 * ```ts
 * const destruction = new DestructionSystem({
 *   presentation: new DestructionVisuals(scene, {support: (p) => p.y - collision.groundAt(p.x, p.z, p.y + 2)}),
 *   audio: materialDestructionAudio(audio),
 *   onBroken: legacyBoxRemover(collision),
 * });
 * destruction.register(legacyRecordsFromMeshes(scene.meshes));
 * // no tiro: destruction.hit({point, direction, damage});   // sem `triangle`: resolve por posição
 * ```
 */
export {
  DESTRUCTIBLE_KINDS, parseDestructibles, totalTriangles,
} from './DestructibleTypes';
export type {
  DestructibleKind, DestructibleComponent, DestructibleRecord, DestructibleParseResult, DestructibleParseOptions,
} from './DestructibleTypes';

export {DESTRUCTIBLE_PROFILES, DestructibleState, profileOf} from './DestructionModel';
export type {BreakStyle, DamageReport, ImpactMaterial, KindProfile} from './DestructionModel';

export {DestructionField} from './DestructionField';
export type {FieldHit} from './DestructionField';

export {DestructionSystem} from './DestructionSystem';
export type {DestructionSystemOptions} from './DestructionSystem';

export type {
  DestructionAudioPort, DestructionCollisionPort, DestructionHit, DestructionOutcome, DestructionPresentationPort,
} from './DestructionPorts';

export {FRAGMENT_SOURCE_LIMIT, shatterGeometry} from './FragmentGeometry';
export type {FragmentSlice, GeometrySource} from './FragmentGeometry';

export {DEBRIS_BUDGET, DestructionDebris} from './DestructionDebris';
export type {DebrisOptions, SupportProbe} from './DestructionDebris';

export {DestructionVisuals} from './DestructionVisuals';
export type {VisualOptions} from './DestructionVisuals';

export {materialDestructionAudio, silentDestructionAudio} from './DestructionAudio';
export type {MaterialFoley} from './DestructionAudio';

export {LEGACY_PATTERNS, legacyBoxRemover, legacyKindOf, legacyRecordsFromMeshes} from './LegacyDestructibles';
export type {LegacyBoxLike, LegacyCollisionLike, LegacyMeshLike, LegacyScanOptions} from './LegacyDestructibles';

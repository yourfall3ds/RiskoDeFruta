import type {Vec3} from '../core/contracts';
import type {EnemyKind} from '../run/MonsterDirector';

/**
 * Pontos fracos FÍSICOS por espécie.
 *
 * Nada aqui é inventado: cada zona é um conjunto de ossos REAIS dos GLB autorais, e o raio saiu da
 * extensão dos vértices que aquele osso domina (peso > 0,5) na pose de repouso. A medição está em
 * `.temp/rig-weak-probe.json` e o resumo em `docs/WEAK_POINTS.md`; o script que a produz é
 * `.temp/rig-weak-probe.mjs`, que lê o próprio `.glb` — se o asset mudar, os números são refeitos
 * em vez de adivinhados.
 *
 * Os cinco modelos chegam normalizados com 1,7 unidade de altura em repouso, então os raios abaixo
 * estão em unidades de MODELO e são multiplicados pela escala viva do ator (`ENEMIES[kind].scale ×
 * afixo`). É por isso que a Praga Alfa (melancia a 2,5×) tem uma coroa proporcionalmente maior sem
 * nenhum número separado.
 *
 * **O teste é o SEGMENTO da bala, não a proximidade do corpo.** Ver `resolveWeakPoint`: o acerto só
 * conta quando a linha do projétil passa DENTRO da esfera do ponto fraco. Um tiro no tronco que por
 * acaso está a um metro da cabeça não vira crítico, que é a diferença entre "ponto fraco" e
 * "aproximação grosseira".
 */

export interface WeakPointZone {
  /** Identificador estável — aparece no rótulo e nos testes. */
  readonly id: string;
  /** Nome legível, em português, para o retorno na tela. */
  readonly label: string;
  /**
   * Sufixos dos nós/ossos do rig que compõem a zona. São SUFIXOS porque a instanciação renomeia
   * cada nó para `enemy-<id>-<nome original>`.
   */
  readonly bones: readonly string[];
  /** Raio da esfera de cada osso, em unidades de MODELO (altura de repouso = 1,7). */
  readonly radius: number;
}

/**
 * Multiplicador do acerto direto.
 *
 * Fica ACIMA do crítico comum (×2) para o acerto mirado valer mais que um crítico de sorte, e NÃO
 * se soma a ele: ver `weakPointDamageMultiplier`. Empilhar os dois transformaria ponto fraco em
 * ×4,8 e devolveria a cascata de dano que o pedido proíbe.
 */
export const WEAK_POINT_MULTIPLIER = 2.4;

/**
 * Alcance máximo do segmento testado, em metros.
 *
 * `hitPosition` é o ponto de ENTRADA na caixa envolvente do ator, então o ponto fraco está sempre a
 * poucos metros dali — a maior caixa em jogo é a da Praga Alfa. O teto existe só para o teste nunca
 * virar um raio infinito que enxerga a asa de outro bicho.
 */
export const WEAK_POINT_REACH = 8;

/**
 * Zonas por espécie.
 *
 * - **berinjela** e **milho** usam o rig humanoide de 24 ossos (`Head` domina 1 345 e 1 323
 *   vértices): a CABEÇA é a silhueta reconhecível dos dois.
 * - **cenoura**: o ponto é a MÃO-CANHÃO direita, que é de onde sai o laser (`RightHand` já é o
 *   socket do feixe em `EnemySwarm`) e domina 1 576 vértices — o objeto destacado do modelo.
 * - **tomate voador**: as ASAS, como pedido. São as cadeias `Bone_042→041→040` (esquerda) e
 *   `Bone_045→044→043` (direita) — os mesmos ossos que a batida de asa já anima. Os ossos de raiz
 *   (042/045) ficam de fora de propósito: eles encostam no tronco (|x| até 0,40) e transformariam
 *   tiro no corpo em acerto na asa. Os quatro usados vivem em |x| ≥ 0,73, e o tronco termina em
 *   |x| = 0,63 — não há sobreposição.
 * - **melancia** e **PRAGA ALFA**: a COROA no topo da casca, as duas hastes com olhos
 *   (`Bone_006/007` e `Bone_008/009`, y entre 1,27 e 1,70) que se projetam acima da casca, cuja
 *   extensão para em y = 1,48. É a única saliência do corpo, e o chefe usa o mesmo rig.
 */
export const WEAK_POINTS: Readonly<Record<EnemyKind, WeakPointZone | undefined>> = {
  eggplant: {id: 'eggplant_head', label: 'cabeça', bones: ['Head'], radius: 0.26},
  corn: {id: 'corn_head', label: 'cabeça', bones: ['Head'], radius: 0.18},
  carrot: {id: 'carrot_cannon', label: 'mão-canhão', bones: ['RightHand'], radius: 0.22},
  tomato: {
    id: 'tomato_wings', label: 'asas',
    bones: ['Bone_041', 'Bone_040', 'Bone_044', 'Bone_043'], radius: 0.28,
  },
  watermelon: {
    id: 'watermelon_crown', label: 'coroa',
    bones: ['Bone_006', 'Bone_007', 'Bone_008', 'Bone_009'], radius: 0.19,
  },
  boss: {
    id: 'boss_crown', label: 'coroa da Praga Alfa',
    bones: ['Bone_006', 'Bone_007', 'Bone_008', 'Bone_009'], radius: 0.19,
  },
};

export interface WeakPointSphere {
  readonly centre: Vec3;
  readonly radius: number;
}

/**
 * Tags de dano que PODEM abrir ponto fraco.
 *
 * Só projétil. Corpo a corpo, queimadura, explosão e qualquer dano secundário ficam de fora: eles
 * não têm uma linha de tiro para testar, e dar crítico a eles seria exatamente o "crítico em todo
 * acerto por aproximação" que o pedido recusa.
 */
export const WEAK_POINT_TAG = 'bullet';

/** `true` quando este acerto tem direito a disputar ponto fraco. */
export function weakPointEligible(
  attackerId: number, procChainDepth: number, damageTags: readonly string[],
): boolean {
  return attackerId === 1 && procChainDepth === 0 && damageTags.includes(WEAK_POINT_TAG);
}

/**
 * Multiplicador final do acerto, sem empilhar ponto fraco com crítico de sorte.
 *
 * Um acerto direto JÁ é crítico (é o que o pedido pede), então o dado do crítico aleatório nem
 * chega a ser rolado — ver `EnemySwarm.hit`. Aqui a regra fica num lugar só para o teste travar.
 */
export function weakPointDamageMultiplier(weak: boolean, crit: boolean): number {
  if (weak) return WEAK_POINT_MULTIPLIER;
  return crit ? 2 : 1;
}

/**
 * Interseção raio × esfera, aceitando origem DENTRO da esfera.
 *
 * `origin` é o ponto de entrada na caixa envolvente — pode já estar dentro da esfera quando o ponto
 * fraco encosta na face da caixa (a ponta de uma asa, por exemplo). Nesse caso `c <= 0` e o acerto
 * conta; é o mesmo critério do `raySphere` do `PlanetHitscan`, só que sem exigir raiz positiva.
 */
export function raySphereHit(
  origin: Vec3, direction: Vec3, centre: Vec3, radius: number, maxDistance: number,
): boolean {
  const dl = Math.hypot(direction.x, direction.y, direction.z);
  if (!(dl > 1e-9) || !(radius > 0)) return false;
  const dx = direction.x / dl, dy = direction.y / dl, dz = direction.z / dl;
  const ox = origin.x - centre.x, oy = origin.y - centre.y, oz = origin.z - centre.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c <= 0) return true;                                  // origem já dentro
  const b = 2 * (dx * ox + dy * oy + dz * oz);
  const disc = b * b - 4 * c;
  if (disc < 0) return false;
  const root = Math.sqrt(disc);
  const near = (-b - root) / 2, far = (-b + root) / 2;
  // O segmento vai só para a FRENTE: uma esfera atrás do ponto de entrada não foi atravessada.
  return (near >= 0 && near <= maxDistance) || (far >= 0 && far <= maxDistance);
}

/**
 * Índice da esfera atingida pelo segmento, ou `-1`.
 *
 * Determinístico e sem alocação: é chamado por acerto, e um acerto acontece muitas vezes por
 * segundo durante a horda final.
 */
export function resolveWeakPoint(
  origin: Vec3, direction: Vec3, spheres: readonly WeakPointSphere[], maxDistance = WEAK_POINT_REACH,
): number {
  for (let i = 0; i < spheres.length; i++) {
    const sphere = spheres[i]!;
    if (raySphereHit(origin, direction, sphere.centre, sphere.radius, maxDistance)) return i;
  }
  return -1;
}

/** Nome legível da zona de uma espécie, para HUD e relatórios. `undefined` quando não há. */
export function weakPointLabel(kind: EnemyKind): string | undefined {
  return WEAK_POINTS[kind]?.label;
}

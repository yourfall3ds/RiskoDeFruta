import type {Vec3} from '../core/contracts';

/**
 * Quais recortes de chão físico devem existir em volta dos cadáveres articulados — e quantos podem
 * NASCER neste quadro.
 *
 * Por que isto virou um módulo puro: o corpo físico de terreno do planeta é uma malha de Havok
 * (`PhysicsShapeType.MESH`) construída a partir de uma consulta na BVH de 1,75 M de triângulos. Cada
 * nascimento custa consulta + `VertexData.applyToMesh` + construção da forma — trabalho SÍNCRONO de
 * vários milissegundos. A versão anterior decidia a residência por "célula de 8 m arredondada da
 * posição do cadáver", sem histerese e sem orçamento, então:
 *
 * 1. um cadáver parado em cima de uma fronteira de célula trocava de chave quadro sim, quadro não,
 *    e cada troca DESTRUÍA e RECONSTRUÍA a malha física — por quadro, por cadáver;
 * 2. qualquer mudança na máscara de triângulos (isto é, **qualquer prop de cenário quebrando**)
 *    derrubava TODOS os recortes de uma vez e todos renasciam no mesmo quadro.
 *
 * (2) liga diretamente "muitas explosões" a "o navegador trava", que é o relato. Aqui a decisão é
 * separada da construção: um recorte só é abandonado quando o corpo sai de um raio MAIOR que o de
 * criação (histerese), no máximo `spawnBudget` recorte nasce por quadro, e a invalidação por
 * destruição marca os recortes como VELHOS em vez de matá-los — o chão velho continua segurando o
 * cadáver até o substituto caber no orçamento.
 */

export interface CorpsePatchState {
  /** Centro do recorte já construído, em MUNDO. */
  readonly centre: Vec3;
  /** `true` quando a geometria dele ficou desatualizada (destruição mudou a máscara). */
  stale: boolean;
}

export interface ResidencyOptions {
  /** Raio da consulta de triângulos que gera o recorte. */
  readonly radius: number;
  /**
   * Distância a partir da qual um corpo deixa de ser servido pelo recorte e pede outro.
   * Tem de ser MENOR que `radius` (o recorte precisa sobrar chão além do corpo) e é o que dá a
   * histerese: entre `keep` e `radius` nada é reconstruído.
   */
  readonly keep: number;
  /** Recortes vivos ao mesmo tempo. */
  readonly limit: number;
  /** Recortes que podem NASCER neste quadro. */
  readonly spawnBudget: number;
}

/**
 * `limit: 4` não é um número redondo: é o teto de cadáveres articulados simultâneos do
 * `RagdollWorld` (ele libera o mais antigo ao passar de quatro). Um teto MENOR que a população de
 * cadáveres produz debulha — o recorte criado para o corpo A expulsa o do corpo D, que no quadro
 * seguinte pede o dele de volta e expulsa o de A. Com `limit` abaixo do número de corpos a
 * simulação de 30 s media 580 reconstruções; com quatro, 56.
 */
export const CORPSE_TERRAIN: ResidencyOptions = {radius: 16, keep: 9, limit: 4, spawnBudget: 1};

export interface ResidencyPlan {
  /** Centros a construir agora, já dentro do orçamento do quadro. */
  readonly create: Vec3[];
  /** Índices (na lista recebida) dos recortes que podem ser descartados. */
  readonly release: number[];
}

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Decide o próximo passo da residência.
 *
 * `bodies` são as posições dos cadáveres articulados vivos; `patches` os recortes que já existem.
 * A regra, em ordem:
 *
 * - um recorte **não velho** que cobre pelo menos um corpo dentro de `keep` fica;
 * - um recorte que não cobre corpo nenhum sai (não há orçamento para sair: soltar é barato);
 * - um recorte VELHO continua vivo enquanto o substituto dele não nascer — chão desatualizado é
 *   melhor que cadáver atravessando o mundo;
 * - corpos sem cobertura pedem recorte novo, no máximo `spawnBudget` por quadro, e nunca acima de
 *   `limit` recortes vivos (o mais distante de qualquer corpo é liberado para abrir vaga).
 *
 * Determinístico e sem alocação escondida: é o que torna o teste de regressão possível sem Havok.
 */
export function planCorpseTerrain(
  bodies: readonly Vec3[], patches: readonly CorpsePatchState[], options: ResidencyOptions = CORPSE_TERRAIN,
): ResidencyPlan {
  const create: Vec3[] = [], release: number[] = [];
  const keep = Math.min(options.keep, options.radius);
  // Um recorte serve um corpo quando o corpo está dentro de `keep` DELE. Velho SERVE (o chão ainda
  // segura o cadáver), mas não CONTA como cobertura: ele precisa de substituto.
  const servedBy = (patch: CorpsePatchState, body: Vec3): boolean => distance(patch.centre, body) <= keep;

  const live: number[] = [];
  for (const [index, patch] of patches.entries()) {
    if (bodies.some(body => servedBy(patch, body))) live.push(index); else release.push(index);
  }
  const covered = bodies.map(body =>
    live.some(index => {const patch = patches[index]!; return !patch.stale && servedBy(patch, body);}));

  // O teto de criação é `limit + spawnBudget`: é a folga que permite o SUBSTITUTO nascer antes de o
  // recorte velho sair. Sem ela um cadáver ficaria um quadro sem chão físico a cada invalidação.
  const ceiling = options.limit + Math.max(0, options.spawnBudget);
  let budget = Math.max(0, options.spawnBudget);
  for (const [index, body] of bodies.entries()) {
    if (covered[index] || budget <= 0) continue;
    if (live.length + create.length >= ceiling) break;
    create.push({x: body.x, y: body.y, z: body.z});
    budget--;
    // O recorte que vai nascer já cobre os outros corpos perto dele: não peça dois no mesmo ponto.
    for (let other = index + 1; other < bodies.length; other++) {
      if (!covered[other] && distance(body, bodies[other]!) <= keep) covered[other] = true;
    }
  }

  // Poda até o teto duro, preferindo VELHO e, entre iguais, o mais longe de qualquer corpo.
  let over = live.length + create.length - options.limit;
  if (over > 0) {
    const ranked = [...live].sort((a, b) => victimScore(patches[b]!, bodies) - victimScore(patches[a]!, bodies));
    for (const index of ranked) {
      if (over <= 0) break;
      release.push(index);
      live.splice(live.indexOf(index), 1);
      over--;
    }
  }
  return {create, release};
}

/** Quanto este recorte merece sair: velho primeiro, depois o mais distante de qualquer cadáver. */
function victimScore(patch: CorpsePatchState, bodies: readonly Vec3[]): number {
  let nearest = Infinity;
  for (const body of bodies) nearest = Math.min(nearest, distance(patch.centre, body));
  return (patch.stale ? 1e6 : 0) + (Number.isFinite(nearest) ? nearest : 1e3);
}

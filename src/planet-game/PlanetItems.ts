import {ITEMS, type ItemDefinition, type RunStats} from '../run/RunProgression';

/**
 * Quais itens do catálogo esta cena realmente aplica.
 *
 * Entregar um item que não faz nada é pior do que não entregar: o jogador paga créditos, vê o nome
 * na tela e não ganha poder nenhum. A lista abaixo só contém atributos que algum sistema da
 * expedição no planeta lê de verdade.
 *
 * Ficam de fora, com o motivo concreto:
 *
 * | atributo | por que não entra |
 * |---|---|
 * | `moveSpeed`, `sprintSpeed`, `jump`, `extraJumps` | `PlanetMotor` congela `tuning` no construtor e não expõe multiplicador. É módulo do núcleo (`src/planet`), que esta camada não edita. |
 * | `dodgeRecharge` | não existe esquiva nesta cena |
 * | `skillCharges` | não existe continuação de habilidade nesta cena |
 * | `hook` (`burn`/`harvest`/`blast`) | os procs não estão implementados aqui |
 *
 * Quando o núcleo expuser velocidade mutável, basta acrescentar os atributos aqui — o sorteio,
 * o baú e o HUD passam a incluí-los sozinhos.
 */
export const APPLICABLE_STATS: readonly (keyof RunStats)[] = [
  'maxHP', 'damage', 'attackSpeed', 'crit', 'armor', 'regeneration', 'mp',
];

export const APPLICABLE_ITEMS: readonly ItemDefinition[] = ITEMS.filter(
  item => item.stat !== undefined && item.value !== undefined && APPLICABLE_STATS.includes(item.stat),
);

/** Sorteio com a mesma proporção de raridade do jogo plano, restrito ao que funciona. */
export function rollApplicableItem(random: () => number): ItemDefinition {
  const pool = APPLICABLE_ITEMS.length > 0 ? APPLICABLE_ITEMS : ITEMS;
  const uncommon = pool.filter(item => item.rarity === 'uncommon');
  const common = pool.filter(item => item.rarity === 'common');
  const bucket = random() < 0.24 && uncommon.length > 0 ? uncommon : common.length > 0 ? common : pool;
  return bucket[Math.min(bucket.length - 1, Math.floor(random() * bucket.length))]!;
}

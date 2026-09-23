import { PISTOL_TUNING } from '../src/player/PlayerTuning';
import { PRISM_GRENADE, PRISM_MODES } from '../src/combat/PrismTuning';
import { PRISM_SKILL_BLAST_CAP, allPrismSkills } from '../src/combat/PrismSkills';
import { MARIJUANO_SKILLS, MARIJUANO_SMG } from '../src/combat/SmgTuning';

/**
 * A TABELA DE DANO DO SERVIDOR — "o cliente nunca envia dano".
 *
 * O pedido de acerto (`src/net/HitClaim.ts`) diz QUAL arma acertou QUEM. O número que o cliente
 * manda é, no máximo, uma dica: o servidor usa o menor entre ele e o teto desta tabela, e recusa
 * fonte desconhecida. O teto é o MAIOR dano base que aquela fonte pode produzir em qualquer
 * situação legítima (habilidade mais forte, explosão no centro), derivado dos MESMOS arquivos de
 * ajuste que as armas usam — rebalancear uma arma move a tabela junto, sem segunda cópia.
 *
 * Por que teto e não valor exato: o dano de uma explosão cai com a distância e o de uma habilidade
 * depende do nível; o servidor não refaz a balística da PRISM. O teto fecha a porta do "mil de dano
 * num tiro de assalto" sem exigir que o servidor simule cada arma.
 *
 * Fora da tabela, de propósito: o SOCO. Ele já é resolvido no servidor pela mensagem `melee`;
 * aceitar também o acerto local dobraria o golpe.
 */
function build(): ReadonlyMap<string, number> {
  const table = new Map<string, number>();
  const put = (id: string, value: number) => table.set(id, Math.max(table.get(id) ?? 0, value));

  // Pistoleiro: tiro comum e as três habilidades (valores de `DualPistols.skillRay`/ricochete).
  put('dual_pistols', PISTOL_TUNING.damage);
  put('ricochet_fan', 18);
  put('backflip_barrage', 24);
  put('harvest_storm', 18);

  // Soldado: a PRISM usa o id da FORMA também nas habilidades, escalando o dano.
  const skills = allPrismSkills();
  const blastScale = Math.max(1, ...skills.map(s => s.damageScale)) * PRISM_SKILL_BLAST_CAP;
  for (const mode of PRISM_MODES) {
    const index = PRISM_MODES.indexOf(mode);
    const scale = Math.max(1, ...skills.filter(s => s.mode === index).map(s => s.damageScale));
    put(mode.id, mode.damage * scale);
    // Cápsula e mina explodem com o dano de explosão, na forma que as disparou.
    put(mode.id, PRISM_GRENADE.blastDamage * blastScale);
  }

  // Marijuano: o bud e as três intensidades da mesma arma.
  const smgScale = Math.max(1, ...Object.values(MARIJUANO_SKILLS).map(s => s.damageScale));
  put(MARIJUANO_SMG.id, MARIJUANO_SMG.damage * smgScale);
  return table;
}

export const DAMAGE_TABLE: ReadonlyMap<string, number> = build();

/** Dano base que o servidor aceita para este pedido, ou `undefined` para fonte desconhecida. */
export function authorizedBase(source: string, claimed: number): number | undefined {
  const ceiling = DAMAGE_TABLE.get(source);
  if (ceiling === undefined) return undefined;
  return Math.min(claimed, ceiling);
}

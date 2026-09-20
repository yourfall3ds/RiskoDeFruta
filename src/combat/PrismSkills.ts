import {PRISM_GRENADE,PRISM_MODES,type PrismMode} from './PrismTuning';

/**
 * As habilidades de MP do SOLDADO — seis, uma por (forma, nível).
 *
 * O soldado carrega o `Q` como o pistoleiro sempre carregou, mas o que sai é outra coisa:
 *
 *   nível I  → transforma a PRISM (grátis, já existia);
 *   nível II  (55 MP) e nível III (100 MP) → habilidade PRÓPRIA DA FORMA que está nas mãos.
 *
 * O ponto do módulo é que as seis sejam DIFERENTES de verdade, e não três coreografias de pistola
 * reaproveitadas: cada uma tem munição própria, dano próprio, dispersão própria e uma mecânica que
 * só faz sentido naquela forma. Os números moram aqui, longe da mecânica, pelo mesmo motivo de
 * `PRISM_MODES`: balancear não pode exigir ler o backend.
 *
 * | Forma | II | III |
 * |---|---|---|
 * | Assalto | rajada curta e PERFEITAMENTE mirada | sobrecarga: janela de cadência dobrada |
 * | Lança de íons | tiro pesado perfurante | salva de íons multi-alvo, com recuo para a frente |
 * | Lança-granadas | leque de três cápsulas | salva incendiária de cinco, com explosão maior |
 *
 * Tudo aqui é PURO: sem Babylon, sem cena, sem áudio. Quem executa é `PrismWeapon`, pela mesma
 * porta `CombatServices` do tiro comum — nenhuma física nova é escrita para as habilidades.
 */

export type PrismSkillTier = 2 | 3;

/**
 * A mecânica da habilidade.
 *
 * - `burst`  — N tiros instantâneos em sequência, pela mira.
 * - `overdrive` — nenhuma emissão própria: abre uma JANELA em que o disparo normal muda.
 * - `volley` — N tiros instantâneos, cada um num ALVO diferente; sem alvo, vai para a frente.
 * - `fan`    — N cápsulas balísticas abertas em leque lateral.
 * - `beam`   — CARREGA por `chargeSeconds` e então sustenta um feixe perfurante: as emissões são
 *              os tiques de dano do feixe, todas pela mira do instante.
 * - `strike` — MARCA os `shots` hostis mais próximos, espera `chargeSeconds`, e então cada emissão
 *              é um míssil que cai na vertical LOCAL do alvo marcado e explode em área.
 */
export type PrismSkillKind = 'burst' | 'overdrive' | 'volley' | 'fan' | 'beam' | 'strike';

export interface PrismSkillPlan {
  /** Id estável; entra em `attackId` do dano e nos testes. */
  readonly id: string;
  /** Nome na tela (barra de carga e painel de arma). */
  readonly name: string;
  readonly mode: PrismMode;
  readonly tier: PrismSkillTier;
  readonly kind: PrismSkillKind;
  /** Munição retirada do carregador DA FORMA no instante em que a habilidade é aceita. */
  readonly ammoCost: number;
  /** Munição mínima carregada para a habilidade ser aceita (≥ `ammoCost`). */
  readonly ammoRequired: number;
  /** Emissões. Zero em `overdrive`, que não emite nada por conta própria. */
  readonly shots: number;
  /** Segundos entre emissões. Zero = todas no mesmo passo (leque simultâneo). */
  readonly interval: number;
  /** Multiplicador do dano BASE da forma, por emissão. */
  readonly damageScale: number;
  /** Abertura forçada, em graus. Zero = perfeitamente mirado. */
  readonly spreadDegrees: number;
  /** `true` atravessa e dana todos os corpos da linha até a primeira parede. */
  readonly pierce: boolean;
  /** Multiplicadores do empurrão no alvo e do tranco de câmera. */
  readonly forceScale: number;
  readonly impulseScale: number;
  /** `overdrive`: duração da janela e multiplicador da cadência dentro dela. */
  readonly seconds: number;
  readonly rateScale: number;
  /** `fan`: abertura lateral TOTAL, em graus (metade para cada lado). */
  readonly fanDegrees: number;
  /** Carga da cápsula (`fan`) e da ogiva (`strike`): raio e dano da explosão, e se ela incendeia. */
  readonly blastRadiusScale: number;
  readonly blastDamageScale: number;
  readonly incendiary: boolean;
  /**
   * Segundos ANTES da primeira emissão. Zero em tudo que sai no ato.
   *
   * É o que dá peso às duas habilidades novas: no `beam` é a carga de energia que o jogador vê e
   * ouve subir; no `strike` é a janela entre marcar os alvos e os mísseis caírem. O relógio da
   * emissão conta a partir daqui, não do `start` — ver `PrismSkillRunner.update`.
   */
  readonly chargeSeconds: number;
  /**
   * Raio de busca dos alvos do `strike`, em metros. Zero nas demais.
   *
   * A marcação escolhe os `shots` hostis VIVOS mais próximos dentro deste raio. Menos hostis que
   * mísseis é caso normal (fim de horda): sobra míssil, e o que sobra cai à frente da mira.
   */
  readonly markRadius: number;
  /**
   * A explosão acende o CHÃO onde bate, além de danar quem está no raio.
   *
   * Separado de `incendiary` de propósito: aquele acende o CORPO atingido (queimadura por alvo,
   * `EnemySwarm.hit`), este acende o TERRENO (área negada que sobrevive à explosão). Uma salva
   * incendiária faz os dois; um míssil faz só o segundo.
   */
  readonly groundFire: boolean;
  /** Linha curta do painel de arma. */
  readonly hint: string;
}

/**
 * Teto do raio da explosão das habilidades, como FATOR do raio normal.
 *
 * O pedido da salva incendiária é "explosão maior, com efeito LIMITADO". Sem um teto escrito, um
 * ajuste de balanceamento futuro viraria limpeza de tela — e a promessa de área limitada da granada
 * comum (`docs/PRISM_GAMEPLAY.md`) deixaria de valer para a habilidade.
 */
export const PRISM_SKILL_BLAST_CAP = 1.5;

/** Etiqueta do dano que acende o alvo. O receptor (`EnemySwarm.hit`) é quem aplica a queimadura. */
export const INCENDIARY_TAG = 'incendiary';

/** Duração da queimadura da salva incendiária, em segundos. Limitada e sem empilhar. */
export const INCENDIARY_SECONDS = 4;

/**
 * Etiquetas do dano das habilidades.
 *
 * `bullet` mantém o direito a ponto fraco (é tiro de verdade, com par `(ponto, direção)`);
 * `skill` faz o dano escalar por `stats.mp` e — de propósito — DESLIGA o ganho de MP por acerto
 * (`awardsMP`). Sem isso uma sobrecarga de seis segundos se pagaria sozinha e a barra deixaria de
 * ser um recurso.
 */
export const PRISM_SKILL_TAGS: readonly string[] = ['bullet', 'skill'];

/** Estilhaço das cápsulas de habilidade: mesma regra do estilhaço comum, sem ponto fraco nem MP. */
export const PRISM_SKILL_BLAST_TAGS: readonly string[] = ['explosive', 'skill'];

function plan(values: PrismSkillPlan): PrismSkillPlan { return values; }

const ASSAULT_II = plan({
  id: 'prism_assault_beam', name: 'CARGA DE ÍONS', mode: 0, tier: 2, kind: 'beam',
  ammoCost: 8, ammoRequired: 8, shots: 12, interval: .05, damageScale: .85,
  // Zero graus e perfurante: o feixe é uma LINHA, não uma rajada — atravessa a fila inteira.
  spreadDegrees: 0, pierce: true, forceScale: .9, impulseScale: 1.2,
  seconds: 0, rateScale: 1, fanDegrees: 0,
  blastRadiusScale: 1, blastDamageScale: 1, incendiary: false,
  // A carga é o que separa esta habilidade da rajada que ela substituiu: 0,85 s de energia subindo
  // no cano antes de o feixe abrir. Quem solta no susto ainda paga o tempo — não há disparo seco.
  chargeSeconds: .85, markRadius: 0, groundFire: false,
  hint: 'Q II · CARGA DE ÍONS · FEIXE PERFURANTE',
});

const ASSAULT_III = plan({
  id: 'prism_assault_strike', name: 'CHUVA DE MÍSSEIS', mode: 0, tier: 3, kind: 'strike',
  // Não retira munição: a marcação é paga em MP. A exigência mínima evita abrir com a arma vazia.
  ammoCost: 0, ammoRequired: 4, shots: 3, interval: .12, damageScale: 1.2,
  spreadDegrees: 0, pierce: false,
  // Empurrão alto e tranco forte: é a promessa do pedido, e quem a cobra de verdade é o ramo
  // explosivo de `enemyImpact` — aqui só se diz que este golpe é pesado.
  forceScale: 3.2, impulseScale: 1.8,
  seconds: 0, rateScale: 1, fanDegrees: 0,
  blastRadiusScale: PRISM_SKILL_BLAST_CAP, blastDamageScale: 2.2, incendiary: false,
  // 0,8 s entre marcar e cair: tempo de ver os três marcadores acenderem antes do céu responder.
  chargeSeconds: .8, markRadius: 26, groundFire: true,
  hint: 'Q III · MARCA 3 · MÍSSIL DO CÉU',
});

const SNIPER_II = plan({
  id: 'prism_sniper_heavy', name: 'PERFURANTE PESADA', mode: 1, tier: 2, kind: 'burst',
  ammoCost: 2, ammoRequired: 2, shots: 1, interval: 0, damageScale: 3.2,
  spreadDegrees: 0, pierce: true, forceScale: 2.2, impulseScale: 1.6,
  seconds: 0, rateScale: 1, fanDegrees: 0,
  blastRadiusScale: 1, blastDamageScale: 1, incendiary: false,
  chargeSeconds: 0, markRadius: 0, groundFire: false,
  hint: 'Q II · TIRO PESADO PERFURANTE · 2 BALAS',
});

const SNIPER_III = plan({
  id: 'prism_sniper_volley', name: 'SALVA DE ÍONS', mode: 1, tier: 3, kind: 'volley',
  ammoCost: 4, ammoRequired: 4, shots: 4, interval: .16, damageScale: 1.9,
  spreadDegrees: 0, pierce: true, forceScale: 1.8, impulseScale: 1.1,
  seconds: 0, rateScale: 1, fanDegrees: 0,
  blastRadiusScale: 1, blastDamageScale: 1, incendiary: false,
  chargeSeconds: 0, markRadius: 0, groundFire: false,
  hint: 'Q III · SALVA MULTI-ALVO · 4 BALAS',
});

const GRENADE_II = plan({
  id: 'prism_grenade_fan', name: 'LEQUE DE CÁPSULAS', mode: 2, tier: 2, kind: 'fan',
  ammoCost: 3, ammoRequired: 3, shots: 3, interval: 0, damageScale: 1,
  spreadDegrees: 0, pierce: false, forceScale: 1, impulseScale: 1.4,
  seconds: 0, rateScale: 1, fanDegrees: 16,
  blastRadiusScale: 1, blastDamageScale: 1, incendiary: false,
  chargeSeconds: 0, markRadius: 0, groundFire: false,
  hint: 'Q II · LEQUE DE 3 CÁPSULAS',
});

const GRENADE_III = plan({
  id: 'prism_grenade_incendiary', name: 'SALVA INCENDIÁRIA', mode: 2, tier: 3, kind: 'fan',
  // Cinco cápsulas: o carregador inteiro da forma, e ainda abaixo do teto de cápsulas vivas.
  ammoCost: 5, ammoRequired: 5, shots: 5, interval: .04, damageScale: 1.2,
  spreadDegrees: 0, pierce: false, forceScale: 1.2, impulseScale: 1.8,
  seconds: 0, rateScale: 1, fanDegrees: 26,
  blastRadiusScale: PRISM_SKILL_BLAST_CAP, blastDamageScale: 1.5, incendiary: true,
  chargeSeconds: 0, markRadius: 0, groundFire: true,
  hint: 'Q III · SALVA INCENDIÁRIA · 5 CÁPSULAS',
});

export const PRISM_SKILLS: Readonly<Record<PrismMode, Readonly<Record<PrismSkillTier, PrismSkillPlan>>>> = {
  0: {2: ASSAULT_II, 3: ASSAULT_III},
  1: {2: SNIPER_II, 3: SNIPER_III},
  2: {2: GRENADE_II, 3: GRENADE_III},
};

/** A habilidade de uma (forma, nível). Total: as seis, sem buraco. */
export function prismSkill(mode: PrismMode, tier: PrismSkillTier): PrismSkillPlan {
  return PRISM_SKILLS[mode][tier];
}

/** Todas as seis, na ordem forma → nível. Serve ao documento, ao HUD e ao teste de cobertura. */
export function allPrismSkills(): readonly PrismSkillPlan[] {
  return ([0, 1, 2] as const).flatMap(mode => ([2, 3] as const).map(tier => prismSkill(mode, tier)));
}

/**
 * Os ângulos de um leque, em graus, do mais à esquerda ao mais à direita.
 *
 * Um tiro só sai reto (nunca deslocado para a borda); dois ou mais dividem a abertura TOTAL em
 * partes iguais. Pura e exportada porque é o que dá ao leque a simetria que o jogador enxerga.
 */
export function fanAngles(count: number, totalDegrees: number): number[] {
  const shots = Math.max(0, Math.floor(count));
  if (shots <= 0) return [];
  if (shots === 1) return [0];
  const half = totalDegrees / 2;
  return Array.from({length: shots}, (_, i) => -half + totalDegrees * (i / (shots - 1)));
}

/**
 * Dano base de uma emissão, já com a escala da habilidade.
 *
 * Sai do dano da FORMA (`PRISM_MODES`), então balancear a arma balanceia a habilidade junto — que é
 * o contrário de uma tabela paralela que envelhece sozinha.
 */
export function prismSkillDamage(plan: PrismSkillPlan): number {
  return PRISM_MODES[plan.mode].damage * plan.damageScale;
}

/** Raio da explosão de uma cápsula de habilidade, já limitado pelo teto. */
export function prismSkillBlastRadius(plan: PrismSkillPlan): number {
  return PRISM_GRENADE.blastRadius * Math.min(PRISM_SKILL_BLAST_CAP, plan.blastRadiusScale);
}

/** Um candidato a alvo marcado. `id` é o do ator; a distância é medida por quem chama. */
export interface StrikeCandidate { readonly id: number; readonly distance: number }

/**
 * Os alvos da CHUVA DE MÍSSEIS: os `count` mais próximos dentro de `radius`.
 *
 * Puro e determinístico de propósito — dois hostis à mesma distância desempatam pelo `id`, que é
 * estável, e não pela ordem em que o chamador varreu a lista. Sem isso a mesma cena marcaria alvos
 * diferentes conforme a horda reciclasse os atores, e a habilidade ficaria impossível de testar.
 *
 * Devolve MENOS que `count` quando não há hostis suficientes no raio; quem chama decide o que fazer
 * com os mísseis que sobraram (hoje: caem à frente da mira).
 */
export function markStrikeTargets(candidates: readonly StrikeCandidate[], count: number, radius: number): number[] {
  if (!(count > 0) || !(radius > 0)) return [];
  return candidates
    .filter(candidate => candidate.distance <= radius)
    .slice()
    .sort((a, b) => a.distance - b.distance || a.id - b.id)
    .slice(0, count)
    .map(candidate => candidate.id);
}

/**
 * O relógio de uma habilidade em curso.
 *
 * Puro e sem alocação: guarda só o plano, quanto tempo passou e quantas emissões já saíram. Quem
 * traduz uma emissão em tiro, cápsula ou dano é `PrismWeapon` — aqui só se decide QUANDO.
 *
 * `overdrive` não emite: ele fica ativo pela duração e o disparo normal é que muda de
 * comportamento enquanto ele durar.
 */
export class PrismSkillRunner {
  private current: PrismSkillPlan | undefined;
  private clock = 0;
  private emitted = 0;
  /** Habilidade em curso (inclui a janela da sobrecarga). */
  get plan(): PrismSkillPlan | undefined { return this.current; }
  get active(): boolean { return this.current !== undefined; }
  /** `true` só enquanto ainda há emissões por sair — é o que trava o gatilho comum. */
  get emitting(): boolean { return this.current !== undefined && this.current.kind !== 'overdrive'; }
  /** A janela de sobrecarga, quando é ela que está no ar. */
  get overdrive(): PrismSkillPlan | undefined {
    return this.current?.kind === 'overdrive' ? this.current : undefined;
  }
  /** Segundos restantes da janela; `0` fora dela. Serve ao HUD. */
  get remaining(): number {
    const plan = this.current;
    return plan?.kind === 'overdrive' ? Math.max(0, plan.seconds - this.clock) : 0;
  }
  /** Emissões já saídas nesta habilidade. */
  get shots(): number { return this.emitted; }
  /**
   * `true` enquanto a habilidade ainda está CARREGANDO — nada saiu do cano.
   *
   * O HUD e o rig leem isto para mostrar a energia subindo (feixe) ou os marcadores acendendo
   * (mísseis). Uma habilidade sem `chargeSeconds` nunca passa por aqui.
   */
  get charging(): boolean {
    const plan = this.current;
    return plan !== undefined && plan.chargeSeconds > 0 && this.clock < plan.chargeSeconds;
  }
  /** Fração 0..1 da carga já cumprida; `1` quando não há carga ou ela terminou. */
  get chargeProgress(): number {
    const plan = this.current;
    if (!plan || plan.chargeSeconds <= 0) return 1;
    return Math.min(1, this.clock / plan.chargeSeconds);
  }
  /** Nome na tela da habilidade no ar; `''` quando não há nenhuma. */
  get label(): string { return this.current?.name ?? ''; }

  start(plan: PrismSkillPlan): void { this.current = plan; this.clock = 0; this.emitted = 0; }

  /**
   * Um passo. `emit` é chamado uma vez por emissão devida, em ordem, e pode ser chamado mais de uma
   * vez no mesmo passo — é assim que um leque de intervalo zero sai inteiro no mesmo quadro.
   */
  update(dt: number, emit: (plan: PrismSkillPlan, index: number) => void): void {
    const plan = this.current;
    if (!plan) return;
    this.clock += Math.max(0, dt);
    if (plan.kind === 'overdrive') {
      if (this.clock >= plan.seconds) this.cancel();
      return;
    }
    // A carga desloca TODA a régua de emissão: a emissão `i` vence em `chargeSeconds + i·interval`.
    // Sem o deslocamento, um feixe de carga longa cuspiria os doze tiques no primeiro passo e a
    // carga viraria enfeite — o jogador veria a energia subir depois de o dano já ter saído.
    while (this.emitted < plan.shots && this.clock >= plan.chargeSeconds + this.emitted * plan.interval) {
      emit(plan, this.emitted);
      this.emitted++;
    }
    if (this.emitted >= plan.shots) this.cancel();
  }

  cancel(): void { this.current = undefined; this.clock = 0; this.emitted = 0; }
}

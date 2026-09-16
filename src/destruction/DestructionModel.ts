import type {DestructibleKind, DestructibleRecord} from './DestructibleTypes';

/**
 * Vida, estágios e regra de quebra por tipo. Puro: sem Babylon, sem cena, sem tempo real.
 *
 * Toda a "diversão" mensurável está aqui — quantos tiros até a caixa abrir, quando a rachadura
 * aparece, quantas partes do celeiro caem no caminho. É o único lugar onde esses números existem, e
 * por isso é o único lugar que o teste precisa ler para dizer que o balanceamento mudou.
 *
 * Referência de escala: a pistola faz `PISTOL_TUNING.damage = 12` por tiro, cadência 3,3/s por mão.
 */

/** Como o corpo se desfaz quando a vida acaba. */
export type BreakStyle =
  /** Estilhaça a própria geometria em cacos que caem radialmente. Caixa, barril, pedra. */
  | 'shatter'
  /** Tomba pela raiz e só então some. Árvore. */
  | 'topple'
  /** Perde componentes ao longo do dano e desaba no fim. Estrutura. */
  | 'components';

/** Família sonora e de partículas. Casa com os grupos já existentes no `foley-manifest.json`. */
export type ImpactMaterial = 'wood' | 'stone' | 'foliage';

export interface KindProfile {
  /** Vida total. */
  readonly health: number;
  /** Quantos estágios de dano VISÍVEL antes da quebra (rachaduras acumuladas). */
  readonly stages: number;
  readonly style: BreakStyle;
  readonly material: ImpactMaterial;
  /** Cacos gerados na quebra (teto por corpo; o pool global ainda manda). */
  readonly fragments: number;
  /** Vida do caco em segundos. */
  readonly fragmentLife: number;
  /** Velocidade de saída do caco, m/s. */
  readonly fragmentSpeed: number;
  /** Segundos de tombamento antes de sumir. Só faz sentido em `topple`. */
  readonly toppleSeconds: number;
  /** Dano transferido a vizinhos na quebra (barril). Zero desliga a corrente. */
  readonly chainDamage: number;
  /** Alcance da corrente, em metros. */
  readonly chainRadius: number;
  /** Segundos entre o fim do tombamento/queda e o sumiço definitivo. */
  readonly linger: number;
}

/**
 * Números por tipo.
 *
 * Caixa e barril abrem em 3–4 tiros: são o alvo de oportunidade, precisam responder no mesmo
 * segundo em que o jogador decide atirar. Pedra e árvore custam ~10–13 tiros, o suficiente para o
 * acúmulo de marcas ser lido como progresso e não como ruído. Estrutura custa 35 tiros e paga o
 * caminho com componentes caindo — sem isso seriam cinco segundos atirando numa parede que não
 * responde, que é o oposto de diversão.
 */
export const DESTRUCTIBLE_PROFILES: Readonly<Record<DestructibleKind, KindProfile>> = {
  crate:     {health: 36,  stages: 2, style: 'shatter',    material: 'wood',    fragments: 7,  fragmentLife: 4.5, fragmentSpeed: 4.2, toppleSeconds: 0,   chainDamage: 0,  chainRadius: 0,   linger: 0},
  // `chainDamage` do barril é calibrado para MATAR um vizinho colado: a 1,4 m o alcance de 3,2 m
  // deixa passar 56% do valor, e 90 × 0,56 ≈ 50 supera os 48 de vida. Menos que isso e a corrente
  // vira um susto que não derruba nada — que é pior que não ter corrente.
  barrel:    {health: 48,  stages: 2, style: 'shatter',    material: 'wood',    fragments: 9,  fragmentLife: 4.5, fragmentSpeed: 5.0, toppleSeconds: 0,   chainDamage: 90, chainRadius: 3.2, linger: 0},
  rock:      {health: 120, stages: 3, style: 'shatter',    material: 'stone',   fragments: 8,  fragmentLife: 6.0, fragmentSpeed: 3.4, toppleSeconds: 0,   chainDamage: 0,  chainRadius: 0,   linger: 0},
  tree:      {health: 150, stages: 3, style: 'topple',     material: 'foliage', fragments: 4,  fragmentLife: 3.5, fragmentSpeed: 2.6, toppleSeconds: 1.25, chainDamage: 0, chainRadius: 0,   linger: 1.6},
  structure: {health: 420, stages: 4, style: 'components', material: 'stone',   fragments: 10, fragmentLife: 5.5, fragmentSpeed: 3.8, toppleSeconds: 0,   chainDamage: 0,  chainRadius: 0,   linger: 0},
};

export const profileOf = (kind: DestructibleKind): KindProfile => DESTRUCTIBLE_PROFILES[kind];

/** O que aconteceu num golpe. Tudo que o visual, o som e a colisão precisam saber sai daqui. */
export interface DamageReport {
  readonly id: string;
  readonly kind: DestructibleKind;
  /** Dano de fato absorvido (zero se já estava quebrado). */
  readonly absorbed: number;
  readonly health: number;
  /** Vida restante normalizada, 1 = intacto. */
  readonly fraction: number;
  /** Estágio de dano visível, 0..`profile.stages`. */
  readonly stage: number;
  readonly stageChanged: boolean;
  /** Quebrou NESTE golpe — dispara estilhaço/tombamento uma única vez. */
  readonly broke: boolean;
  /** Já estava quebrado antes do golpe: nada acontece, nem som. */
  readonly alreadyBroken: boolean;
  /** Índices dos componentes que caíram NESTE golpe, em ordem. */
  readonly felled: readonly number[];
}

/**
 * Estado de um destrutível. Um por registro do manifesto.
 *
 * Idempotência é regra: dano em corpo já quebrado devolve `alreadyBroken` e não move nada. Sem isso,
 * um leque de 21 raios do especial acertando a mesma caixa dispararia 21 estilhaços e estouraria o
 * pool de cacos sozinho.
 */
export class DestructibleState {
  readonly profile: KindProfile;
  health: number;
  stage = 0;
  broken = false;
  /** Quantos componentes já caíram. Cresce só em `structure`. */
  felled = 0;
  /** Segundos desde a quebra; o visual usa para tombar e sumir. */
  since = 0;

  constructor(readonly record: DestructibleRecord) {
    this.profile = profileOf(record.kind);
    this.health = this.profile.health;
  }

  get id(): string {return this.record.id;}
  get kind(): DestructibleKind {return this.record.kind;}
  get fraction(): number {return Math.max(0, this.health) / this.profile.health;}
  /** Quantos componentes ainda de pé. */
  get standing(): number {return Math.max(0, this.record.components.length - this.felled);}

  /**
   * Aplica dano e devolve o relatório.
   *
   * Os componentes caem em marcos iguais do dano: com C componentes, o i-ésimo cai quando o dano
   * passa de `(i+1)/(C+1)`. O último marco fica reservado para a quebra, então nunca acontece de a
   * estrutura ficar de pé sem nenhuma peça — nem de todas caírem antes de ela desabar.
   */
  damage(amount: number): DamageReport {
    if (this.broken || !(amount > 0)) {
      return {
        id: this.id, kind: this.kind, absorbed: 0, health: this.health, fraction: this.fraction,
        stage: this.stage, stageChanged: false, broke: false, alreadyBroken: this.broken, felled: [],
      };
    }
    const absorbed = Math.min(amount, this.health);
    this.health -= absorbed;
    const progress = 1 - this.fraction;

    const previousStage = this.stage;
    this.stage = this.health <= 0
      ? this.profile.stages
      : Math.min(this.profile.stages, Math.floor(progress * (this.profile.stages + 1)));

    const felled: number[] = [];
    const count = this.record.components.length;
    if (count > 0) {
      const target = this.health <= 0 ? count : Math.min(count, Math.floor(progress * (count + 1)));
      for (let i = this.felled; i < target; i++) felled.push(i);
      this.felled = Math.max(this.felled, target);
    }

    const broke = this.health <= 0;
    if (broke) {this.broken = true; this.since = 0;}
    return {
      id: this.id, kind: this.kind, absorbed, health: Math.max(0, this.health), fraction: this.fraction,
      stage: this.stage, stageChanged: this.stage !== previousStage, broke, alreadyBroken: false, felled,
    };
  }

  /** Volta ao estado intacto. Usado na reinicialização da tentativa. */
  reset(): void {
    this.health = this.profile.health;
    this.stage = 0;
    this.broken = false;
    this.felled = 0;
    this.since = 0;
  }
}

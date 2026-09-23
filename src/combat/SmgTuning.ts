/**
 * Números da SUBMETRALHADORA DE SEDA — a arma do MARIJUANO.
 *
 * Ficam num arquivo só, longe da mecânica, pelo mesmo motivo que `PISTOL_TUNING` e `PRISM_MODES`
 * existem: balancear não pode exigir ler o backend.
 *
 * A identidade dela é **volume**: cadência alta, dano por bud baixo, carregador grande e recarga
 * longa. Ela não perfura, não explode e não tem luneta — quem quer precisão joga de Soldado. O que
 * ela compra é presença contínua de fogo, e é por isso que as três habilidades do `Q` são todas
 * variações do MESMO disparo (ver `MARIJUANO_SKILLS`): nenhuma inventa física nova.
 *
 * Os tempos saem do pacote autoral (`DOCUMENTACAO/LEIA-ME_ANIMACOES.txt` do pacote da arma):
 * `Fire` dura 0,43 s e `Reload` dura 2,63 s. A recarga daqui é casada com o clipe — o carregador
 * enche quando a animação termina, não no meio dela.
 */

export interface SmgTuning {
  /** Id estável; entra em `sourceId` do dano e nos testes. */
  readonly id: string;
  /** Nome legível, para o HUD. */
  readonly name: string;
  /** Disparos por segundo, antes de `attackSpeed`. */
  readonly rate: number;
  /** Dano BASE por bud. O receptor aplica `stats.damage`, crítico e ponto fraco. */
  readonly damage: number;
  /** Abertura do tiro, em graus. Alta de propósito: é uma submetralhadora, não um rifle. */
  readonly spreadDegrees: number;
  /** Abertura com o botão direito preso. Mirar APERTA o leque; nunca o zera. */
  readonly aimedSpreadDegrees: number;
  /** Alcance útil do bud, em metros. Curto: a arma é de perto. */
  readonly range: number;
  /** Buds por carregador. */
  readonly capacity: number;
  /** Segundos de recarga — casados com o clipe `Reload` do GLB. */
  readonly reloadSeconds: number;
  /** Tranco da câmera por disparo. */
  readonly impulse: number;
  /** Empurrão aplicado ao corpo atingido. */
  readonly force: number;
  /**
   * Velocidade do bud desenhado, em m/s. Só apresentação: o dano é instantâneo.
   *
   * Deliberadamente LENTA para uma bala. O pedido é que a arma atire cannabis e que isso se VEJA:
   * a 140 m/s (velocidade de projétil de verdade) o bud cruzava dez metros em sete centésimos de
   * segundo e ninguém enxergava nada. A 70 m/s ele é um risco verde legível e ainda chega antes de
   * o jogador soltar o gatilho.
   */
  readonly budSpeed: number;
  /**
   * Engorda do bud desenhado.
   *
   * O modelo autoral tem ~7 cm (já exagerado pelo pacote). Em terceira pessoa, a 15 m, 7 cm é
   * meio pixel. Isto é escala de LEITURA, não de mundo — o bud não colide com nada.
   */
  readonly budScale: number;
}

export const MARIJUANO_SMG: SmgTuning = {
  id: 'silk_smg',
  name: 'SUBMETRALHADORA DE SEDA',
  rate: 11,
  damage: 5.5,
  spreadDegrees: 3.2,
  aimedSpreadDegrees: 1.6,
  range: 120,
  capacity: 45,
  reloadSeconds: 2.63,
  impulse: .006,
  force: 1.6,
  budSpeed: 70,
  budScale: 3.2,
};

/** Nível do `Q`, como nas outras classes: I, II e III. */
export type SmgSkillTier = 1 | 2 | 3;

/**
 * Uma habilidade do Marijuano.
 *
 * As três são o MESMO hitscan do tiro comum com outros números — nenhuma cria projétil novo, área
 * nova ou caminho de dano novo. `emissions` é quantos tiros a habilidade cospe por conta própria;
 * `seconds` é a janela em que ela REESCREVE o disparo normal. Uma habilidade tem um ou outro,
 * nunca os dois: ou ela atira, ou ela muda como o gatilho atira.
 */
export interface SmgSkillPlan {
  readonly tier: SmgSkillTier;
  /** Id estável; entra em `attackId` do dano. */
  readonly id: string;
  /** Nome na tela. */
  readonly name: string;
  /** Linha do painel de arma. */
  readonly hint: string;
  /** Buds retirados do carregador na SOLTURA do `Q`. `0` na sobrecarga, que cobra em tempo real. */
  readonly ammoCost: number;
  /** Buds que precisam estar carregados para a habilidade sair. */
  readonly ammoRequired: number;
  /** Emissões próprias. `0` quando a habilidade só reescreve o disparo normal. */
  readonly emissions: number;
  /** Intervalo entre emissões, em segundos. */
  readonly interval: number;
  /** Janela de sobrecarga, em segundos. `0` quando a habilidade não tem janela. */
  readonly seconds: number;
  /** Multiplicador de dano sobre o bud comum. */
  readonly damageScale: number;
  /** Multiplicador de cadência DENTRO da janela. `1` fora de uma sobrecarga. */
  readonly rateScale: number;
  /** Abertura das emissões (ou da janela), em graus. */
  readonly spreadDegrees: number;
  /** Abertura do LEQUE entre emissões, em graus. `0` manda tudo na mira. */
  readonly fanDegrees: number;
}

/**
 * As três habilidades, do nível I ao III.
 *
 * O desenho é uma escada de VOLUME, que é a identidade da arma:
 *
 *   I   — um pente curto e certeiro, barato, para abrir uma janela de dano;
 *   II  — um leque largo que cobre um corredor inteiro de bichos;
 *   III — a janela em que a arma inteira vira outra coisa por seis segundos.
 *
 * A sobrecarga não cobra munição ao abrir: ela cobra em tempo real, queimando o carregador — e a
 * recarga continua permitida dentro da janela, senão a arma morreria no meio do ultimate. É a
 * mesma regra da SOBRECARGA DE DISPARO do Soldado, de propósito: duas classes, uma convenção.
 */
export const MARIJUANO_SKILLS: Readonly<Record<SmgSkillTier, SmgSkillPlan>> = {
  1: {
    tier: 1, id: 'silk_burst', name: 'RAJADA DE SEDA',
    hint: 'Q I · RAJADA DE SEDA',
    ammoCost: 10, ammoRequired: 10,
    emissions: 10, interval: .05, seconds: 0,
    damageScale: 1.8, rateScale: 1, spreadDegrees: 0, fanDegrees: 0,
  },
  2: {
    tier: 2, id: 'silk_spray', name: 'CHUVA DE BUDS',
    hint: 'Q II · CHUVA DE BUDS',
    ammoCost: 18, ammoRequired: 18,
    emissions: 18, interval: .035, seconds: 0,
    damageScale: 1.4, rateScale: 1, spreadDegrees: 0, fanDegrees: 24,
  },
  3: {
    tier: 3, id: 'silk_overdrive', name: 'BAFO DO CANHAMO',
    hint: 'Q III · BAFO DO CANHAMO',
    // Não cobra na soltura: a janela come o carregador enquanto dura. O mínimo exigido impede
    // abrir a sobrecarga com a arma praticamente vazia e desperdiçar 100 de MP.
    ammoCost: 0, ammoRequired: 12,
    emissions: 0, interval: 0, seconds: 6,
    damageScale: 1.5, rateScale: 2.2, spreadDegrees: 0, fanDegrees: 0,
  },
};

/** Etiquetas do dano de habilidade: `skill` desliga o MP por acerto e escala por `stats.mp`. */
export const SMG_SKILL_TAGS: readonly string[] = ['bullet', 'skill'];

/** Etiquetas do bud comum: `bullet` dá direito a ponto fraco e a MP por acerto. */
export const SMG_SHOT_TAGS: readonly string[] = ['bullet'];

export function marijuanoSkill(tier: SmgSkillTier): SmgSkillPlan {return MARIJUANO_SKILLS[tier];}

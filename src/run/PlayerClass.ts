/**
 * A CLASSE do exterminador — escolhida no menu, antes de entrar em campo.
 *
 * Regra pura, fora do DOM e fora da cena, porque ela decide coisas que o resto do jogo consulta o
 * tempo todo: qual arma nasce nas mãos, o que o `Q` faz e o que o painel promete. Duas classes:
 *
 *   Pistoleiro → pistolas duplas, com as três habilidades autorais de sempre (leque, barragem e
 *                tempestade), com voz, coreografia e clipe próprios;
 *   Soldado    → PRISM triforme, com `Q` nível I transformando a arma e os níveis II e III sendo
 *                habilidades PRÓPRIAS DE CADA FORMA (ver `src/combat/PrismSkills.ts`).
 *
 * **Não existe troca de arma dentro de uma tentativa.** A escolha é feita no menu e vale a
 * expedição inteira — estágio após estágio e também depois de um RENASCER. Voltar ao menu (e só
 * isso) libera a escolha de novo. É por isso que a persistência mora aqui e não na cena: a cena
 * sobrevive aos estágios e às repetições, e o menu é o único lugar em que a decisão pode mudar.
 */

export type PlayerClassId = 'gunslinger' | 'soldier';

/** Pedido explícito: quem não escolhe nada entra de Pistoleiro. */
export const DEFAULT_PLAYER_CLASS: PlayerClassId = 'gunslinger';

export interface PlayerClassDefinition {
  readonly id: PlayerClassId;
  /** Nome na tela, em português. */
  readonly name: string;
  /** Linha curta de identidade, no cartão de seleção. */
  readonly role: string;
  /** A arma que nasce nas mãos. Nunca muda durante a tentativa. */
  readonly weapon: 'pistols' | 'prism';
  /** Parágrafo do cartão: o que muda em JOGO ao escolher esta classe. */
  readonly summary: string;
  /** O que o `Q` faz, por nível. Índice 0 = nível I. */
  readonly charge: readonly [string, string, string];
  /** `true` quando o nível I do `Q` não cobra MP (o soldado transforma de graça). */
  readonly freeFirstTier: boolean;
}

export const PLAYER_CLASSES: Readonly<Record<PlayerClassId, PlayerClassDefinition>> = {
  gunslinger: {
    id: 'gunslinger',
    name: 'PISTOLEIRO',
    role: 'Pistolas duplas · cadência e mobilidade',
    weapon: 'pistols',
    summary: 'Pistolas duplas com leque '
      + 'ricocheteante, barragem com mortal e tempestade da colheita. Mira leve '
      + 'e combate desarmado no V.',
    charge: ['LEQUE RICOCHETEANTE', 'BARRAGEM COM MORTAL', 'TEMPESTADE DA COLHEITA'],
    freeFirstTier: false,
  },
  soldier: {
    id: 'soldier',
    name: 'SOLDADO',
    role: 'PRISM triforme · poder e versatilidade',
    weapon: 'prism',
    summary: 'A PRISM transformável: assalto, lança de íons e lança-granadas, cada forma com '
      + 'carregador próprio. O Q nível I transforma a arma de graça; os níveis II e III são '
      + 'habilidades DIFERENTES em cada forma, com munição e MP próprios.',
    charge: ['TRANSFORMAR · GRÁTIS', 'HABILIDADE II DA FORMA', 'HABILIDADE III DA FORMA'],
    freeFirstTier: true,
  },
};

/** Ordem de apresentação no menu. O padrão vem primeiro. */
export const PLAYER_CLASS_ORDER: readonly PlayerClassId[] = ['gunslinger', 'soldier'];

export function isPlayerClass(value: unknown): value is PlayerClassId {
  return value === 'gunslinger' || value === 'soldier';
}

/** Qualquer entrada suja (armazenamento corrompido, URL inventada) cai no padrão. */
export function normalizePlayerClass(value: unknown): PlayerClassId {
  return isPlayerClass(value) ? value : DEFAULT_PLAYER_CLASS;
}

/** Chave do armazenamento local. Prefixada para não colidir com nada mais da página. */
export const PLAYER_CLASS_KEY = 'risk-of-watermelon:player-class';

/** O mínimo de `localStorage` que a escolha precisa. O teste injeta um mapa de memória. */
export interface PlayerClassStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `?class=soldier` na URL, quando houver. Serve ao QA e a links de revisão. */
export function playerClassFromHref(href: string | undefined): PlayerClassId | undefined {
  if (!href) return undefined;
  try {
    const value = new URL(href).searchParams.get('class');
    return isPlayerClass(value) ? value : undefined;
  } catch { return undefined; }
}

/** `localStorage` real quando existir. Navegador em modo privado devolve `undefined` sem estourar. */
export function defaultPlayerClassStore(): PlayerClassStore | undefined {
  try {
    const storage = (globalThis as {localStorage?: PlayerClassStore}).localStorage;
    return storage ?? undefined;
  } catch { return undefined; }
}

/**
 * A escolha viva.
 *
 * `choose` grava na hora: um recarregamento de página no meio de uma sessão de teste não pode
 * devolver o jogador à classe errada. A URL, quando traz `?class=`, MANDA na leitura inicial (e é
 * gravada), porque um link de revisão tem de abrir a classe que ele promete.
 */
export class PlayerClassChoice {
  private value: PlayerClassId;
  private readonly store: PlayerClassStore | undefined;
  constructor(store: PlayerClassStore | undefined = defaultPlayerClassStore(), href?: string) {
    this.store = store;
    const fromHref = playerClassFromHref(href);
    if (fromHref) { this.value = fromHref; this.persist(); return; }
    let saved: string | null = null;
    try { saved = store?.getItem(PLAYER_CLASS_KEY) ?? null; } catch { saved = null; }
    this.value = normalizePlayerClass(saved);
  }
  get id(): PlayerClassId { return this.value; }
  get definition(): PlayerClassDefinition { return PLAYER_CLASSES[this.value]; }
  /** `true` quando a escolha realmente mudou — é o sinal que a cena usa para reequipar. */
  choose(id: PlayerClassId): boolean {
    const wanted = normalizePlayerClass(id);
    if (wanted === this.value) return false;
    this.value = wanted;
    this.persist();
    return true;
  }
  private persist(): void {
    try { this.store?.setItem(PLAYER_CLASS_KEY, this.value); } catch { /* modo privado */ }
  }
}

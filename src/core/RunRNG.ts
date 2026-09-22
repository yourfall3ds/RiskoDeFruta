/**
 * UM DOMÍNIO POR TIPO DE DECISÃO — nunca uma sacola de `random()` (contrato §6).
 *
 * Cada stream é semeado pelo hash do PRÓPRIO nome (`streamSeed`), então os fluxos são
 * independentes por construção: acrescentar uma rolagem de spread não desloca o loot, e um proc
 * novo não muda qual elite o Director escolhe. Acrescentar um DOMÍNIO novo ao registro também não
 * move nenhum outro — a semente de cada um é função de `(semente da corrida, nome)` e de nada mais,
 * nem da ordem desta lista. É essa propriedade — e não um acordo entre chamadores — que
 * `tests/rng-domains` trava.
 *
 * ## O domínio que não existia, e o nome que servia a três
 *
 * Havia um fluxo chamado `spawn`, e ele atendia TRÊS decisões diferentes: onde o jogador nasce,
 * onde cada corpo da horda nasce e qual ilha do planeta é a casa. A independência por nome não
 * protege nada quando três domínios dividem o mesmo nome — e o estrago era concreto: cada
 * `addPlayer` puxava dois números do fluxo que a HORDA usava, então a mesma semente gerava uma
 * horda com um jogador, outra com dois e outra com quatro. A propriedade que permite reproduzir um
 * defeito a partir da semente simplesmente não valia no co-op.
 *
 * O nome genérico saiu do registro, e cada decisão ganhou o seu:
 *
 *     enemySpawn   ONDE um corpo da horda nasce        (o QUAL continua sendo do `director`)
 *     world        a disposição do mundo: a ilha-casa do planeta
 *     (nenhum)     onde o JOGADOR nasce — é dado do MAPA (`MapDefinition`), e não sorteio
 *
 * O nascimento do jogador não consome RNG de domínio algum. Se um dia a formação de largada tiver
 * de variar, isso é recurso explícito do mapa, e não efeito colateral de um gerador.
 *
 * ## Política de sequência
 *
 * Tirar `spawn` mudou a sequência de quem o usava — e isso é aceito, porque o que se corrigiu é uma
 * fronteira de domínio errada. O contrato é "mesma semente + mesmos eventos de um domínio = mesmo
 * resultado naquele domínio", e não "continuar produzindo os números de antes". O que continua
 * valendo é o outro lado: RENOMEAR por gosto um domínio que está certo é proibido, porque muda a
 * semente sem corrigir nada. É por isso que `elite` segue com o nome histórico — ele é o domínio da
 * VARIANTE de inimigo, e a fronteira dele está correta.
 *
 * Os três `combat*` são do SERVIDOR. Nenhum código de apresentação pode tirar daqui: efeito
 * cosmético que consome RNG autoritativo desloca a sequência de quem decide.
 */
export const RNG_STREAMS = [
  'run', 'stage', 'world', 'director', 'enemySpawn', 'loot', 'scene', 'boss', 'elite', 'interactable', 'procs',
  'combatCrit', 'combatProc', 'combatSpread',
] as const;
export type RNGStream = typeof RNG_STREAMS[number];

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

export class RandomStream {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new Error('Invalid RNG range');
    return min + (max - min) * this.next();
  }
  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new Error('Cannot pick from empty content');
    return values[Math.floor(this.next() * values.length)]!;
  }
}

/**
 * A semente de um domínio: função de `(semente da corrida, nome)` e de NADA mais.
 *
 * Exportada para que a propriedade possa ser afirmada de fora. Se a derivação fosse por ordem —
 * um gerador-mestre entregando `next()` a cada domínio na sequência do registro —, inserir um nome
 * no meio da lista deslocaria todos os seguintes, e um fluxo cosmético novo mudaria o loot.
 */
export function streamSeed(runSeed: string, name: string): number {
  return hash(`${runSeed}:${name}`);
}

export class RunRNG {
  private readonly streams = new Map<RNGStream, RandomStream>();
  constructor(readonly seed: string) {
    for (const name of RNG_STREAMS) this.streams.set(name, new RandomStream(streamSeed(seed, name)));
  }
  /**
   * O fluxo de um domínio — e um nome desconhecido é ERRO, não `undefined`.
   *
   * Isto era `this.streams.get(name)!`. O `!` calava o compilador, e quando um nome fora do
   * registro chegava por um caminho que o tipo não cobre — o vitest não checa tipo; um script em
   * JavaScript também não —, a função devolvia `undefined` em silêncio. O defeito só estourava
   * três chamadas adiante, dentro de quem tentou sortear com ele, e derrubou dez testes de horda de
   * uma vez sem que nenhum apontasse para cá. Recusar aqui põe o nome errado na primeira linha do erro.
   */
  stream(name: RNGStream): RandomStream {
    const stream = this.streams.get(name);
    if (!stream) throw new Error(`RunRNG: domínio "${String(name)}" não está registrado em RNG_STREAMS`);
    return stream;
  }
}

export function createSeed(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(2)), value => value.toString(16).padStart(8, '0')).join('');
}

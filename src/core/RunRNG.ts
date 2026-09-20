/**
 * UM DOMÍNIO POR TIPO DE DECISÃO — nunca uma sacola de `random()` (contrato §6).
 *
 * Cada stream é semeado pelo hash do PRÓPRIO nome (ver o construtor abaixo), então os fluxos são
 * independentes por construção: acrescentar uma rolagem de spread não desloca o loot, e um proc
 * novo não muda qual elite o Director escolhe. É essa propriedade — e não um acordo entre
 * chamadores — que os testes de isolamento travam.
 *
 * `elite` é o domínio da VARIANTE de inimigo sob o nome histórico dele; renomear agora mudaria a
 * semente da fazenda de um jogador, e single-player não pode mudar um bit.
 *
 * Os três `combat*` são do SERVIDOR. Nenhum código de apresentação pode tirar daqui: efeito
 * cosmético que consome RNG autoritativo desloca a sequência de quem decide.
 */
export const RNG_STREAMS = [
  'run', 'stage', 'director', 'loot', 'scene', 'spawn', 'boss', 'elite', 'interactable', 'procs',
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

export class RunRNG {
  private readonly streams = new Map<RNGStream, RandomStream>();
  constructor(readonly seed: string) {
    for (const name of RNG_STREAMS) this.streams.set(name, new RandomStream(hash(`${seed}:${name}`)));
  }
  stream(name: RNGStream): RandomStream { return this.streams.get(name)!; }
}

export function createSeed(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(2)), value => value.toString(16).padStart(8, '0')).join('');
}

/**
 * O LOG DO JOGO — um lugar só, com níveis e com contadores.
 *
 * ## O problema
 *
 * O multijogador tinha exatamente duas linhas de diagnóstico (`console.log` na entrada e na saída da
 * `FarmRoom`) e nenhuma no cliente. Quando alguém dizia "entrei e não vi ninguém", não havia como
 * saber se a sala era outra, se o `welcome` chegou, se a compra foi recusada ou se um evento de
 * combate chegou duas vezes. Espalhar `console.log` resolveria o dia e criaria o problema seguinte:
 * ruído por quadro, impossível de desligar e impossível de filtrar.
 *
 * ## O que este módulo é
 *
 * Um agregador com quatro níveis (`erro`, `aviso`, `info`, `debug`) e um interruptor (`silencio`),
 * mais CONTADORES: o que acontece por tique não vira linha, vira número somado e publicado a cada N
 * segundos. Essa é a diferença entre telemetria e enchente.
 *
 * O módulo é puro no sentido que importa: ele não lê ambiente nem URL. Quem configura é a borda —
 * `server/index.ts` pelo ambiente, `src/main.ts` pela URL — e é isso que permite testar os níveis
 * sem tocar em `process.env` nem em `location`.
 *
 * ## Onde o tempo entra
 *
 * `flush(now)` recebe o instante em vez de ligar um `setInterval`. Um temporizador dentro de um
 * módulo de log seria um recurso vivo em cada teste que o importa, e a publicação passaria a
 * depender do relógio real. Quem já tem um laço de passo fixo (a sala, a cena) chama `flush` nele.
 */

export type LogLevel = 'erro' | 'aviso' | 'info' | 'debug';
/** O limiar também pode DESLIGAR tudo: é o que a variável de ambiente e o `?debug=0` pedem. */
export type LogThreshold = LogLevel | 'silencio';

export const LOG_LEVELS: readonly LogLevel[] = ['erro', 'aviso', 'info', 'debug'];

const RANK: Record<LogThreshold, number> = { silencio: 0, erro: 1, aviso: 2, info: 3, debug: 4 };

export interface LogLine {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>> | undefined;
}

export type LogSink = (line: LogLine) => void;

/** Intervalo padrão entre publicações de contadores. Dez segundos: legível sem virar enchente. */
export const COUNTER_INTERVAL_MS = 10_000;

/**
 * O texto que veio do ambiente ou da URL, virado limiar.
 *
 * Aceita os nomes dos níveis, e também `1`/`0`/`on`/`off`/`sim`/`nao`, porque é isso que alguém
 * escreve numa variável de ambiente sem consultar documentação. Texto que não diz nada devolve o
 * padrão em vez de desligar por engano — perder telemetria por um erro de digitação é o pior dos
 * dois resultados.
 */
export function parseLogLevel(text: string | undefined | null, fallback: LogThreshold): LogThreshold {
  const clean = String(text ?? '').trim().toLowerCase();
  if (!clean) return fallback;
  if (clean === 'silencio' || clean === 'silêncio' || clean === 'off' || clean === '0' || clean === 'nao' || clean === 'não' || clean === 'false') return 'silencio';
  if (clean === '1' || clean === 'on' || clean === 'sim' || clean === 'true') return 'debug';
  if ((LOG_LEVELS as readonly string[]).includes(clean)) return clean as LogLevel;
  // Sinônimos em inglês, porque é o que sai de um `LOG_LEVEL` copiado de outro projeto.
  if (clean === 'error') return 'erro';
  if (clean === 'warn' || clean === 'warning') return 'aviso';
  return fallback;
}

/**
 * O limiar pedido pela URL — `?log=debug`, ou o atalho `?debug=1`.
 *
 * Função de texto, sem tocar em `location`: é o que deixa a regra sob teste. O padrão do cliente é
 * `aviso`, e não `info`: um jogador com o console aberto não tem por que ler a narração da sala. O
 * atalho `?debug=1` (o mesmo que abre o diagnóstico) sobe tudo de uma vez.
 */
export function logLevelFromLocation(href: string, fallback: LogThreshold = 'aviso'): LogThreshold {
  let params: URLSearchParams;
  try { params = new URL(href).searchParams; } catch { return fallback; }
  const explicit = params.get('log');
  if (explicit !== null) return parseLogLevel(explicit, fallback);
  const debug = params.get('debug');
  if (debug !== null) return parseLogLevel(debug || '1', fallback);
  return fallback;
}

/** O destino padrão: o console, com a severidade certa para o filtro do navegador funcionar. */
export function consoleSink(line: LogLine): void {
  const text = `[${line.scope}] ${line.message}`;
  const data = line.data;
  // `console.error`/`warn` e não `log` para os dois primeiros: é o que faz o filtro do DevTools e o
  // `2>` do terminal separarem o que é problema do que é narração.
  if (line.level === 'erro') { if (data) console.error(text, data); else console.error(text); return; }
  if (line.level === 'aviso') { if (data) console.warn(text, data); else console.warn(text); return; }
  if (data) console.log(text, data); else console.log(text);
}

/**
 * O agregador. Um por processo (`log`), mas instanciável para o teste não herdar estado do vizinho.
 */
export class LogHub {
  threshold: LogThreshold = 'info';
  sink: LogSink = consoleSink;
  private readonly counters = new Map<string, number>();
  private lastFlush = 0;

  /** `true` se uma linha deste nível seria escrita agora. Quem monta `data` caro consulta antes. */
  enabled(level: LogLevel): boolean { return RANK[this.threshold] >= RANK[level]; }

  emit(level: LogLevel, scope: string, message: string, data?: Readonly<Record<string, unknown>>): void {
    if (!this.enabled(level)) return;
    // Um destino que lança (console indisponível num worker, sink de teste com defeito) não pode
    // derrubar o jogo: telemetria é observação, nunca caminho crítico.
    try { this.sink(data === undefined ? { level, scope, message } : { level, scope, message, data }); } catch { /* o jogo continua */ }
  }

  /** Um evento por tique não vira linha: vira número. */
  count(name: string, amount = 1): void {
    if (this.threshold === 'silencio') return;
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  /** Os contadores como estão agora, sem zerar. É o que o painel de diagnóstico (F1) lê. */
  counterSnapshot(): Record<string, number> {
    return Object.fromEntries([...this.counters].sort(([a], [b]) => a.localeCompare(b)));
  }

  /**
   * Publica os contadores se já passou o intervalo, e zera. Devolve `true` quando publicou.
   *
   * A primeira chamada apenas ARMA o relógio: sem isso, o primeiro `flush` de um processo recém-
   * subido publicaria um punhado de zeros por comparar com o instante 0.
   */
  flush(now: number, intervalMs = COUNTER_INTERVAL_MS, scope = 'telemetria'): boolean {
    if (!this.lastFlush) { this.lastFlush = now; return false; }
    if (now - this.lastFlush < intervalMs) return false;
    this.lastFlush = now;
    if (!this.counters.size) return false;
    const data = this.counterSnapshot();
    this.counters.clear();
    this.emit('info', scope, `contadores dos últimos ${Math.round((intervalMs) / 1000)} s`, data);
    return true;
  }

  /** Zera tudo — contadores e relógio. Existe para o teste, não para o jogo. */
  reset(): void { this.counters.clear(); this.lastFlush = 0; }

  child(scope: string): Logger { return new Logger(scope, this); }
}

/** Um escopo nomeado. É o que o resto do código guarda; ninguém fala com o `LogHub` direto. */
export class Logger {
  constructor(readonly scope: string, private readonly hub: LogHub) {}
  erro(message: string, data?: Readonly<Record<string, unknown>>): void { this.hub.emit('erro', this.scope, message, data); }
  aviso(message: string, data?: Readonly<Record<string, unknown>>): void { this.hub.emit('aviso', this.scope, message, data); }
  info(message: string, data?: Readonly<Record<string, unknown>>): void { this.hub.emit('info', this.scope, message, data); }
  debug(message: string, data?: Readonly<Record<string, unknown>>): void { this.hub.emit('debug', this.scope, message, data); }
  /** Agregado: some ao contador em vez de escrever uma linha. Para o que acontece por tique. */
  conta(name: string, amount = 1): void { this.hub.count(`${this.scope}.${name}`, amount); }
  enabled(level: LogLevel): boolean { return this.hub.enabled(level); }
}

/** O agregador do processo. */
export const log = new LogHub();

export function configureLog(options: { level?: LogThreshold; sink?: LogSink }): void {
  if (options.level) log.threshold = options.level;
  if (options.sink) log.sink = options.sink;
}

export function logger(scope: string): Logger { return log.child(scope); }

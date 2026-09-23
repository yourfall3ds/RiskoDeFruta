/**
 * UM QUADRO RUIM NÃO PODE CONGELAR O JOGO PARA SEMPRE.
 *
 * ## O defeito que isto fecha
 *
 * O laço do Babylon é `_processFrame(); _queueNewFrameForRenderLoop()`, sem `try`. Uma exceção que
 * escapa de UM quadro pula o reagendamento, e nenhum quadro é pedido de novo: a tela fica parada no
 * último desenho, a entrada não responde, e o jogador vê um jogo travado sem aviso nenhum. Foi o que
 * o Test Map V1.0 mostrou — o boneco preso de cabeça para baixo na pose de mergulho, ENTER sem
 * efeito, e no console um único `TypeError` perdido entre cinquenta mil linhas.
 *
 * ## A regra
 *
 * O quadro que lança é ABANDONADO, e o próximo roda. A falha é registrada alto: a primeira vez de
 * cada erro distinto sai com a pilha inteira; as repetições do mesmo erro viram um resumo a cada
 * `summaryMs`, para que um erro por quadro não vire a enchente que esconde a causa. É o mesmo
 * princípio aplicado no servidor (`unhandledRejection`/`uncaughtException` registram e seguem).
 *
 * Não é varrer para baixo do tapete: a falha continua visível, contada e com pilha. O que muda é que
 * ela deixa de ser fatal.
 */
export interface FrameFailure {
  /** Nome e mensagem: é o que distingue um erro de outro. */
  readonly signature: string;
  readonly message: string;
  readonly stack: string;
  /** Quantas vezes ESTE erro aconteceu desde que o guarda nasceu. */
  readonly count: number;
}

export interface FrameGuardReport {
  /** Primeira ocorrência de um erro distinto: sai inteira, com pilha. */
  first(failure: FrameFailure, error: unknown): void;
  /** Repetições do mesmo erro desde o último resumo. */
  repeated(failure: FrameFailure, since: number): void;
}

export class FrameGuard {
  private readonly failures = new Map<string, {failure: FrameFailure; pending: number}>();
  private lastSummary = 0;
  /** Quadros abandonados desde o nascimento do guarda. */
  total = 0;

  constructor(
    private readonly report: FrameGuardReport,
    private readonly now: () => number = () => performance.now(),
    private readonly summaryMs = 5000,
  ) {}

  /** Roda o quadro. Devolve `false` quando ele lançou e foi abandonado. */
  run(frame: () => void): boolean {
    try {
      frame();
      this.summarize();
      return true;
    } catch (error) {
      this.total++;
      this.record(error);
      this.summarize();
      return false;
    }
  }

  /** O que já falhou, para o painel de diagnóstico. */
  snapshot(): {total: number; failures: FrameFailure[]} {
    return {total: this.total, failures: [...this.failures.values()].map(entry => entry.failure)};
  }

  private record(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : typeof error;
    const signature = `${name}: ${message}`;
    const stack = error instanceof Error && error.stack ? error.stack : signature;
    const known = this.failures.get(signature);
    if (!known) {
      const failure = {signature, message, stack, count: 1};
      this.failures.set(signature, {failure, pending: 0});
      this.report.first(failure, error);
      return;
    }
    known.failure = {...known.failure, count: known.failure.count + 1};
    known.pending++;
  }

  /** Publica as repetições acumuladas, no máximo uma vez por intervalo. */
  private summarize(): void {
    const now = this.now();
    if (now - this.lastSummary < this.summaryMs) return;
    this.lastSummary = now;
    for (const entry of this.failures.values()) {
      if (!entry.pending) continue;
      this.report.repeated(entry.failure, entry.pending);
      entry.pending = 0;
    }
  }
}

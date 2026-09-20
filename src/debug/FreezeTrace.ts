/**
 * Migalhas para caçar CONGELAMENTO — não é perfil de desempenho.
 *
 * Um travamento que nunca destrava não aparece em `PerformanceObserver` nem em perfil gravado: o
 * navegador só entrega a medição quando a tarefa TERMINA, e aqui ela pode não terminar. O que
 * sobrevive ao congelamento é o que já foi IMPRESSO. Por isso cada seção imprime ao ENTRAR: a
 * última linha visível no console nomeia exatamente onde a linha de execução parou.
 *
 * Ligado só por `?qaFreeze=1`. Sem o parâmetro, `mark` e `section` não fazem nada e `section`
 * chama a função direto, sem `try/finally` e sem leitura de relógio — custo zero na sessão normal.
 */

const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('qaFreeze');

/** `true` quando o rastro está ligado; use para evitar montar texto caro à toa. */
export const freezeTraceEnabled = enabled;

/** Uma migalha. Imprime na hora — é esse o ponto. */
export function mark(stage: string): void {
  if (!enabled) return;
  console.info('[freeze]', Math.round(performance.now()), stage);
}

/**
 * Envolve uma seção suspeita: imprime ao entrar, mede, e acusa quando passa do orçamento.
 *
 * `budgetMs` é o que cabe num quadro de 60 Hz com folga para o resto (16,7 ms no total).
 * Devolve o valor da função sem alterá-lo, e não engole exceção — o `finally` só mede.
 */
export function section<T>(name: string, run: () => T, budgetMs = 8): T {
  if (!enabled) return run();
  const started = performance.now();
  console.info('[freeze] →', name);
  try {
    return run();
  } finally {
    const elapsed = performance.now() - started;
    if (elapsed >= budgetMs) console.warn('[freeze] LENTO', name, elapsed.toFixed(1) + ' ms');
    console.info('[freeze] ←', name, elapsed.toFixed(1) + ' ms');
  }
}

/**
 * Publica um gancho de QA em `window.__qa`, só com `?qaFreeze=1`.
 *
 * Existe para REPRODUZIR o relato sem jogar a expedição inteira até a Praga Alfa: do console dá
 * para invocar o chefe e matá-lo no mesmo instante. Nada aqui é lido pelo jogo — é uma porta de
 * diagnóstico de mão única.
 */
export function exposeQA(name: string, value: unknown): void {
  if (!enabled || typeof window === 'undefined') return;
  const bag = ((window as unknown as Record<string, unknown>)['__qa'] ??= {}) as Record<string, unknown>;
  bag[name] = value;
}

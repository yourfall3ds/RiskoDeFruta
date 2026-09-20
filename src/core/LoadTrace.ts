/**
 * O RASTRO DA CARGA — quem começou, quem terminou, quem nunca termina.
 *
 * ## O problema que este módulo existe para resolver
 *
 * O carregamento parava em "PREPARANDO LUZ E MATERIAIS" com a barra em 99% e ficava lá. Havia dois
 * defeitos somados, e os dois precisavam de nome:
 *
 * 1. **O número mentia.** O progresso vinha de uma contagem de bandeiras booleanas de peso igual —
 *    um GLB de 25 s valia o mesmo que uma esfera de 40 ms — e a última operação real (esperar a
 *    cena poder desenhar) não estava representada em etapa nenhuma. Com todas as bandeiras
 *    verdadeiras o alvo era 1, e o mostrador perseguia 1 por interpolação exponencial: `floor()`
 *    disso é 99 para sempre.
 * 2. **Ninguém sabia o que estava pendurado.** As cargas eram promessas soltas (`void x.load()`);
 *    uma que nunca resolvesse não produzia erro nenhum, porque ninguém a esperava.
 *
 * ## O modelo
 *
 * Toda operação de carga é uma TAREFA com nome, peso, instante de início, instante de fim, duração
 * e ESTADO — `PENDING` (registrada, ainda não começou), `RUNNING`, `DONE`, `FAILED` ou `TIMEOUT`.
 * O progresso é a razão entre peso concluído e peso total conhecido, e por isso 100% quer dizer
 * exatamente uma coisa: NÃO EXISTE MAIS DEPENDÊNCIA BLOQUEANTE.
 *
 * O peso é a duração TÍPICA em segundos, medida, não chutada. Não precisa ser exato — precisa ser
 * da ordem certa, para que a barra não pule de 20% a 90% e depois fique parada meio minuto.
 *
 * ## O cão de guarda
 *
 * Um prazo por tarefa. Ele não interrompe, não engole e não estende nada: ele IMPRIME quem está
 * pendente e quem já fechou (`[LOAD HANG]`). Fica em `debug` — `?debug=1` abre. O que sobe a
 * `aviso` é a FALHA de uma tarefa, porque um asset que morre em silêncio foi metade do problema.
 */

import {logger} from './Log';

const loadLog = logger('load');

/** Prazo padrão do cão de guarda. Diagnóstico, nunca tolerância. */
export const WATCHDOG_MS = 12_000;

export type TaskState = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'TIMEOUT';

export interface TaskRecord {
  readonly name: string;
  /** Duração típica em segundos. É o que dá peso ao progresso. */
  readonly weight: number;
  state: TaskState;
  start: number | undefined;
  end: number | undefined;
  duration: number | undefined;
  error: string | undefined;
}

const tasks = new Map<string, TaskRecord>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let traceStart = 0;

/** Detalhe extra que o relatório imprime junto das pendências (estado da cena, por exemplo). */
export type PendingDetail = () => string;
let detail: PendingDetail | undefined;
export function describePending(fn: PendingDetail | undefined): void { detail = fn; }

function now(): number { return typeof performance === 'undefined' ? Date.now() : performance.now(); }

/**
 * Anuncia uma tarefa ANTES de ela começar.
 *
 * Isto é o que impede o progresso de mentir: o denominador é conhecido desde o primeiro quadro, em
 * vez de crescer conforme o trabalho é descoberto. Uma barra que chega a 95% e então descobre mais
 * trabalho é a barra que fica em 99%.
 */
export function registerTask(name: string, weight: number): void {
  if (tasks.has(name)) return;
  tasks.set(name, {name, weight: Math.max(.01, weight), state: 'PENDING', start: undefined, end: undefined, duration: undefined, error: undefined});
}

export function taskState(name: string): TaskState | undefined { return tasks.get(name)?.state; }

/** A linha do tempo inteira, na ordem em que as tarefas foram anunciadas. */
export function timeline(): readonly TaskRecord[] { return [...tasks.values()]; }

/** Tarefas que ainda podem bloquear: anunciadas ou correndo. */
export function pendingTasks(): TaskRecord[] {
  return [...tasks.values()].filter(t => t.state === 'PENDING' || t.state === 'RUNNING' || t.state === 'TIMEOUT');
}

/**
 * O progresso real, em unidades de peso.
 *
 * `FAILED` conta como concluída: uma carga que falhou já não bloqueia nada, e fingir que ela ainda
 * está em curso prenderia a barra para sempre pelo motivo errado. `TIMEOUT` NÃO conta — a tarefa
 * continua correndo, o prazo só disse que ela demorou.
 */
export function loadProgress(): {done: number; total: number; ratio: number} {
  let done = 0, total = 0;
  for (const task of tasks.values()) {
    total += task.weight;
    if (task.state === 'DONE' || task.state === 'FAILED') done += task.weight;
  }
  return {done, total, ratio: total > 0 ? done / total : 0};
}

/** O bloco `[LOAD HANG]`: o que ainda segura o portão, e o que já passou, com duração. */
export function hangReport(): string {
  const elapsed = traceStart ? Math.round(now() - traceStart) : 0;
  const pending = pendingTasks().map(t => t.state === 'RUNNING' || t.state === 'TIMEOUT'
    ? `${t.name}(${t.state.toLowerCase()} ${Math.round(now() - (t.start ?? traceStart))}ms)` : `${t.name}(pending)`);
  const completed = [...tasks.values()].filter(t => t.state === 'DONE' || t.state === 'FAILED')
    .map(t => `${t.name} ${t.duration ?? 0}ms${t.state === 'FAILED' ? ' FALHOU' : ''}`);
  return `[LOAD HANG] elapsed=${elapsed}ms\npending:  ${pending.length ? pending.join(', ') : 'nenhuma'}`
    + `\ncompleted: ${completed.length ? completed.join(', ') : 'nenhuma'}`
    + (detail ? `\nscene: ${detail()}` : '');
}

/** Zera o rastro. Uma cena nova não herda as pendências da cena anterior. */
export function resetLoadTrace(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear(); tasks.clear(); detail = undefined; traceStart = now();
}

export function beginTask(name: string, weight = 1, watchdogMs = WATCHDOG_MS): void {
  registerTask(name, weight);
  const task = tasks.get(name)!;
  if (task.state !== 'PENDING') return;
  if (!traceStart) traceStart = now();
  task.state = 'RUNNING'; task.start = now();
  const timer = setTimeout(() => {
    timers.delete(name);
    // O estado vira TIMEOUT, mas a tarefa CONTINUA: o prazo é observação, não desistência.
    if (task.state === 'RUNNING') task.state = 'TIMEOUT';
    loadLog.debug(hangReport());
  }, watchdogMs);
  (timer as unknown as {unref?: () => void}).unref?.();
  timers.set(name, timer);
  loadLog.debug(`${name}.start`);
}

export function endTask(name: string, ok = true, error?: unknown): void {
  const task = tasks.get(name);
  if (!task || task.state === 'DONE' || task.state === 'FAILED') return;
  const timer = timers.get(name);
  if (timer) { clearTimeout(timer); timers.delete(name); }
  task.end = now();
  task.duration = Math.round(task.end - (task.start ?? task.end));
  task.state = ok ? 'DONE' : 'FAILED';
  if (ok) loadLog.debug(`${name}.done ${task.duration}ms`);
  else {
    task.error = error instanceof Error ? error.message : String(error ?? 'sem motivo');
    // Erro nunca vira promessa eterna: ele FECHA a tarefa e aparece no rastro, em `aviso`.
    loadLog.aviso(`${name}.fail ${task.duration}ms`, {motivo: task.error});
  }
}

/**
 * Envolve uma promessa sem alterá-la: devolve a MESMA promessa, com o mesmo desfecho.
 *
 * A rejeição é repassada de propósito. Engolir aqui transformaria uma falha de asset numa tarefa
 * que nunca fecha — exatamente o defeito que este módulo existe para tornar visível.
 */
export function track<T>(name: string, work: Promise<T>, weight = 1, watchdogMs = WATCHDOG_MS): Promise<T> {
  beginTask(name, weight, watchdogMs);
  return work.then(
    value => {endTask(name, true); return value;},
    error => {endTask(name, false, error); throw error;},
  );
}

/** Progresso de lote: `[load] [texturas] 18/23`. */
export function trackBatch(name: string, done: number, total: number): void {
  loadLog.debug(`[${name}] ${done}/${total}`);
}

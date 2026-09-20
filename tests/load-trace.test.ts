import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {
  resetLoadTrace, registerTask, beginTask, endTask, track,
  loadProgress, pendingTasks, timeline, hangReport, taskState, describePending,
} from '../src/core/LoadTrace';
import {log} from '../src/core/Log';

/**
 * O CONTRATO DO RASTRO DE CARGA.
 *
 * O travamento em 99% tinha duas metades, e as duas são defeitos de CONTABILIDADE, não de arte:
 * o denominador do progresso crescia enquanto a barra andava, e uma carga que nunca fechava não
 * produzia sinal nenhum. Estes testes prendem as duas metades: o progresso é derivado de tarefas
 * declaradas ANTES do trabalho começar e pesadas pelo custo real, e toda tarefa termina em um
 * estado observável — inclusive quando falha.
 */
describe('rastro de carga', () => {
  beforeEach(() => { resetLoadTrace(); log.threshold = 'silencio'; });
  afterEach(() => { resetLoadTrace(); log.threshold = 'info'; });

  it('anuncia o denominador inteiro antes de qualquer trabalho começar', () => {
    registerTask('mapa', 25); registerTask('horda', 25); registerTask('nave', 2);
    // Nada começou, então nada está concluído — mas o total JÁ é o total final.
    expect(loadProgress()).toMatchObject({done: 0, total: 52});
    expect(timeline().map(t => t.state)).toEqual(['PENDING', 'PENDING', 'PENDING']);
  });

  it('pesa cada tarefa pelo custo real, e não uma por uma', () => {
    registerTask('mapa', 25); registerTask('nave', 2);
    beginTask('mapa', 25); beginTask('nave', 2);
    endTask('nave');
    // Contagem por bandeira diria 50%. A nave custa 2 s de 27: a verdade é ~7%.
    const {ratio} = loadProgress();
    expect(ratio).toBeCloseTo(2 / 27, 5);
    expect(ratio).toBeLessThan(.5);
  });

  it('só chega a 100% quando não sobra dependência bloqueante', () => {
    registerTask('mapa', 25); registerTask('prontidao-da-cena', 5);
    beginTask('mapa', 25); endTask('mapa');
    // A prontidão da cena é trabalho REAL e ainda não terminou: a barra não pode fechar.
    expect(loadProgress().ratio).toBeLessThan(1);
    expect(pendingTasks().map(t => t.name)).toEqual(['prontidao-da-cena']);
    beginTask('prontidao-da-cena', 5); endTask('prontidao-da-cena');
    expect(loadProgress().ratio).toBe(1);
    expect(pendingTasks()).toHaveLength(0);
  });

  it('uma falha FECHA a tarefa em vez de deixá-la pendurada para sempre', async () => {
    const boom = new Error('GLB não encontrado');
    await expect(track('modelo', Promise.reject(boom), 3)).rejects.toThrow('GLB não encontrado');
    // O erro é repassado (quem chamou decide), mas a tarefa não bloqueia mais nada.
    expect(taskState('modelo')).toBe('FAILED');
    expect(pendingTasks()).toHaveLength(0);
    expect(loadProgress().ratio).toBe(1);
    expect(timeline()[0]?.error).toBe('GLB não encontrado');
  });

  it('devolve a mesma promessa, com o mesmo valor', async () => {
    await expect(track('ok', Promise.resolve(42), 1)).resolves.toBe(42);
    expect(taskState('ok')).toBe('DONE');
    expect(timeline()[0]?.duration).toBeGreaterThanOrEqual(0);
  });

  it('o cão de guarda descreve as pendências e NÃO desiste da tarefa', () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      log.threshold = 'debug'; log.sink = line => { lines.push(line.message); };
      describePending(() => 'waiting=1');
      registerTask('prontidao-da-cena', 5);
      beginTask('mapa', 25, 1000);
      endTask('mapa');
      beginTask('horda', 25, 1000);
      vi.advanceTimersByTime(1100);
      const relatorio = lines.find(l => l.startsWith('[LOAD HANG]'));
      expect(relatorio).toBeDefined();
      // O que segura E o que já passou, com duração — é isso que faltava no console.
      expect(relatorio).toContain('horda');
      expect(relatorio).toContain('prontidao-da-cena');
      expect(relatorio).toContain('completed:');
      expect(relatorio).toContain('mapa');
      expect(relatorio).toContain('waiting=1');
      // Prazo vencido não é desistência: a tarefa continua e ainda pode fechar.
      expect(taskState('horda')).toBe('TIMEOUT');
      endTask('horda');
      expect(taskState('horda')).toBe('DONE');
    } finally { vi.useRealTimers(); log.sink = () => {}; }
  });

  it('o relatório de travamento separa pendentes de concluídas', () => {
    registerTask('mapa', 25); registerTask('horda', 25);
    beginTask('mapa', 25); endTask('mapa');
    beginTask('horda', 25);
    const texto = hangReport();
    expect(texto).toMatch(/pending:\s+horda\(running/);
    expect(texto).toMatch(/completed:\s+mapa \d+ms/);
  });

  it('uma cena nova não herda as pendências da anterior', () => {
    registerTask('mapa-do-planeta', 25); beginTask('mapa-do-planeta', 25);
    expect(pendingTasks()).toHaveLength(1);
    // É o que acontece na troca planeta→fazenda: o rastro recomeça com a cena.
    resetLoadTrace();
    expect(pendingTasks()).toHaveLength(0);
    expect(loadProgress()).toMatchObject({done: 0, total: 0});
  });

  it('fechar duas vezes não conta duas vezes', () => {
    registerTask('mapa', 25); beginTask('mapa', 25);
    endTask('mapa'); endTask('mapa', false, new Error('tarde demais'));
    expect(taskState('mapa')).toBe('DONE');
    expect(loadProgress().done).toBe(25);
  });
});

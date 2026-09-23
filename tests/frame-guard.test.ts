import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { FrameGuard, type FrameFailure } from '../src/core/FrameGuard';

/**
 * UM QUADRO RUIM NÃO PODE CONGELAR O JOGO.
 *
 * Medido no Test Map V1.0: um `TypeError` num único quadro, e o jogo parou no último desenho —
 * boneco preso na pose de mergulho, ENTER sem efeito, nenhum aviso. O primeiro caso documenta o
 * motor (sem guarda, o próximo quadro nunca é pedido); os outros afirmam o que o guarda promete:
 * o quadro ruim é abandonado, o laço segue, e a falha continua visível — com pilha na primeira vez,
 * em resumo nas repetições.
 */
function relatorio() {
  const primeiras: FrameFailure[] = [];
  const repeticoes: {assinatura: string; vezes: number}[] = [];
  return {
    primeiras, repeticoes,
    report: {
      first: (f: FrameFailure) => { primeiras.push(f); },
      repeated: (f: FrameFailure, vezes: number) => { repeticoes.push({assinatura: f.signature, vezes}); },
    },
  };
}
const ruim = (): void => { throw new TypeError("Cannot read properties of undefined (reading 'entries')"); };

describe('o laço de desenho', () => {
  /**
   * Se um dia o Babylon passar a reagendar mesmo depois de uma exceção, a primeira afirmação
   * quebra — e aí o guarda pode ser revisto. Até lá, ele é o que separa um erro de um congelamento.
   */
  it('no Babylon, um quadro que lança não pede o próximo; com o guarda, pede', () => {
    const engine = new NullEngine();
    const motor = engine as unknown as {_queueNewFrame: () => number; _renderLoop: (t?: number) => void};
    let pedidos = 0;
    motor._queueNewFrame = () => ++pedidos;

    engine.runRenderLoop(ruim);
    const antes = pedidos;
    expect(() => motor._renderLoop()).toThrow(TypeError);
    expect(pedidos, 'sem guarda nenhum quadro novo é pedido: o jogo congela').toBe(antes);
    engine.stopRenderLoop();

    const guarda = new FrameGuard(relatorio().report, () => 0);
    engine.runRenderLoop(() => { guarda.run(ruim); });
    const depois = pedidos;
    expect(() => motor._renderLoop()).not.toThrow();
    expect(pedidos, 'com guarda o próximo quadro é pedido').toBe(depois + 1);
    engine.stopRenderLoop();
    engine.dispose();
  });

  it('abandona só o quadro que lança; o seguinte roda normalmente', () => {
    const guarda = new FrameGuard(relatorio().report, () => 0);
    let rodou = 0;
    expect(guarda.run(ruim)).toBe(false);
    expect(guarda.run(() => { rodou++; })).toBe(true);
    expect(rodou).toBe(1);
    expect(guarda.total).toBe(1);
  });

  it('a primeira vez de cada erro sai com a pilha; as repetições viram um resumo por intervalo', () => {
    const {primeiras, repeticoes, report} = relatorio();
    let agora = 0;
    const guarda = new FrameGuard(report, () => agora, 5000);

    // Dez quadros seguidos com o mesmo erro: uma linha com pilha, nenhuma enchente.
    for (let i = 0; i < 10; i++) { agora += 16; guarda.run(ruim); }
    expect(primeiras).toHaveLength(1);
    expect(primeiras[0]!.signature).toBe("TypeError: Cannot read properties of undefined (reading 'entries')");
    expect(primeiras[0]!.stack.split('\n').length, 'a pilha inteira, não só a mensagem').toBeGreaterThan(1);
    expect(repeticoes).toHaveLength(0);

    // Passado o intervalo, as nove repetições saem numa linha só.
    agora += 5000; guarda.run(() => {});
    expect(repeticoes).toEqual([{assinatura: primeiras[0]!.signature, vezes: 9}]);

    // Sem erro novo, nada mais é publicado.
    agora += 5000; guarda.run(() => {});
    expect(repeticoes).toHaveLength(1);

    // Um erro DIFERENTE ganha a própria linha com pilha, mesmo em meio às repetições do primeiro.
    guarda.run(() => { throw new RangeError('outro defeito'); });
    expect(primeiras.map(f => f.signature)).toEqual([primeiras[0]!.signature, 'RangeError: outro defeito']);
    expect(guarda.snapshot()).toMatchObject({total: 11, failures: [{count: 10}, {count: 1}]});
  });

  it('registra também o que é lançado sem ser Error', () => {
    const {primeiras, report} = relatorio();
    const guarda = new FrameGuard(report, () => 0);
    expect(guarda.run(() => { throw 'texto solto'; })).toBe(false);
    expect(primeiras[0]!.signature).toBe('string: texto solto');
  });
});

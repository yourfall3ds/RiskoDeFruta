import { describe, it, expect, afterEach } from 'vitest';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { NetDebugLabels, enemyDebugLabel, playerDebugLabel, type DebugLabel } from '../src/debug/NetDebugLabels';
import { copyMetrics, deltaMetrics, installCountingDom, uninstallCountingDom, type FakeElement } from './support/counting-dom';

/**
 * AS ETIQUETAS DE DEBUG DO CO-OP — Fase 1 do Test Map.
 *
 * São elas que permitem pôr dois computadores lado a lado e dizer, sem console, se os dois veem a
 * mesma coisa: o mesmo P2 no mesmo lugar, com a mesma vida. O texto sai do estado replicado; a
 * posição, da projeção da câmera real do Babylon.
 */

const WIDTH = 1280, HEIGHT = 720;

/** Câmera com a matemática real do Babylon, de (0; 1,6; -12) olhando para +z. Sem engine nem GPU. */
class FakeCamera {
  readonly position = new Vector3(0, 1.6, -12);
  readonly viewport = new Viewport(0, 0, 1, 1);
  private readonly transform = Matrix.Identity();
  private readonly engine = { getRenderWidth: (): number => WIDTH, getRenderHeight: (): number => HEIGHT };
  getTransformationMatrix(): Matrix {
    const view = Matrix.LookAtLH(this.position, this.position.add(new Vector3(0, 0, 1)), Vector3.Up());
    view.multiplyToRef(Matrix.PerspectiveFovLH(.8, WIDTH / HEIGHT, .1, 400), this.transform);
    return this.transform;
  }
  getEngine(): { getRenderWidth(): number; getRenderHeight(): number } { return this.engine; }
}
const camera = (): Camera => new FakeCamera() as unknown as Camera;

describe('o texto das etiquetas', () => {
  it('jogador: número, nome, ping e vida, e a própria diz VOCÊ', () => {
    expect(playerDebugLabel({ entityId: 2, name: 'BENTO', ping: 38, hp: 129.2, maxHP: 130, self: false, connected: true }))
      .toBe('P2 · BENTO · 38 ms · 130/130');
    expect(playerDebugLabel({ entityId: 1, name: 'ANA', ping: 12, hp: 130, maxHP: 130, self: true, connected: true }))
      .toBe('P1 · ANA (VOCÊ) · 12 ms · 130/130');
  });

  /** Zero não é "ping perfeito": é "ainda não mediu". E quem caiu não tem ping — está voltando. */
  it('ping zero é "— ms", e quem caiu aparece RECONECTANDO', () => {
    expect(playerDebugLabel({ entityId: 3, name: 'CAIO', ping: 0, hp: 130, maxHP: 130, self: false, connected: true })).toBe('P3 · CAIO · — ms · 130/130');
    expect(playerDebugLabel({ entityId: 3, name: 'CAIO', ping: 40, hp: 90, maxHP: 130, self: false, connected: false })).toBe('P3 · CAIO · RECONECTANDO · 90/130');
  });

  it('inimigo: id e vida', () => {
    expect(enemyDebugLabel({ id: 201, hp: 479.4, maxHP: 500 })).toBe('#201 · 480/500');
  });
});

describe('a sobreposição', () => {
  afterEach(() => { uninstallCountingDom(); });

  const spans = (dom: { querySelectorAll(s: string): FakeElement[] }): FakeElement[] => dom.querySelectorAll('span');
  const left = (node: FakeElement): number => parseFloat(node.style.left);

  it('uma etiqueta por chave, sobre o ponto certo da tela, e some quem saiu', () => {
    const dom = installCountingDom();
    const labels = new NetDebugLabels(), cam = camera();
    const p1: DebugLabel = { key: 'ana', text: 'P1 · ANA (VOCÊ)', kind: 'self', x: -1.5, y: 2.2, z: 0 };
    const p2: DebugLabel = { key: 'bento', text: 'P2 · BENTO', kind: 'player', x: 1.5, y: 2.2, z: 0 };
    labels.update(cam, [p1, p2]);
    expect(spans(dom)).toHaveLength(2);
    // Lado a lado na tela como no mundo: P1 à esquerda do centro, P2 à direita, os dois visíveis.
    expect(left(spans(dom)[0]!)).toBeLessThan(50);
    expect(left(spans(dom)[1]!)).toBeGreaterThan(50);
    expect(spans(dom).map(s => s.hidden)).toEqual([false, false]);
    expect(spans(dom).map(s => s.className)).toEqual(['self', 'player']);

    // Atrás da câmera: escondida, não destruída — ela volta quando o corpo voltar à frente.
    labels.update(cam, [p1, { ...p2, z: -30 }]);
    expect(spans(dom)[1]!.hidden).toBe(true);

    // Quem saiu da sala perde a etiqueta.
    labels.update(cam, [p1]);
    expect(labels.size).toBe(1);
    expect(spans(dom).map(s => s.textContent)).toEqual(['P1 · ANA (VOCÊ)']);

    labels.dispose();
    expect(dom.querySelectorAll('.net-debug-labels')).toHaveLength(0);
  });

  /**
   * Na primeira prova com dois jogadores, a etiqueta do companheiro na lateral da tela saiu cortada
   * — e o corte comia a vida. Perto da borda ela passa a crescer para DENTRO da tela.
   */
  it('perto da borda a etiqueta se alinha pela borda; no meio, centrada', () => {
    const dom = installCountingDom();
    const labels = new NetDebugLabels(), cam = camera();
    labels.update(cam, [
      { key: 'esquerda', text: 'P1', kind: 'player', x: -6, y: 2.2, z: 0 },
      { key: 'meio', text: 'P2', kind: 'player', x: 0, y: 2.2, z: 0 },
      { key: 'direita', text: 'P3', kind: 'player', x: 6, y: 2.2, z: 0 },
    ]);
    expect(spans(dom).map(s => s.className)).toEqual(['player al-left', 'player', 'player al-right']);
    expect(spans(dom).every(s => !s.hidden)).toBe(true);
    labels.dispose();
  });

  /** Sessenta quadros por segundo com o mesmo texto não podem virar sessenta reescritas de texto. */
  it('quadro após quadro com o mesmo texto, nada de texto, classe ou nó é reescrito', () => {
    const dom = installCountingDom();
    const labels = new NetDebugLabels(), cam = camera();
    const p1: DebugLabel = { key: 'ana', text: 'P1 · ANA', kind: 'self', x: 0, y: 2.2, z: 0 };
    labels.update(cam, [p1]);
    const antes = copyMetrics(dom.metrics);
    for (let i = 0; i < 60; i++) labels.update(cam, [p1]);
    const d = deltaMetrics(antes, dom.metrics);
    expect({ texto: d.text, classe: d.className, criados: d.elementsCreated, inseridos: d.inserted, removidos: d.removed, hidden: d.hidden })
      .toEqual({ texto: 0, classe: 0, criados: 0, inseridos: 0, removidos: 0, hidden: 0 });
    labels.dispose();
  });
});

import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Camera } from '@babylonjs/core/Cameras/camera';

/**
 * AS ETIQUETAS DE DEBUG DO MULTIPLAYER (`?debug=1`).
 *
 * Sobre cada jogador: número, nome, ping e vida. Sobre cada inimigo: id e vida. É o que permite
 * olhar a tela de dois computadores lado a lado e dizer, sem abrir console nenhum, se os dois estão
 * vendo a MESMA coisa: o mesmo P2 no mesmo lugar, a mesma vida no mesmo corpo.
 *
 * Os números saem do estado replicado, não da simulação local. A vida mostrada aqui é a do
 * servidor — então, quando o HUD local diverge dela, a etiqueta mostra a verdade e a divergência
 * fica à vista em vez de escondida.
 */

export interface PlayerLabelData {
  entityId: number; name: string; ping: number; hp: number; maxHP: number; self: boolean; connected: boolean;
}

/** `P2 · BENTO · 38 ms · 130/130`. Ping zero é "ainda não mediu", não "ping perfeito". */
export function playerDebugLabel(p: PlayerLabelData): string {
  const ping = !p.connected ? 'RECONECTANDO' : p.ping > 0 ? `${p.ping} ms` : '— ms';
  return `P${p.entityId} · ${p.name}${p.self ? ' (VOCÊ)' : ''} · ${ping} · ${Math.ceil(p.hp)}/${Math.ceil(p.maxHP)}`;
}

/** `#201 · 500/500`. */
export function enemyDebugLabel(e: { id: number; hp: number; maxHP: number }): string {
  return `#${e.id} · ${Math.ceil(e.hp)}/${Math.ceil(e.maxHP)}`;
}

export interface DebugLabel {
  /** Identidade estável entre quadros: o nó do DOM é reaproveitado por ela. */
  key: string;
  text: string;
  kind: 'self' | 'player' | 'enemy';
  /** Ponto do mundo onde a etiqueta se apoia (acima da cabeça). */
  x: number; y: number; z: number;
}

export class NetDebugLabels {
  private readonly root = document.createElement('div');
  private readonly nodes = new Map<string, HTMLElement>();
  private readonly world = new Vector3();
  private readonly screen = new Vector3();

  constructor() {
    this.root.className = 'net-debug-labels';
    document.body.append(this.root);
  }

  /** Quantas etiquetas existem agora. Para o teste. */
  get size(): number { return this.nodes.size; }

  update(camera: Camera, labels: readonly DebugLabel[]): void {
    const engine = camera.getEngine(), width = engine.getRenderWidth(), height = engine.getRenderHeight();
    const viewport = camera.viewport.toGlobal(width, height), transform = camera.getTransformationMatrix();
    const seen = new Set<string>();
    for (const label of labels) {
      seen.add(label.key);
      let node = this.nodes.get(label.key);
      if (!node) {
        node = document.createElement('span');
        this.nodes.set(label.key, node);
        this.root.append(node);
      }
      if (node.textContent !== label.text) node.textContent = label.text;
      Vector3.ProjectToRef(this.world.set(label.x, label.y, label.z), Matrix.IdentityReadOnly, transform, viewport, this.screen);
      const p = this.screen;
      /**
       * Perto da borda a etiqueta se alinha PELA borda. Centrada, a do companheiro na lateral da tela
       * saía cortada — e o que o corte comia era a vida, o número que mais importa. Alinhada, ela
       * cresce para dentro da tela a partir da cabeça. Troca só ao cruzar um quarto da largura, então
       * a classe não é reescrita quadro a quadro.
       */
      const side = p.x < width * .25 ? ' al-left' : p.x > width * .75 ? ' al-right' : '';
      const className = label.kind + side;
      if (node.className !== className) node.className = className;
      const visible = p.z >= 0 && p.z <= 1 && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height;
      if (node.hidden === visible) node.hidden = !visible;
      if (visible) { node.style.left = `${(p.x / width) * 100}%`; node.style.top = `${(p.y / height) * 100}%`; }
    }
    for (const [key, node] of this.nodes) if (!seen.has(key)) { node.remove(); this.nodes.delete(key); }
  }

  dispose(): void { this.root.remove(); this.nodes.clear(); }
}

/**
 * Painel de verificação (F2) — só QA.
 *
 * Nada aqui aparece no jogo normal: o painel começa escondido, e enquanto estiver escondido não
 * há tecla, custo nem complexidade no caminho de jogo. Os controles existem para responder
 * perguntas objetivas sobre a travessia: dá a volta? o polo funciona? a queda recupera?
 */
export interface PlanetDebugActions {
  /** Alterna a vista de órbita que mostra o globo inteiro. */
  toggleOrbit(): boolean;
  /** Leva o corpo para a próxima ilha do grafo, com apoio validado. */
  teleportNextIsland(): string;
  /** Empurra o corpo para o vazio para conferir a recuperação. */
  verifyFall(): string;
  /** Corta a entrada pela nave: o corpo termina de pé no pouso. */
  skipIntro(): string;
  /**
   * Percorre os destrutíveis do manifesto, um por clique: põe o corpo em apoio válido a poucos
   * metros do prop e mira nele. NÃO causa dano — quem atira é o botão esquerdo, com a arma real.
   */
  inspectDestructible(kind?: string): string;
  /** Linha corrente de `up`/altitude/apoio. */
  readout(): string;
}

const STYLE_ID = 'planet-debug-style';
const CSS = `
#planet-debug{position:fixed;right:16px;top:16px;z-index:60;width:290px;padding:12px 14px;border-radius:10px;
  background:rgba(8,13,22,.92);color:#dfe9fb;font:500 12px/1.5 system-ui,sans-serif;display:grid;gap:8px;
  box-shadow:0 14px 40px rgba(0,0,0,.45)}
#planet-debug[hidden]{display:none}
#planet-debug h2{margin:0;font:700 12px/1 ui-monospace,monospace;letter-spacing:.14em;color:#ffcf7a}
#planet-debug pre{margin:0;padding:8px;border-radius:6px;background:rgba(255,255,255,.06);
  font:500 11px/1.5 ui-monospace,monospace;white-space:pre-line}
#planet-debug button{padding:7px 10px;border:0;border-radius:6px;cursor:pointer;background:#2c3f60;color:#e7f0ff;
  font:600 12px/1 system-ui,sans-serif;text-align:left}
#planet-debug button:hover{background:#3a527d}
#planet-debug small{color:#8ea2c2}
`;

export class PlanetDebugPanel {
  readonly element = document.createElement('section');
  private readonly readoutBox: HTMLElement;
  private readonly logBox: HTMLElement;
  private readonly keys: (event: KeyboardEvent) => void;
  private visible = false;
  private lastReadout = '';
  private disposed = false;

  constructor(private readonly actions: PlanetDebugActions) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID; style.textContent = CSS;
      document.head.append(style);
    }
    this.element.id = 'planet-debug';
    this.element.hidden = true;
    this.element.innerHTML = `
      <h2>VERIFICAÇÃO · QA</h2>
      <pre class="planet-debug-readout"></pre>
      <button type="button" data-action="orbit">Órbita: mostrar o globo inteiro</button>
      <button type="button" data-action="teleport">Teleportar para a próxima ilha</button>
      <button type="button" data-action="fall">Verificar queda e recuperação</button>
      <button type="button" data-action="skip-intro">Pular a entrada pela nave</button>
      <label>Tipo do objeto <select aria-label="Tipo do objeto"><option value="">Todos</option><option value="crate">Caixa</option><option value="barrel">Barril</option><option value="tree">Árvore</option><option value="rock">Rocha</option><option value="structure">Estrutura</option></select></label>
      <button type="button" data-action="inspect">Inspecionar objeto quebrável</button>
      <small class="planet-debug-log">F2 fecha este painel.</small>`;
    this.readoutBox = this.element.querySelector('.planet-debug-readout')!;
    this.logBox = this.element.querySelector('.planet-debug-log')!;
    this.element.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest('button')?.dataset.action;
      if (action === 'orbit') this.log(this.actions.toggleOrbit() ? 'Órbita ligada.' : 'Órbita desligada.');
      else if (action === 'teleport') this.log(this.actions.teleportNextIsland());
      else if (action === 'fall') this.log(this.actions.verifyFall());
      else if (action === 'skip-intro') this.log(this.actions.skipIntro());
      else if (action === 'inspect') this.log(this.actions.inspectDestructible(this.element.querySelector('select')!.value));
    });
    this.keys = event => {
      if (event.code !== 'F2') return;
      event.preventDefault();
      this.toggle();
    };
    window.addEventListener('keydown', this.keys);
    document.body.append(this.element);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.hidden = !this.visible;
  }

  /** Só escreve no DOM quando o painel está aberto E o texto mudou. */
  update(): void {
    if (this.disposed || !this.visible) return;
    const text = this.actions.readout();
    if (text === this.lastReadout) return;
    this.lastReadout = text;
    this.readoutBox.textContent = text;
  }

  private log(message: string): void {this.logBox.textContent = message;}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.keys);
    this.element.remove();
  }
}

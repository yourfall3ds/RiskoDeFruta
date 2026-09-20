export type { InputFrame } from './InputFrame';
export { EMPTY_INPUT } from './InputFrame';
import type { InputFrame } from './InputFrame';
import { DoubleTap } from './DoubleTap';

export class GameInput {
  private readonly held = new Set<string>();
  private readonly taps = new DoubleTap();
  private reload=false;
  private stance=false;
  private jump = false;
  private dodge = false;
  private interaction:number|undefined;
  private primary = false;
  private primaryPressed = false;
  /** Botão direito: MIRA APURADA. A carga do especial mudou para `Q` segurado. */
  private secondary = false;
  /** Entalhes de roda acumulados desde a última leitura; positivo aproxima. */
  private wheel = 0;
  yaw = 0;
  pitch = 0.02;
  sensitivity = 0.0022;
  private drag = false;
  cancelVersion=0;
  private readonly controller = new AbortController();
  constructor(private readonly canvas: HTMLCanvasElement, private readonly onActive: (active: boolean) => void) {
    const signal = this.controller.signal;
    window.addEventListener('keydown', e => {
      if(e.code==='Escape'&&this.active){this.clear();if(this.locked)document.exitPointerLock();else{canvas.blur();onActive(false);}return;}
      if (!this.active || e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      if (['Space','ShiftLeft','ShiftRight','KeyW','KeyA','KeyS','KeyD','KeyQ'].includes(e.code)) e.preventDefault();
      this.held.add(e.code);
      if (!e.repeat && e.code === 'Space') this.jump = true;
      if (!e.repeat && e.code.startsWith('Shift')) this.dodge = true;
      if(!e.repeat&&e.code==='KeyR')this.reload=true;
      if(!e.repeat&&e.code==='KeyE')this.interaction=0;
      if(!e.repeat&&e.code==='KeyV')this.stance=true;
      // `B` (trocar de arma) e `T` (próxima forma) SAÍRAM: a arma é a da classe escolhida no menu e
      // não muda dentro da expedição; a forma da PRISM avança pelo `Q` no nível I.
    }, { signal });
    window.addEventListener('keyup', e => this.held.delete(e.code), { signal });
    window.addEventListener('blur', () => this.clear(), { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); }, { signal });
    document.addEventListener('pointerlockchange', () => { this.clear(); onActive(this.locked); }, { signal });
    // Mouse events report every button; pointerdown only reports the first held button.
    // RMB aiming must not swallow the later LMB shot.
    canvas.addEventListener('mousedown', e => {
      canvas.focus(); this.drag = true; onActive(true);
      if (e.button === 0) {this.primary = true;this.primaryPressed=true;}
      if (e.button === 2) this.secondary = true;
    }, { signal });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.primary = false;
      if (e.button === 2) this.secondary = false;
      this.drag = this.primary || this.secondary;
    }, { signal });
    window.addEventListener('pointermove', e => {
      if (!this.locked && !this.drag) return;
      this.yaw += e.movementX * this.sensitivity;
      this.pitch = Math.max(-1.1, Math.min(1.1, this.pitch + e.movementY * this.sensitivity));
    }, { signal });
    // Roda do mouse: ajuste da luneta. Um entalhe por evento (o `deltaY` bruto varia de 3 a 120
    // conforme o dispositivo e o navegador); `deltaY<0` é rolar para cima, que APROXIMA.
    // Só é capturada com a janela ativa — fora dela a página continua rolando como sempre.
    canvas.addEventListener('wheel', e => {
      if (!this.active) return;
      e.preventDefault();
      if (e.deltaY) this.wheel += e.deltaY < 0 ? 1 : -1;
    }, { signal, passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault(), { signal });
  }
  get locked(): boolean { return document.pointerLockElement === this.canvas; }
  get active(): boolean { return this.locked || document.activeElement === this.canvas; }
  async capture(): Promise<void> {
    this.canvas.focus();
    try { await this.canvas.requestPointerLock(); } catch { this.onActive(true); }
  }
  read(): InputFrame {
    const x = Number(this.held.has('KeyD')) - Number(this.held.has('KeyA'));
    const z = Number(this.held.has('KeyW')) - Number(this.held.has('KeyS'));
    const frame: InputFrame = {
      x, z,
      // `Q` segurado carrega o especial; o botão direito agora é MIRA. A semântica de `charging`
      // (e o bit dela no pacote de rede) não mudou — só a tecla que a produz.
      reload:this.reload,stance:this.stance,jump: this.jump, dodge: this.dodge, fire: (this.primary||this.primaryPressed) && this.active, charging: this.held.has('KeyQ') && this.active,
      dash: this.taps.read(x, z), interact:this.interaction,
      aim: this.secondary && this.active, zoomDelta: this.wheel,
    };
    this.reload=false;this.stance=false;this.jump = false; this.dodge = false;this.primaryPressed=false;this.interaction=undefined;
    this.wheel=0;
    return frame;
  }
  clear(): void { this.cancelVersion++;this.held.clear(); this.reload=false;this.stance=false;this.jump = false; this.dodge = false; this.primary = false;this.primaryPressed=false; this.secondary = false; this.drag = false;this.wheel=0;this.interaction=undefined;this.taps.clear(); }
  dispose(): void { this.clear(); if (this.locked) document.exitPointerLock(); this.controller.abort(); }
}

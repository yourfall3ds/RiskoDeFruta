export type { InputFrame } from './InputFrame';
export { EMPTY_INPUT } from './InputFrame';
import type { InputFrame } from './InputFrame';

export class GameInput {
  private readonly held = new Set<string>();
  private reload=false;
  private jump = false;
  private dodge = false;
  private interaction:number|undefined;
  private primary = false;
  private primaryPressed = false;
  private secondary = false;
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
      if (['Space','ShiftLeft','ShiftRight','KeyW','KeyA','KeyS','KeyD'].includes(e.code)) e.preventDefault();
      this.held.add(e.code);
      if (!e.repeat && e.code === 'Space') this.jump = true;
      if (!e.repeat && e.code.startsWith('Shift')) this.dodge = true;
      if(!e.repeat&&e.code==='KeyR')this.reload=true;
      if(!e.repeat&&e.code==='KeyE')this.interaction=0;
    }, { signal });
    window.addEventListener('keyup', e => this.held.delete(e.code), { signal });
    window.addEventListener('blur', () => this.clear(), { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); }, { signal });
    document.addEventListener('pointerlockchange', () => { this.clear(); onActive(this.locked); }, { signal });
    canvas.addEventListener('pointerdown', e => {
      canvas.focus(); this.drag = true; onActive(true);
      if (e.button === 0) {this.primary = true;this.primaryPressed=true;}
      if (e.button === 2) this.secondary = true;
    }, { signal });
    window.addEventListener('pointerup', e => {
      this.drag = false;
      if (e.button === 0) this.primary = false;
      if (e.button === 2) this.secondary = false;
    }, { signal });
    window.addEventListener('pointermove', e => {
      if (!this.locked && !this.drag) return;
      this.yaw += e.movementX * this.sensitivity;
      this.pitch = Math.max(-1.1, Math.min(1.1, this.pitch + e.movementY * this.sensitivity));
    }, { signal });
    canvas.addEventListener('contextmenu', e => e.preventDefault(), { signal });
  }
  get locked(): boolean { return document.pointerLockElement === this.canvas; }
  get active(): boolean { return this.locked || document.activeElement === this.canvas; }
  async capture(): Promise<void> {
    this.canvas.focus();
    try { await this.canvas.requestPointerLock(); } catch { this.onActive(true); }
  }
  read(): InputFrame {
    const frame = {
      x: Number(this.held.has('KeyD')) - Number(this.held.has('KeyA')),
      z: Number(this.held.has('KeyW')) - Number(this.held.has('KeyS')),
      reload:this.reload,jump: this.jump, dodge: this.dodge, fire: (this.primary||this.primaryPressed) && this.active, charging: this.secondary && this.active,interact:this.interaction,
    };
    this.reload=false;this.jump = false; this.dodge = false;this.primaryPressed=false;this.interaction=undefined;
    return frame;
  }
  clear(): void { this.cancelVersion++;this.held.clear(); this.reload=false;this.jump = false; this.dodge = false; this.primary = false;this.primaryPressed=false; this.secondary = false; this.drag = false;this.interaction=undefined; }
  dispose(): void { this.clear(); if (this.locked) document.exitPointerLock(); this.controller.abort(); }
}

/** Duração e intensidade da lentidão; curta de propósito, para finalizar sem travar o combate. */
export const SLOW_MOTION_SECONDS=0.55;
export const SLOW_MOTION_SCALE=0.32;
export const SLOW_MOTION_COOLDOWN=9;

/**
 * Lentidão breve em mortes fortes (chefe, elite, abate por habilidade).
 * Não interrompe toda morte: exige o gatilho forte e respeita um intervalo.
 *
 * IMPORTANTE: a escala é **apenas de apresentação**. O relógio do diretor, a simulação
 * a passo fixo e o servidor continuam em tempo real — `scale` nunca deve ser aplicado a eles.
 */
export class SlowMotion {
  remaining=0;
  private cooldown=0;
  triggers=0;
  /** Solicita a lentidão; devolve `false` se o intervalo ainda não passou. */
  request(strong:boolean):boolean {
    if(!strong||this.cooldown>0||this.remaining>0)return false;
    this.remaining=SLOW_MOTION_SECONDS;this.cooldown=SLOW_MOTION_COOLDOWN;this.triggers++;return true;
  }
  /** Avança com `dt` real (não escalado), senão a lentidão se prolongaria sozinha. */
  update(dt:number):void {
    const step=Math.max(0,dt);
    this.remaining=Math.max(0,this.remaining-step);
    this.cooldown=Math.max(0,this.cooldown-step);
  }
  /** 1 em jogo normal. Ataque imediato no impacto e retorno suave ao tempo real. */
  get scale():number {
    if(this.remaining<=0)return 1;
    const progress=Math.min(1,Math.max(0,1-this.remaining/SLOW_MOTION_SECONDS));
    return 1-(1-SLOW_MOTION_SCALE)*Math.pow(1-progress,1.6);
  }
  get active():boolean {return this.remaining>0;}
  reset():void {this.remaining=0;this.cooldown=0;this.triggers=0;}
}

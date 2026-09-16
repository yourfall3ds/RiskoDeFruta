import {MELEE_TUNING} from '../player/PlayerTuning';

export type MeleePhase='idle'|'windup'|'active'|'recover';
export type MeleeStep=typeof MELEE_TUNING.steps[number];

/**
 * Combate desarmado alternável com `V`: as pistolas ficam guardadas e o combo alterna
 * direita, esquerda, gancho, chute e giro. Cada etapa causa dano **uma única vez por alvo**,
 * e a cadência acelera animação e janela ativa juntas — não só o intervalo entre golpes.
 */
export class UnarmedCombat {
  /** `true` = pistolas nas mãos. Alternar guarda/saca as armas. */
  armed=true;
  phase:MeleePhase='idle';
  stepIndex=0;
  clock=0;
  strikes=0;
  /** Multiplicador de cadência dos itens; 1 = ritmo inicial lento pedido. */
  rateMultiplier=1;
  private comboClock=0;
  private queued=false;
  private readonly struck=new Set<number>();

  get step():MeleeStep {return MELEE_TUNING.steps[this.stepIndex]!;}
  get active():boolean {return this.phase==='active';}
  get busy():boolean {return this.phase!=='idle';}
  /** 0..1 dentro da etapa atual; a animação usa isto para acompanhar a cadência real. */
  get stepProgress():number {
    const step=this.step,total=step.windup+step.active+step.recover;
    return total>0?Math.min(1,this.clock/total):0;
  }
  /**
   * 0..1 dentro da FASE atual (antecipação, janela ativa ou recuperação).
   *
   * É o que a pose autoral consome: como `clock` já avança multiplicado pela cadência, acelerar o
   * ataque encurta as três fases juntas e a animação acompanha sem cálculo extra.
   */
  get phaseProgress():number {
    const step=this.step;
    if(this.phase==='windup')return step.windup>0?Math.min(1,this.clock/step.windup):1;
    if(this.phase==='active')return step.active>0?Math.min(1,(this.clock-step.windup)/step.active):1;
    if(this.phase==='recover')return step.recover>0?Math.min(1,(this.clock-step.windup-step.active)/step.recover):1;
    return 0;
  }
  private get rate():number {return Math.max(.2,this.rateMultiplier);}

  /** Guarda ou saca as pistolas. Recusa no meio de um golpe para não cortar a etapa ativa. */
  toggle():boolean {
    if(this.busy)return false;
    this.armed=!this.armed;
    if(this.armed)this.reset();
    return true;
  }
  /** Pedido de golpe. Durante a recuperação, enfileira a etapa seguinte do combo. */
  strike():boolean {
    if(this.armed)return false;
    if(this.phase==='idle'){this.begin(this.comboClock>0?this.stepIndex:0);return true;}
    if(this.phase==='recover'&&!this.queued){this.queued=true;return true;}
    return false;
  }
  private begin(index:number):void {
    this.stepIndex=index%MELEE_TUNING.steps.length;
    this.phase='windup';this.clock=0;this.queued=false;this.struck.clear();
  }
  update(dt:number):void {
    const step=Math.max(0,dt);
    this.comboClock=Math.max(0,this.comboClock-step);
    if(this.comboClock===0&&this.phase==='idle')this.stepIndex=0;
    if(this.phase==='idle')return;
    this.clock+=step*this.rate;
    const current=this.step;
    if(this.phase==='windup'&&this.clock>=current.windup){this.phase='active';this.struck.clear();this.strikes++;}
    if(this.phase==='active'&&this.clock>=current.windup+current.active)this.phase='recover';
    if(this.phase==='recover'&&this.clock>=current.windup+current.active+current.recover){
      this.comboClock=MELEE_TUNING.comboWindowSeconds;
      if(this.queued)this.begin(this.stepIndex+1);
      else {this.phase='idle';this.clock=0;this.stepIndex=(this.stepIndex+1)%MELEE_TUNING.steps.length;}
    }
  }
  /** Um alvo só pode ser atingido uma vez por etapa ativa. */
  canHit(targetId:number):boolean {return this.phase==='active'&&!this.struck.has(targetId);}
  registerHit(targetId:number):void {this.struck.add(targetId);}
  /** O giro final é o golpe pesado — é ele que autoriza a lentidão de finalização. */
  get heavy():boolean {return this.step.id==='spin-kick';}
  reset():void {this.phase='idle';this.clock=0;this.stepIndex=0;this.comboClock=0;this.queued=false;this.struck.clear();}
  resetAttempt():void {this.reset();this.armed=true;this.strikes=0;this.rateMultiplier=1;}
}

/** Alcance, cone e altura de uma etapa. A linha de visão é conferida pelo chamador. */
export function meleeReaches(step:MeleeStep,origin:{x:number;y:number;z:number},yaw:number,target:{x:number;y:number;z:number},targetRadius=0):boolean {
  const dx=target.x-origin.x,dz=target.z-origin.z,distance=Math.hypot(dx,dz);
  if(distance>step.range+targetRadius)return false;
  if(Math.abs(target.y-origin.y)>2.2)return false;
  if(distance<1e-4)return true;
  const facing=Math.atan2(Math.sin(yaw),Math.cos(yaw)),angle=Math.atan2(dx,dz);
  const delta=Math.abs(Math.atan2(Math.sin(angle-facing),Math.cos(angle-facing)))*180/Math.PI;
  return delta<=step.coneDegrees/2;
}

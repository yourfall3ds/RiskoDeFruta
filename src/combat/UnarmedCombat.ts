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
    this.phase='windup';this.clock=0;this.queued=false;this.struck.clear();this.sceneryHit=false;
  }
  update(dt:number):void {
    const step=Math.max(0,dt);
    this.comboClock=Math.max(0,this.comboClock-step);
    if(this.comboClock===0&&this.phase==='idle')this.stepIndex=0;
    if(this.phase==='idle')return;
    this.clock+=step*this.rate;
    const current=this.step;
    if(this.phase==='windup'&&this.clock>=current.windup){this.phase='active';this.struck.clear();this.sceneryHit=false;this.strikes++;}
    if(this.phase==='active'&&this.clock>=current.windup+current.active)this.phase='recover';
    if(this.phase==='recover'&&this.clock>=current.windup+current.active+current.recover){
      this.comboClock=MELEE_TUNING.comboWindowSeconds;
      if(this.queued)this.begin(this.stepIndex+1);
      else {this.phase='idle';this.clock=0;this.stepIndex=(this.stepIndex+1)%MELEE_TUNING.steps.length;}
    }
  }
  /**
   * O golpe já arranhou cenário nesta etapa do combo.
   *
   * Existe pelo mesmo motivo de `canHit`/`registerHit` para inimigos: uma etapa é UM golpe, e
   * sem a marca o soco aplicaria dano de destruição a cada quadro em que a etapa está ativa.
   */
  sceneryHit=false;

  /** Um alvo só pode ser atingido uma vez por etapa ativa. */
  canHit(targetId:number):boolean {return this.phase==='active'&&!this.struck.has(targetId);}
  registerHit(targetId:number):void {this.struck.add(targetId);}
  /** O giro final é o golpe pesado — é ele que autoriza a lentidão de finalização. */
  get heavy():boolean {return this.step.id==='spin-kick';}
  reset():void {this.phase='idle';this.clock=0;this.stepIndex=0;this.comboClock=0;this.queued=false;this.struck.clear();this.sceneryHit=false;}
  resetAttempt():void {this.reset();this.armed=true;this.strikes=0;this.rateMultiplier=1;}
}

/** Alcance, cone e altura de uma etapa. A linha de visão é conferida pelo chamador. */
/**
 * Alcance, cone e diferença de altura do golpe.
 *
 * `space` é opcional e existe só para o mapa curvo: a distância vira arco, a diferença de altura
 * vira projeção na vertical local e o cone é medido no plano TANGENTE. Sem ele o cálculo é o de
 * sempre, número por número — `hypot(dx,dz)`, `target.y − origin.y` e `atan2(dx,dz)`.
 *
 * O cone e o alcance NÃO mudam de valor: `step.range` e `step.coneDegrees` continuam sendo os
 * mesmos graus e os mesmos metros do combate original.
 */
export interface MeleeSpace {
  planarDistance(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number}):number;
  heightGap(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number}):number;
  /** Base tangente em `p`; `right = up × forward`. */
  basis(p:{x:number;y:number;z:number},forwardHint:{x:number;y:number;z:number}):{up:{x:number;y:number;z:number};forward:{x:number;y:number;z:number};right:{x:number;y:number;z:number}};
}

export function meleeReaches(step:MeleeStep,origin:{x:number;y:number;z:number},yaw:number,target:{x:number;y:number;z:number},targetRadius=0,space?:MeleeSpace,facingWorld?:{x:number;y:number;z:number}):boolean {
  if(space&&facingWorld){
    const distance=space.planarDistance(target,origin);
    if(distance>step.range+targetRadius)return false;
    if(Math.abs(space.heightGap(target,origin))>2.2)return false;
    if(distance<1e-4)return true;
    // Ângulo entre a frente do corpo e o alvo, medido no plano tangente do ATACANTE.
    const b=space.basis(origin,facingWorld);
    const to={x:target.x-origin.x,y:target.y-origin.y,z:target.z-origin.z};
    const ahead=to.x*b.forward.x+to.y*b.forward.y+to.z*b.forward.z;
    const side=to.x*b.right.x+to.y*b.right.y+to.z*b.right.z;
    return Math.abs(Math.atan2(side,ahead))*180/Math.PI<=step.coneDegrees/2;
  }
  const dx=target.x-origin.x,dz=target.z-origin.z,distance=Math.hypot(dx,dz);
  if(distance>step.range+targetRadius)return false;
  if(Math.abs(target.y-origin.y)>2.2)return false;
  if(distance<1e-4)return true;
  const facing=Math.atan2(Math.sin(yaw),Math.cos(yaw)),angle=Math.atan2(dx,dz);
  const delta=Math.abs(Math.atan2(Math.sin(angle-facing),Math.cos(angle-facing)))*180/Math.PI;
  return delta<=step.coneDegrees/2;
}

import {MELEE_TUNING} from '../player/PlayerTuning';
import type {MeleePhase} from '../combat/UnarmedCombat';
import type {Vec3} from '../core/contracts';

/**
 * Revisão do combo desarmado no F1: ciclo lento, parada em qualquer etapa e na pose de CONTATO,
 * câmera de corpo inteiro e saída limpa.
 *
 * É um relógio próprio, separado do `UnarmedCombat` — assim a revisão não consome cadência de
 * itens, não marca alvos, não conta golpes e não altera o estado da partida. O que ela produz é
 * exatamente o mesmo `{stepId, phase, progress}` que o combate real entrega ao `CharacterVisual`,
 * então o que o Codex vê aqui é a curva que o jogo toca.
 */

export const MELEE_REVIEW_RATES=[.18,.35,.6,1] as const;
/** Pose de contato: início da janela ativa, onde a pose autoral chega ao pico. */
export const CONTACT_PROGRESS=.02;

export interface MeleeReviewPose {stepId:string;phase:MeleePhase;progress:number;heavy:boolean}
/** Enquadramento de corpo inteiro: longe o bastante para caber pés e mãos no quadro. */
export interface MeleeReviewShot {position:Vec3;target:Vec3}

const STEPS=MELEE_TUNING.steps;
const total=(index:number)=>{const s=STEPS[index]!;return s.windup+s.active+s.recover;};

export class MeleeReview {
  active=false;
  /** Índice da etapa em revisão. */
  stepIndex=0;
  /** Fração do tempo real; começa no ciclo mais lento. */
  rate:number=MELEE_REVIEW_RATES[0]!;
  /** `true` congela a pose escolhida em vez de rodar o ciclo. */
  frozen=false;
  /** Relógio dentro da etapa, em segundos de animação. */
  clock=0;
  /** Voltas completas do combo desde a entrada — o Codex usa para saber que viu tudo. */
  loops=0;

  get step(){return STEPS[this.stepIndex]!;}
  get heavy():boolean {return this.step.id==='spin-kick';}

  enter():void {this.active=true;this.stepIndex=0;this.clock=0;this.frozen=false;this.loops=0;this.rate=MELEE_REVIEW_RATES[0]!;}
  /** Saída limpa: some tudo, inclusive a pose, e o jogo volta sem resíduo na raiz. */
  exit():void {this.active=false;this.frozen=false;this.clock=0;this.stepIndex=0;this.loops=0;}

  /** Próxima/anterior etapa do combo, preservando o modo congelado. */
  select(index:number):void {
    const count=STEPS.length;
    this.stepIndex=((index%count)+count)%count;
    this.clock=this.frozen?this.contactClock():0;
  }
  next():void {this.select(this.stepIndex+1);}
  previous():void {this.select(this.stepIndex-1);}

  /** Congela exatamente na pose de contato da etapa atual. */
  holdContact():void {this.frozen=true;this.clock=this.contactClock();}
  /** Volta a rodar o ciclo lento a partir da pose visível. */
  play():void {this.frozen=false;}
  /** Passo a passo: avança o relógio congelado em frações pequenas da etapa. */
  nudge(seconds:number):void {
    this.frozen=true;
    this.clock=Math.max(0,Math.min(total(this.stepIndex),this.clock+seconds));
  }
  /** Ciclo de velocidades, do mais lento ao tempo real. */
  cycleRate():void {
    const index=MELEE_REVIEW_RATES.indexOf(this.rate as (typeof MELEE_REVIEW_RATES)[number]);
    this.rate=MELEE_REVIEW_RATES[(index+1)%MELEE_REVIEW_RATES.length]!;
  }

  private contactClock():number {return this.step.windup+this.step.active*CONTACT_PROGRESS;}

  update(dt:number):void {
    if(!this.active||this.frozen||!Number.isFinite(dt)||dt<=0)return;
    this.clock+=dt*Math.max(.02,this.rate);
    const span=total(this.stepIndex);
    // Respiro entre etapas, para o revisor separar recuperação de antecipação.
    if(this.clock>=span+.35){
      this.clock=0;
      this.stepIndex=(this.stepIndex+1)%STEPS.length;
      if(this.stepIndex===0)this.loops++;
    }
  }

  /** Pose atual, no mesmo contrato que o combate real entrega ao rig. */
  get pose():MeleeReviewPose {
    const step=this.step,clock=Math.min(this.clock,total(this.stepIndex));
    const phase:MeleePhase=clock<step.windup?'windup':clock<step.windup+step.active?'active':'recover';
    const progress=phase==='windup'?(step.windup>0?clock/step.windup:1)
      :phase==='active'?(step.active>0?(clock-step.windup)/step.active:1)
      :(step.recover>0?(clock-step.windup-step.active)/step.recover:1);
    return {stepId:step.id,phase,progress:Math.max(0,Math.min(1,progress)),heavy:this.heavy};
  }

  /** Rótulo do painel: etapa, fase e ritmo, para o revisor saber o que está vendo. */
  get label():string {
    const {phase,progress}=this.pose;
    const name={windup:'ANTECIPAÇÃO',active:'CONTATO',recover:'RECUPERAÇÃO',idle:'PARADO'}[phase];
    return `${this.stepIndex+1}/${STEPS.length} ${this.step.id} · ${name} ${Math.round(progress*100)}% · ${Math.round(this.rate*100)}% do ritmo${this.frozen?' · CONGELADO':''}`;
  }
}

/**
 * Câmera de corpo inteiro para a revisão: três quartos à frente, na altura do peito e longe o
 * bastante para os pés e o punho caberem no quadro ao mesmo tempo.
 */
export function meleeReviewShot(body:Vec3,yaw:number):MeleeReviewShot {
  const forward={x:Math.sin(yaw),z:Math.cos(yaw)},right={x:Math.cos(yaw),z:-Math.sin(yaw)};
  return {
    position:{x:body.x+forward.x*3.5+right.x*2.4,y:body.y+1.35,z:body.z+forward.z*3.5+right.z*2.4},
    target:{x:body.x,y:body.y+.95,z:body.z},
  };
}

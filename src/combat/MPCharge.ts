import type { EventBus } from '../core/EventBus';
import type { DamageContext,GameEvents } from '../core/contracts';

export type MPTier = 0 | 1 | 2 | 3;
export const MP_COSTS=[25,55,100] as const;
export const MP_THRESHOLDS = [.6,1.4,2.6] as const;
export const SKILL_CHARGE_RECHARGE=16;
/** Ganho por acerto básico confirmado (pistola ou corpo a corpo) num inimigo vivo. */
export const MP_HIT_GAIN=2;
/**
 * Teto de ganho por **janela deslizante real** de 1 s: em QUALQUER intervalo de 1 s a barra sobe no
 * máximo `MP_HIT_WINDOW_CAP`. Rajada e multi-alvo (perfuração, ricochete, explosão) chegam ao teto e
 * param. Com 2 MP por acerto isso são 3 acertos premiados por segundo — MP I (25) pede ~4,2 s de
 * combate contínuo, MP II (55) ~9,2 s e MP III (100) ~16,7 s.
 *
 * O estado são os carimbos de tempo dos últimos `MP_HIT_WINDOW_HITS` acertos premiados, num anel de
 * 3 posições: O(1) de tempo e de memória, sem o furo de fronteira que uma janela fixa teria
 * (janela fixa deixaria passar 12 MP num intervalo de 1 s escolhido em cima da virada).
 */
export const MP_HIT_WINDOW=1;
export const MP_HIT_WINDOW_CAP=6;
export const MP_HIT_WINDOW_HITS=MP_HIT_WINDOW_CAP/MP_HIT_GAIN;
/** Só o dano básico do jogador alimenta a barra; especiais não se realimentam. */
const BASIC_TAGS=['bullet','melee'] as const;
/**
 * Um acerto só vale MP depois que a vida do alvo aceitou o dano: quem escuta é `EnemyHit`,
 * emitido por `Health.apply` *após* a subtração. `DamageDealt` é emitido antes de `target.onHit`
 * em `DualPistols`/corpo a corpo, então não prova nada — erro, parede, cadáver e dano recusado
 * também passariam por lá.
 */
export function awardsMP(hit:DamageContext):boolean {
  if(hit.attackerId!==1||hit.victimId===1||!(hit.finalDamage>0))return false;
  // Proc, queimadura e comandos de QA/debug entram com profundidade de cadeia ou id de proc.
  if(hit.procChainDepth>0||hit.sourceProcId!==undefined)return false;
  const tags=hit.damageTags;
  if(tags.includes('skill')||tags.includes('dot')||tags.includes('qa')||tags.includes('debug'))return false;
  return BASIC_TAGS.some(tag=>tags.includes(tag));
}
/** Fixed-time charging; damage and dodge deliberately do not reset this state. */
export class MPCharge {
  current=100;readonly maximum=100;
  seconds=0;
  tier: MPTier=0;
  held=false;
  releases=0;
  speedMultiplier=1;
  /** Cargas extras concedidas por itens: permitem emendar uma continuação da habilidade. */
  maxCharges=0;charges=0;private chargeClock=0;
  /** Anel com os carimbos dos últimos acertos premiados; o cursor aponta sempre para o mais antigo. */
  private readonly rewardedAt:number[]=Array.from({length:MP_HIT_WINDOW_HITS},()=>Number.NEGATIVE_INFINITY);
  private rewardCursor=0;private clock=0;
  constructor(private readonly events: EventBus<GameEvents>) {events.on('EnemyHit',hit=>{if(awardsMP(hit))this.reward();});}
  gain(amount:number):void {if(Number.isFinite(amount)&&amount>0)this.current=Math.min(this.maximum,this.current+amount);}
  /** Quanto ainda cabe no último segundo; expõe o teto para HUD/diagnóstico e testes. */
  get hitBudget():number{
    let free=0;
    for(const at of this.rewardedAt)if(this.clock-at>=MP_HIT_WINDOW)free++;
    return free*MP_HIT_GAIN;
  }
  private reward():void {
    // O mais antigo dos três: se ele ainda está dentro da janela, já houve 3 acertos premiados no
    // último segundo e este não entra. Sem varrer nada além das três posições fixas do anel.
    if(this.clock-this.rewardedAt[this.rewardCursor]!<MP_HIT_WINDOW)return;
    this.rewardedAt[this.rewardCursor]=this.clock;
    this.rewardCursor=(this.rewardCursor+1)%MP_HIT_WINDOW_HITS;
    this.gain(MP_HIT_GAIN);
  }
  /** Um item recém-coletado entrega a carga cheia; perder cargas nunca deixa o contador acima do teto. */
  setMaxCharges(max:number):void {const target=Math.max(0,Math.floor(max));if(target>this.maxCharges)this.charges+=target-this.maxCharges;this.maxCharges=target;this.charges=Math.max(0,Math.min(this.charges,target));if(this.charges>=target)this.chargeClock=0;}
  get chargeProgress():number{return this.maxCharges&&this.charges<this.maxCharges?Math.min(1,this.chargeClock/SKILL_CHARGE_RECHARGE):1;}
  get chargeSecondsLeft():number{return this.maxCharges&&this.charges<this.maxCharges?Math.max(0,SKILL_CHARGE_RECHARGE-this.chargeClock):0;}
  /** Consome de verdade uma carga; sem carga a continuação não acontece. */
  consumeCharge():boolean{if(this.charges<=0)return false;this.charges--;this.chargeClock=0;return true;}
  private rechargeCharges(dt:number):void {
    if(this.charges>=this.maxCharges){this.chargeClock=0;return;}
    this.chargeClock+=Math.max(0,dt);
    while(this.chargeClock>=SKILL_CHARGE_RECHARGE&&this.charges<this.maxCharges){this.charges++;this.chargeClock-=SKILL_CHARGE_RECHARGE;}
    if(this.charges>=this.maxCharges)this.chargeClock=0;
  }
  update(dt: number,held: boolean): MPTier {
    this.rechargeCharges(dt);
    this.clock+=Math.max(0,dt);
    if(held) {
      this.held=true;this.seconds=Math.min(2.6,this.seconds+dt*this.speedMultiplier);
      for(const tier of [1,2,3] as const)if(this.current+1e-8>=MP_COSTS[tier-1]!&&this.tier<tier&&this.seconds+1e-8>=MP_THRESHOLDS[tier-1]!) {
        this.tier=tier;this.events.emit('MPCharged',{entityId:1,tier});
      }
      return 0;
    }
    if(!this.held)return 0;
    const tier=this.tier;this.events.emit('MPReleased',{entityId:1,tier});
    if(tier){this.releases++;this.current=Math.max(0,this.current-MP_COSTS[tier-1]!);}
    this.cancel();return tier;
  }
  cancel(): void {this.seconds=0;this.tier=0;this.held=false;}
}

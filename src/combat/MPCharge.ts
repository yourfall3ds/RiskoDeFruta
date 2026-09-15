import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/contracts';

export type MPTier = 0 | 1 | 2 | 3;
export const MP_COSTS=[25,55,100] as const;
export const MP_REGEN=1.8;
export const MP_THRESHOLDS = [.6,1.4,2.6] as const;
/** Fixed-time charging; damage and dodge deliberately do not reset this state. */
export class MPCharge {
  current=100;readonly maximum=100;
  seconds=0;
  tier: MPTier=0;
  held=false;
  releases=0;
  speedMultiplier=1;
  constructor(private readonly events: EventBus<GameEvents>) {events.on('DamageDealt',hit=>{if(hit.attackerId===1&&hit.victimId!==1&&hit.finalDamage>0)this.gain(hit.damageTags.includes('skill')?.2:3.5);});}
  gain(amount:number):void {if(Number.isFinite(amount)&&amount>0)this.current=Math.min(this.maximum,this.current+amount);}
  update(dt: number,held: boolean): MPTier {
    this.gain(Math.max(0,dt)*MP_REGEN);
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

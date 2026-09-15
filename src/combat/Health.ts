import type { DamageContext,GameEvents } from '../core/contracts';
import type { EventBus } from '../core/EventBus';

export class Health {
  current:number;
  constructor(readonly id:number,readonly maximum:number,private readonly events:EventBus<GameEvents>){this.current=maximum;}
  get dead():boolean{return this.current<=0;}
  apply(context:DamageContext):boolean {
    if(this.dead||context.victimId!==this.id||!Number.isFinite(context.finalDamage)||context.finalDamage<=0)return false;
    this.current=Math.max(0,this.current-context.finalDamage);
    this.events.emit('DamageTaken',context);this.events.emit('EnemyHit',context);
    if(this.dead)this.events.emit('EnemyKilled',context);
    return true;
  }
  reset():void {this.current=this.maximum;}
}

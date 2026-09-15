import type { DamageContext } from '../core/contracts';
import type { RandomStream } from '../core/RunRNG';
import { ITEMS,type RunProgression } from '../run/RunProgression';

interface HitHooks {burn:(seconds:number)=>void;blast:(radius:number)=>void}
const HIT_HOOKS={
  burn:(count:number,roll:number,coefficient:number,hooks:HitHooks)=>{if(roll<count*.2/(1+count*.2)*coefficient)hooks.burn(3+count);},
  blast:(count:number,roll:number,coefficient:number,hooks:HitHooks)=>{if(roll<count*.12/(1+count*.12)*coefficient)hooks.blast(3+count*.3);},
};
/** Item hook registry. Secondary damage cannot recursively trigger primary-hit procs. */
export class ItemProcs {
  constructor(private readonly run:RunProgression,private readonly rng:RandomStream){}
  onHit(context:DamageContext,hooks:HitHooks):void {
    if(context.procChainDepth>0||context.procCoefficient<=0)return;
    for(const item of ITEMS){const count=this.run.inventory.get(item.id)??0;if(!count||!item.hook||!(item.hook in HIT_HOOKS))continue;HIT_HOOKS[item.hook as keyof typeof HIT_HOOKS](count,this.rng.next(),Math.min(1,context.procCoefficient),hooks);}
  }
  onKill():number {return ITEMS.reduce((healing,item)=>healing+(item.hook==='harvest'?(this.run.inventory.get(item.id)??0)*4:0),0);}
}

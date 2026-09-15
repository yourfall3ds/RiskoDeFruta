import type {DamageContext} from '../core/contracts';
export function enemyImpact(context:DamageContext,variant:string,kind:string,cooldown:number):{force:number;stagger:boolean} {
 const regular=context.sourceId==='dual_pistols'||context.procChainDepth>0;
 const force=Math.min(10,context.forceMagnitude*(regular?.18:.65))/(variant==='giant'?3:kind==='boss'?5:1);
 return {force,stagger:!regular&&force>3&&cooldown<=0};
}

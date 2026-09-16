import type {DamageContext} from '../core/contracts';
/** Shared by articulated and fallback corpses so the launch sound matches actual movement. */
export function corpseLaunch(context:DamageContext):{x:number;y:number;z:number} {
 const heavy=context.damageTags.includes('melee_heavy')&&context.forceMagnitude>=8;
 const speed=heavy?Math.min(10,context.forceMagnitude):3;
 return {x:context.forceDirection.x*speed,y:heavy?4:2.2,z:context.forceDirection.z*speed};
}
export function enemyImpact(context:DamageContext,variant:string,kind:string,cooldown:number):{force:number;stagger:boolean} {
 const regular=context.sourceId==='dual_pistols'||context.procChainDepth>0;
 const force=Math.min(10,context.forceMagnitude*(regular?.18:.65))/(variant==='giant'?3:kind==='boss'?5:1);
 return {force,stagger:!regular&&force>3&&cooldown<=0};
}

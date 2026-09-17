import type {DamageContext} from '../core/contracts';
/** Shared by articulated and fallback corpses so the launch sound matches actual movement. */
export function corpseLaunch(context:DamageContext):{x:number;y:number;z:number} {
 const heavy=context.damageTags.includes('melee_heavy')&&context.forceMagnitude>=8;
 const speed=heavy?Math.min(10,context.forceMagnitude):3;
 return {x:context.forceDirection.x*speed,y:heavy?4:2.2,z:context.forceDirection.z*speed};
}
export function enemyImpact(context:DamageContext,variant:string,kind:string,cooldown:number):{force:number;stagger:boolean} {
 const regular=context.sourceId==='dual_pistols'||context.procChainDepth>0;
 const melee=!regular&&context.damageTags.includes('melee');
 // Direct punches move a normal enemy about 0.8 m; kicks/finishers about 1.8–2.2 m.
 // Secondary item procs retain their reduced impulse, even when copied from a melee hit.
 const resistance=kind==='boss'?5:variant==='giant'?3:1;
 const force=Math.min(melee?18:10,context.forceMagnitude*(regular?.18:melee?1.6:.65))/resistance;
 return {force,stagger:!regular&&force>3&&cooldown<=0};
}

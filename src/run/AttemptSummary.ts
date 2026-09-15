import {ITEMS,type RunProgression} from './RunProgression';
export interface AttemptSummary {time:number;stage:number;kills:number;level:number;wave:number;completedWaves:number;credits:number;items:{id:string;name:string;icon:number;count:number}[]}
/** Copy the completed attempt before mutable run state is reset. */
export function attemptSummary(run:RunProgression,wave=1,completedWaves=0):AttemptSummary {
 return {time:run.time,stage:run.stage,kills:run.totalKills,level:run.level,wave,completedWaves,credits:run.credits,items:[...run.inventory].map(([id,count])=>{const item=ITEMS.find(i=>i.id===id)!;return {id,name:item.name,icon:item.icon,count};})};
}

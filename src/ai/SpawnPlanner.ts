import type {RandomStream} from '../core/RunRNG';
import type {Vec3} from '../core/contracts';
export interface SpawnTerrain {groundAt(x:number,z:number,maxHeight:number):number}
/** Bounded work per director attempt, relative to the current arena instead of a hard-coded map rectangle. */
export function chooseSpawnAround(player:Vec3,rng:RandomStream,terrain:SpawnTerrain,reachable:(p:Vec3)=>boolean,occupied:(p:Vec3)=>boolean):Vec3|undefined {
 for(let attempt=0;attempt<24;attempt++){const angle=rng.range(0,Math.PI*2),radius=rng.range(17,32),p={x:player.x+Math.sin(angle)*radius,y:0,z:player.z+Math.cos(angle)*radius};p.y=terrain.groundAt(p.x,p.z,player.y+6);if(Number.isFinite(p.y)&&reachable(p)&&!occupied(p))return p;}
 return;
}

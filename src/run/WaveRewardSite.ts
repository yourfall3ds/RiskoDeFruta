import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
import {DISTRICT_CONTRACTS} from './DistrictContracts';

export const WAVE_FIELDS=[{id:'initial',name:'Campo inicial',x:0,y:0,z:0},...DISTRICT_CONTRACTS] as const;
export interface WaveRewardSite {name:string;position:Vec3}
/** Only the closest field may receive the reward. Unloaded/obstructed terrain defers delivery. */
export function waveRewardSite(world:CollisionWorld,player:Vec3):WaveRewardSite|undefined {
 const field=WAVE_FIELDS.reduce((a,b)=>Math.hypot(a.x-player.x,a.z-player.z)<=Math.hypot(b.x-player.x,b.z-player.z)?a:b);
 for(const radius of [0,4,8,12,16])for(let i=0;i<(radius?16:1);i++){
  const angle=i*Math.PI/8,x=field.x+Math.sin(angle)*radius,z=field.z+Math.cos(angle)*radius;
  const y=world.groundAt(x,z,field.y+.5);
  if(!Number.isFinite(y)||y<field.y-8)continue;
  // Reserve a patch large enough for the ejection and the player's pickup capsule.
  let clear=true;
  for(const [dx,dz] of [[0,0],[2.3,0],[-2.3,0],[0,2.3],[0,-2.3],[1.65,1.65],[-1.65,1.65],[1.65,-1.65],[-1.65,-1.65]]){
   const p={x:x+dx!,y:world.groundAt(x+dx!,z+dz!,y+.5),z:z+dz!};
   if(!Number.isFinite(p.y)||Math.abs(p.y-y)>.5||world.insideSolid(p,1.8)||world.sweepSphere({x:p.x,y:p.y+.8,z:p.z},{x:0,y:.6,z:0},.35,true)){clear=false;break;}
  }
  if(clear)return {name:field.name,position:{x,y,z}};
 }
 return undefined;
}

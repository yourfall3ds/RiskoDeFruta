import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
import {PLAYER_TUNING as t} from './PlayerTuning';

/** A broad, exposed floor with enough room for the entire player capsule. */
export function safeRecoverySupport(world:CollisionWorld,p:Vec3):boolean {
 if(![p.x,p.y,p.z].every(Number.isFinite)||world.onMovingGround(p)||world.insideSolid(p,t.height))return false;
 // A ledge under another walkable surface must not replace the island-top checkpoint.
 const top=world.groundAt(p.x,p.z,Infinity,t.maxSlopeDegrees);
 if(!Number.isFinite(top)||Math.abs(top-p.y)>.12)return false;
 for(let i=0;i<8;i++){
  const angle=i*Math.PI/4,r=t.radius+.45;
  const y=world.groundAt(p.x+Math.cos(angle)*r,p.z+Math.sin(angle)*r,p.y+.4,t.maxSlopeDegrees);
  if(!Number.isFinite(y)||Math.abs(y-p.y)>.4)return false;
 }
 // Sweep a sphere from ankles to head: this covers the full capsule and detects walls/ceilings.
 return !world.sweepSphere({x:p.x,y:p.y+t.radius+.04,z:p.z},{x:0,y:t.height-2*t.radius,z:0},t.radius,true);
}

/** Resolve stale or buried checkpoints to a validated top surface, never copy them blindly. */
export function findSafeRecovery(world:CollisionWorld,preferred:Vec3,fallback:Vec3):Vec3|undefined {
 const probe=(x:number,z:number):Vec3|undefined=>{
  const y=world.groundAt(x,z,Infinity,t.maxSlopeDegrees);
  const p={x,y,z};return safeRecoverySupport(world,p)?p:undefined;
 };
 for(const anchor of [preferred,fallback]){
  // First lift the checkpoint to the uppermost floor at the same horizontal position.
  const direct=probe(anchor.x,anchor.z);if(direct)return direct;
  for(const radius of [1.5,3,5,8])for(let i=0;i<12;i++){
   const a=i*Math.PI/6,p=probe(anchor.x+Math.cos(a)*radius,anchor.z+Math.sin(a)*radius);
   if(p)return p;
  }
 }
 const floors=[...world.recoverySurfaces()].filter(s=>s.width>2&&s.depth>2)
  .sort((a,b)=>Math.hypot(a.x-preferred.x,a.z-preferred.z)-Math.hypot(b.x-preferred.x,b.z-preferred.z));
 for(const floor of floors){
  // Keep well inside the rim; try the centre and a small interior grid around structures.
  for(const [u,v] of [[0,0],[-.25,0],[.25,0],[0,-.25],[0,.25],[-.25,-.25],[.25,.25]]){
   const p=probe(floor.x+u!*floor.width,floor.z+v!*floor.depth);if(p)return p;
  }
 }
 return undefined;
}

import type {Vec3} from '../core/contracts';
import type {BoxCollider,SweepHit} from './CollisionWorld';

/** Exact separation of a vertical capsule segment and a box, advanced conservatively.
 * Unlike an expanded AABB this retains rounded feet at prop edges and corners. */
export function sweepCapsuleBox(origin:Vec3,delta:Vec3,box:BoxCollider,radius:number,height:number):SweepHit|undefined {
 const speed=Math.hypot(delta.x,delta.y,delta.z);if(speed<1e-10)return;
 let time=0;
 for(let iteration=0;iteration<=24;iteration++){
  const x=origin.x+delta.x*time,z=origin.z+delta.z*time;
  const low=origin.y+delta.y*time+radius,high=origin.y+delta.y*time+Math.max(radius,height-radius);
  const nx=x-Math.max(box.min.x,Math.min(box.max.x,x));
  const nz=z-Math.max(box.min.z,Math.min(box.max.z,z));
  const ny=low>box.max.y?low-box.max.y:high<box.min.y?high-box.min.y:0;
  const distance=Math.hypot(nx,ny,nz);
  // Deep penetration is handled by the world's recovery volumes, not a fabricated support.
  if(distance<1e-10)return;
  if(distance-radius<.0005||iteration===24){
   const normal={x:nx/distance,y:ny/distance,z:nz/distance};
   if(normal.x*delta.x+normal.y*delta.y+normal.z*delta.z>=-1e-8)return;
   return {time,normal,collider:box};
  }
  time+=(distance-radius)/speed;if(time>1)return;
 }
}

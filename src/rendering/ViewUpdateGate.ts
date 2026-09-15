import type {Vec3} from '../core/contracts';
/** Re-evaluate a moving view even while gameplay time is paused. */
export class ViewUpdateGate {
 private elapsed=0;
 private previous:Vec3|undefined;
 ready(dt:number,viewer:Vec3):boolean {
  if(!Number.isFinite(viewer.x)||!Number.isFinite(viewer.y)||!Number.isFinite(viewer.z))return false;
  if(Number.isFinite(dt))this.elapsed+=Math.max(0,dt);
  const moved=!this.previous||Math.hypot(viewer.x-this.previous.x,viewer.y-this.previous.y,viewer.z-this.previous.z)>=12;
  if(!moved&&this.elapsed<.25)return false;
  this.elapsed=0;this.previous={x:viewer.x,y:viewer.y,z:viewer.z};return true;
 }
}

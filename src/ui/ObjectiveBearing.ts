import type {Vec3} from '../core/contracts';

const ARROWS=['↑','↗','→','↘','↓','↙','←','↖'] as const;

/** Direction along the player's local ground, relative to the camera's forward direction. */
export function objectiveBearing(from:Vec3,to:Vec3,forward:Vec3,up:Vec3):string {
  const dot=forward.x*up.x+forward.y*up.y+forward.z*up.z;
  const fx=forward.x-up.x*dot,fy=forward.y-up.y*dot,fz=forward.z-up.z*dot;
  const length=Math.hypot(fx,fy,fz);
  if(length<1e-6)return '↑';
  const x=fx/length,y=fy/length,z=fz/length;
  const rx=up.y*z-up.z*y,ry=up.z*x-up.x*z,rz=up.x*y-up.y*x;
  const dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z;
  const angle=Math.atan2(dx*rx+dy*ry+dz*rz,dx*x+dy*y+dz*z);
  return ARROWS[((Math.round(angle/(Math.PI/4))%8)+8)%8]!;
}

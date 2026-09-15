import type {Vec3} from '../core/contracts';
export interface SolidActor {id:number;position:Vec3;radius:number;height:number;active:()=>boolean}
/** Swept disc contact, used only by the player: walking never adds an impulse to an NPC. */
export function actorContact(origin:Vec3,delta:Vec3,body:SolidActor,radius:number,height:number):{time:number;normal:Vec3}|undefined {
 const rx=origin.x-body.position.x,rz=origin.z-body.position.z,r=radius+body.radius+.025;
 const aa=delta.x*delta.x+delta.z*delta.z,bb=rx*delta.x+rz*delta.z,cc=rx*rx+rz*rz-r*r;
 if(aa<1e-12||bb>=0)return;
 const discriminant=bb*bb-aa*cc;if(discriminant<0)return;
 const time=Math.max(0,(-bb-Math.sqrt(discriminant))/aa);if(time>1)return;
 const y=origin.y+delta.y*time;if(y>=body.position.y+body.height-.02||y+height<=body.position.y+.02)return;
 const x=rx+delta.x*time,z=rz+delta.z*time,length=Math.hypot(x,z)||1;
 return {time,normal:{x:x/length,y:0,z:z/length}};
}

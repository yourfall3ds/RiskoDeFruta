import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {PlayerMotor} from '../player/PlayerMotor';
import type {BoxCollider,CollisionWorld,GroundSurface} from '../physics/CollisionWorld';
/** Predictable docks: three seconds to board, six to travel, three to disembark. */
export function ferryPose(time:number):Vector3 {
 const phase=((time%18)+18)%18;let t=phase<3?0:phase<9?(phase-3)/6:phase<12?1:1-(phase-12)/6;t=t*t*(3-2*t);
 return new Vector3(-26-8*t,.18*Math.sin(t*Math.PI),-8);
}
export class IslandFerry {
 time=0;readonly position=ferryPose(0);readonly previous=this.position.clone();
 readonly surface:GroundSurface={id:'moving-island-ferry',x:-26,z:-8,width:6.8,depth:6.8,height:0,ellipse:true};
 readonly box:BoxCollider={id:'moving-island-ferry',min:{x:-29.4,y:-5,z:-11.4},max:{x:-22.6,y:0,z:-4.6}};
 constructor(private readonly world:CollisionWorld){world.surfaces.push(this.surface);world.movingBoxes.push(this.box);}
 get dock():number {const phase=this.time%18;return phase<3?0:phase>=9&&phase<12?1:-1;}
 update(dt:number,player:PlayerMotor):void {
  this.previous.copyFrom(this.position);const rider=player.grounded&&Math.abs(player.position.y-this.position.y)<.15&&((player.position.x-this.position.x)/3.4)**2+((player.position.z-this.position.z)/3.4)**2<.98;
  this.time+=dt;this.position.copyFrom(ferryPose(this.time));const delta=this.position.subtract(this.previous);this.surface.x=this.position.x;this.surface.height=this.position.y;
  this.box.min.x=this.position.x-3.4;this.box.max.x=this.position.x+3.4;this.box.min.y=this.position.y-5;this.box.max.y=this.position.y;
  if(rider){this.world.move(player.position,delta.x,delta.z,.34,1.7,.35);player.position.y+=delta.y;}
 }
 dispose():void {for(const [list,item] of [[this.world.surfaces,this.surface],[this.world.movingBoxes,this.box]] as const){const index=(list as unknown[]).indexOf(item);if(index>=0)list.splice(index,1);}}
}

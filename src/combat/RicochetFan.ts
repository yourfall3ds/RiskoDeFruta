import {Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import {Ray} from '@babylonjs/core/Culling/ray';
export interface FanHit {point:Vector3;normal:Vector3;distance:number;targetId?:number}
export interface FanBullet {position:Vector3;direction:Vector3;axis:Vector3;turn:number;age:number;bounces:number;hitIds:Set<number>}
/** Free-aim curved ballistics. Reflections depend on surfaces, never on a selected target. */
export class RicochetFan {
 readonly bullets:FanBullet[]=[];readonly count=10;readonly interval=.055;
 constructor(private readonly cast:(ray:Ray,ignore:ReadonlySet<number>)=>FanHit|undefined,private readonly impact:(hit:FanHit,direction:Vector3)=>void,private readonly trail:(from:Vector3,to:Vector3)=>void){}
 launch(origin:Vector3,forward:Vector3,index:number,count:number=this.count):Vector3 {
  const f=forward.normalizeToNew(),right=Vector3.Cross(Vector3.Up(),f).normalize();if(right.lengthSquared()<.001)right.set(1,0,0);
  const axis=Vector3.Cross(f,right).normalize(),angle=(index/(count-1)-.5)*.95;
  const direction=f.scale(Math.cos(angle)).add(right.scale(Math.sin(angle))).normalize();
  if(this.bullets.length<24)this.bullets.push({position:origin.clone(),direction,axis,turn:(index<count/2?-1:1)*.85,age:0,bounces:0,hitIds:new Set()});
  return direction;
 }
 update(dt:number):void {
  // Substeps cap the chord error, including when render and simulation rates differ.
  const steps=Math.max(1,Math.ceil(dt/(1/60))),step=dt/steps;
  for(let tick=0;tick<steps;tick++)for(let i=this.bullets.length-1;i>=0;i--){const b=this.bullets[i]!;b.age+=step;if(b.age>1.5){this.bullets.splice(i,1);continue;}
   if(b.age<.5&&b.bounces===0)b.direction.applyRotationQuaternionInPlace(Quaternion.RotationAxis(b.axis,b.turn*step*(1-b.age/.5)));
   let remaining=38*step;
   for(let contact=0;contact<3&&remaining>.001;contact++){
    const from=b.position.clone(),hit=this.cast(new Ray(from,b.direction,remaining),b.hitIds);
    if(!hit){b.position.addInPlace(b.direction.scale(remaining));this.trail(from,b.position);break;}
    b.position.copyFrom(hit.point);this.trail(from,b.position);
    const incoming=b.direction.clone();if(hit.targetId!==undefined)b.hitIds.add(hit.targetId);this.impact(hit,incoming);
    if(b.bounces++>=2){this.bullets.splice(i,1);break;}
    const normal=hit.normal.lengthSquared()>.001?hit.normal.normalizeToNew():incoming.negate();
    if(Vector3.Dot(normal,incoming)>0)normal.negateInPlace();
    b.direction.subtractInPlace(normal.scale(2*Vector3.Dot(b.direction,normal))).normalize();
    b.position.addInPlace(normal.scale(.035));remaining=Math.max(0,remaining-hit.distance-.035);
   }
  }
 }
 clear():void {this.bullets.length=0;}
}

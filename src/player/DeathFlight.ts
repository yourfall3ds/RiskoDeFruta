import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
/** Fatal launch is isolated from the living motor, but still sweeps the real world. */
export class DeathFlight {
 readonly position:Vec3={x:0,y:0,z:0};
 private velocity:Vec3={x:0,y:0,z:0};private startY=0;
 landed=false;
 constructor(private readonly world:CollisionWorld){}
 start(position:Vec3,yaw:number):void {Object.assign(this.position,position);this.startY=position.y;this.velocity={x:-Math.sin(yaw)*5.8,y:7.2,z:-Math.cos(yaw)*5.8};this.landed=false;}
 update(dt:number):void {
  if(!Number.isFinite(dt)||dt<=0||this.landed)return;
  const count=Math.ceil(Math.min(dt,.1)*120),step=Math.min(dt,.1)/count;
  for(let i=0;i<count&&!this.landed;i++){
   const old={...this.position};this.velocity.y-=13*step;
   this.world.moveAirborne(this.position,{x:this.velocity.x*step,y:this.velocity.y*step,z:this.velocity.z*step},.4,1.8);
   this.velocity.x=(this.position.x-old.x)/step*Math.exp(-step*.75);this.velocity.z=(this.position.z-old.z)/step*Math.exp(-step*.75);
   const floor=this.world.groundAt(this.position.x,this.position.z,old.y+.01);
   if(this.velocity.y<0&&Number.isFinite(floor)&&this.position.y<=floor+.04){this.position.y=floor;this.landed=true;}
   if(this.position.y<=this.startY-18)this.landed=true;
  }
 }
}

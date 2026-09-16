import type {Vec3} from '../core/contracts';
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(n:number)=>{const t=clamp(n);return t*t*(3-2*t);};
const DESCENT=[{time:0,height:900,speed:-400},{time:1.6,height:300,speed:-260},{time:3.2,height:30,speed:-65},{time:4,height:0,speed:-28}] as const;
/** Altitude em que o mergulho começa — é lá que a plataforma da nave precisa estar. */
export const DESCENT_START_HEIGHT=DESCENT[0].height;
/** Recuo horizontal da trajetória por metro de altitude: o corpo entra à frente enquanto cai. */
export const DESCENT_DRIFT=.12;
/** Ponto da trajetória para uma altitude qualquer. Usado pela entrada para ancorar o deck no topo. */
export function flightPoint(landing:Vec3,yaw:number,height:number):Vec3 {
 return {x:landing.x-Math.sin(yaw)*height*DESCENT_DRIFT,y:landing.y+height,z:landing.z-Math.cos(yaw)*height*DESCENT_DRIFT};
}
/** Flight is presentation only. The motor and director remain locked until landing recovery finishes. */
export class MeteorArrival {
 private phase=0;active=false;elapsed=0;impact=false;readonly descent=4;readonly duration=6;
 start(phase=0):void{this.phase=phase;this.active=true;this.elapsed=0;this.impact=false;}
 get height():number{
  if(this.elapsed>=this.descent)return 0;
  const i=DESCENT.findIndex((_,j)=>j<DESCENT.length-1&&this.elapsed<DESCENT[j+1]!.time),a=DESCENT[Math.max(0,i)]!,b=DESCENT[Math.max(0,i)+1]!,span=b.time-a.time,t=clamp((this.elapsed-a.time)/span);
  return Math.max(0,(2*t*t*t-3*t*t+1)*a.height+(t*t*t-2*t*t+t)*span*a.speed+(-2*t*t*t+3*t*t)*b.height+(t*t*t-t*t)*span*b.speed);
 }
 get recovery():number{return clamp((this.elapsed-this.descent)/(this.duration-this.descent));}
 get dive():number{return 1-smooth((this.recovery-.18)/.67);}
 get sway():number{return Math.sin((this.phase+this.elapsed)*2)*.035*smooth(this.height/80);}
 /** Same clock as the live menu, so the freefall motion continues without a jump when Play is pressed. */
 get clock():number{return this.phase+this.elapsed;}
 /** Weight of the procedural freefall motion; fades out close to the ground like the sway. */
 get flutter():number{return smooth(this.height/80);}
 get rootLift():number{return Math.max(0,-Math.cos(Math.PI*this.dive))*1.7;}
 get reveal():number{return smooth(this.elapsed/.85);}
 position(landing:Vec3,yaw:number):Vec3 {return flightPoint(landing,yaw,this.height);}
 update(dt:number,onImpact:()=>void):void{if(!this.active||!Number.isFinite(dt))return;this.elapsed=Math.min(this.duration,this.elapsed+Math.max(0,dt));if(!this.impact&&this.elapsed>=this.descent){this.impact=true;onImpact();}if(this.elapsed>=this.duration)this.active=false;}
}

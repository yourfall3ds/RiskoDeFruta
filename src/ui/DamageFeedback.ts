/** Damage UI state independent of frame rate and of DOM rendering. */
export class DamageFeedback {
 flash=0;hold=0;amount=0;angle=0;trail=1;
 hit(damage:number,beforeFraction:number,direction:{x:number;z:number},yaw:number):void {
  this.amount=this.flash>0?this.amount+Math.ceil(damage):Math.ceil(damage);this.flash=.8;this.hold=.65;this.trail=Math.max(this.trail,beforeFraction);
  this.angle=Math.atan2(-direction.x,-direction.z)-yaw;
 }
 update(dt:number,fraction:number):void {this.flash=Math.max(0,this.flash-dt);this.hold=Math.max(0,this.hold-dt);if(fraction>this.trail)this.trail=fraction;else if(this.hold===0)this.trail+=(fraction-this.trail)*(1-Math.exp(-dt*5));}
}

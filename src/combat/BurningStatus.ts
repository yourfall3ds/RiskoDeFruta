/** A bounded incendiary status. Refreshing flames extends duration, never stacks tick frequency. */
export class BurningStatus {
 remaining=0;private clock=0;owner=0;
 ignite(owner:number,seconds=3):void{if(this.remaining<=0)this.clock=.6;this.owner=owner;this.remaining=Math.max(this.remaining,seconds);}
 update(dt:number,damage:(owner:number,amount:number)=>void):void{if(this.remaining<=0)return;const active=Math.min(dt,this.remaining);this.remaining=Math.max(0,this.remaining-dt);this.clock-=active;while(this.clock<=1e-8){damage(this.owner,3);this.clock+=.6;}}
 clear():void{this.remaining=0;this.clock=0;}
}

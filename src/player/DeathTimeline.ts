/** Fatal reaction completes before presenting choices; independent of combat time. */
export class DeathTimeline {
 state:'idle'|'playing'|'finished'='idle';elapsed=0;readonly duration=2.8;
 get active():boolean{return this.state==='playing';}
 get progress():number{return Math.min(1,this.elapsed/this.duration);}
 start():boolean{if(this.state!=='idle')return false;this.elapsed=0;this.state='playing';return true;}
 update(dt:number):boolean{if(!this.active||!Number.isFinite(dt)||dt<=0)return false;this.elapsed=Math.min(this.duration,this.elapsed+dt);if(this.elapsed+1e-8<this.duration)return false;this.elapsed=this.duration;this.state='finished';return true;}
 reset():void{this.state='idle';this.elapsed=0;}
}

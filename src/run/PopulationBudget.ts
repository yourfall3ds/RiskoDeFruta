/** Slow feedback prevents spawn/retire oscillation while preserving a hard ceiling. */
export class PopulationBudget {
  readonly maximum=32;limit=24;frameMs=16.7;private pressure=0;private headroom=0;
  update(dt:number,frameMs:number):void {
    if(!Number.isFinite(frameMs)||frameMs<1)return;
    this.frameMs+=(Math.min(100,frameMs)-this.frameMs)*Math.min(1,dt*2);
    this.pressure=this.frameMs>25?this.pressure+dt:0;this.headroom=this.frameMs<18.8?this.headroom+dt:0;
    if(this.pressure>3){this.limit=Math.max(12,this.limit-4);this.pressure=0;}
    if(this.headroom>10){this.limit=Math.min(this.maximum,this.limit+2);this.headroom=0;}
  }
}

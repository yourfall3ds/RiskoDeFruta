import {ViewUpdateGate} from '../rendering/ViewUpdateGate';
import type {Vec3} from '../core/contracts';
export interface WorldDetail {center:Vec3;radius:number;visible:boolean;setVisible:(visible:boolean)=>void}
/** Hysteresis prevents repeated show/hide near the boundary; collision stays independent. */
export class DetailVisibility {
 private readonly viewGate=new ViewUpdateGate();hidden=0;
 constructor(private readonly details:readonly WorldDetail[],private readonly hysteresis=10){}
 update(dt:number,viewer:Vec3):void {if(!this.viewGate.ready(dt,viewer))return;let hidden=0;
  for(const detail of this.details){const distance=Math.hypot(viewer.x-detail.center.x,viewer.y-detail.center.y,viewer.z-detail.center.z),limit=detail.radius+(detail.visible?this.hysteresis:0),visible=distance<=limit;if(visible!==detail.visible){detail.visible=visible;detail.setVisible(visible);}if(!visible)hidden++;}
  this.hidden=hidden;
 }
 restore():void {for(const d of this.details)if(!d.visible){d.visible=true;d.setVisible(true);}this.hidden=0;}
}

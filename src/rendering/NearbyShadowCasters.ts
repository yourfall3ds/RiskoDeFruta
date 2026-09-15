import {ViewUpdateGate} from './ViewUpdateGate';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type {Vec3} from '../core/contracts';
/** Owns only this container's casters. Bounds distance also handles meshes batched across a district. */
export class NearbyShadowCasters {
 private readonly selected=new Set<AbstractMesh>();private readonly viewGate=new ViewUpdateGate();private disposed=false;
 constructor(private readonly meshes:readonly AbstractMesh[],private readonly shadows:ShadowGenerator,private readonly limit=16){}
 update(dt:number,viewer:Vec3):void{
  if(this.disposed||!this.viewGate.ready(dt,viewer))return;
  const ranked=this.meshes.filter(m=>m.getTotalVertices()>0&&m.isVisible&&m.visibility>0&&m.isEnabled()&&!/grass|fern|coast_land|connected earth trails|harvest\s+(tomato|watermelon)/i.test(m.name)).map(mesh=>{
   const b=mesh.getBoundingInfo().boundingBox,min=b.minimumWorld,max=b.maximumWorld;
   return {mesh,distance:Math.hypot(Math.max(min.x-viewer.x,0,viewer.x-max.x),Math.max(min.y-viewer.y,0,viewer.y-max.y),Math.max(min.z-viewer.z,0,viewer.z-max.z))};
  }).filter(({mesh,distance})=>distance<=(this.selected.has(mesh)?90:70)).sort((a,b)=>a.distance-b.distance||a.mesh.uniqueId-b.mesh.uniqueId).slice(0,this.limit);
  const next=new Set(ranked.map(r=>r.mesh));
  for(const mesh of this.selected)if(!next.has(mesh)){this.shadows.removeShadowCaster(mesh,false);this.selected.delete(mesh);}
  for(const mesh of next)if(!this.selected.has(mesh)){this.shadows.addShadowCaster(mesh,false);this.selected.add(mesh);}
 }
 get count():number{return this.selected.size;}
 dispose():void{if(this.disposed)return;for(const mesh of this.selected)this.shadows.removeShadowCaster(mesh,false);this.selected.clear();this.disposed=true;}
}

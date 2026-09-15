import type {RegionLoadError} from './RegionResidency';
import {CreatePlane} from '@babylonjs/core/Meshes/Builders/planeBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';
import type {CollisionWorld,BoxCollider} from '../../physics/CollisionWorld';
export const REGION_PASSAGES=[{id:'farm-city',x:50,y:2,z:8,width:8},{id:'solar-frontier',x:180.5,y:7,z:45,width:8},{id:'highland-farms',x:350,y:15,z:280,width:8},{id:'rootwood',x:796,y:26.4,z:342,width:9}] as const;
export function passageCollider(p:typeof REGION_PASSAGES[number]):BoxCollider{return{id:'moving-region-gate-'+p.id,min:{x:p.x-.2,y:p.y-.2,z:p.z-p.width/2},max:{x:p.x+.2,y:p.y+6,z:p.z+p.width/2}};}
export function passageLabel(error?:RegionLoadError):[string,string]{return error?['ROTA INDISPONÍVEL',error.retryIn===null?'AGUARDANDO CONEXÃO':'NOVA TENTATIVA EM '+Math.ceil(error.retryIn)+' s']:['PASSAGEM EM','ESTABILIZAÇÃO'];}
/** Visible stabilization fields occupy existing ground before an unloaded bridge, never the void. */
export class RegionPassages {
 private readonly gates:{id:string;mesh:Mesh;material:StandardMaterial;texture:DynamicTexture;box:BoxCollider;closed:boolean;label:string}[]=[];
 private time=0;
 constructor(scene:Scene,private readonly collision:CollisionWorld){
  for(const p of REGION_PASSAGES){const mesh=CreatePlane('stabilizing-passage-'+p.id,{width:p.width,height:5},scene),material=new StandardMaterial('passage-light-'+p.id,scene),texture=new DynamicTexture('passage-label-'+p.id,{width:1024,height:512},scene,false);
   texture.hasAlpha=true;texture.drawText('PASSAGEM EM',null,215,'bold 72px sans-serif','#dcffff','transparent',true);texture.drawText('ESTABILIZAÇÃO',null,315,'bold 72px sans-serif','#dcffff',null,true);
   material.diffuseTexture=texture;material.emissiveColor=new Color3(.3,.85,1);material.disableLighting=true;material.backFaceCulling=false;material.useAlphaFromDiffuseTexture=true;
   mesh.position.set(p.x,p.y+2.5,p.z);mesh.rotation.y=Math.PI/2;mesh.material=material;mesh.isPickable=false;mesh.setEnabled(false);
   this.gates.push({id:p.id,mesh,material,texture,box:passageCollider(p),closed:false,label:passageLabel().join("|")});
  }
 }
 update(dt:number,ready:readonly string[],errors:readonly RegionLoadError[]=[]):void{this.time+=Math.max(0,dt);for(const gate of this.gates){const closed=!ready.includes(gate.id),error=errors.find(e=>e.id===gate.id),lines=passageLabel(error),label=lines.join('|');
   if(closed&&label!==gate.label){gate.label=label;gate.texture.clear();gate.texture.drawText(lines[0],null,215,'bold 60px sans-serif',error?'#ffe2ae':'#dcffff','transparent',true);gate.texture.drawText(lines[1],null,315,'bold 54px sans-serif',error?'#ffe2ae':'#dcffff',null,true);gate.material.emissiveColor=error?new Color3(1,.55,.15):new Color3(.3,.85,1);}
   if(closed!==gate.closed){gate.closed=closed;gate.mesh.setEnabled(closed);if(closed)this.collision.movingBoxes.push(gate.box);else{const index=this.collision.movingBoxes.indexOf(gate.box);if(index>=0)this.collision.movingBoxes.splice(index,1);}}gate.material.alpha=.65+Math.sin(this.time*2)*.15;}}
 dispose():void{for(const gate of this.gates){const index=this.collision.movingBoxes.indexOf(gate.box);if(index>=0)this.collision.movingBoxes.splice(index,1);gate.mesh.dispose();gate.material.dispose();gate.texture.dispose();}this.gates.length=0;}
}

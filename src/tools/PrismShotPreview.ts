import {Scene} from '@babylonjs/core/scene';
import {Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';

export const PRISM_SHOTS=[
 {name:'Rajada de pulsos',detail:'Três pulsos cianos rápidos · impacto pontual',travel:.38},
 {name:'Lança de íons',detail:'Tiro concentrado · rastro longo · impacto preciso',travel:.20},
 {name:'Granada incendiária',detail:'Cápsula em arco · fogo, brasas e fumaça',travel:1.05},
] as const;
type Effect={node:TransformNode;age:number;life:number;step:(t:number,node:TransformNode)=>void;end:(()=>void)|undefined};

/** Standalone VFX preview; does not apply gameplay damage or select enemy targets. */
export class PrismShotPreview{
 private templates=new Map<string,TransformNode>();
 private effects:Effect[]=[];
 onImpact:((mode:number)=>void)|undefined;
 static async create(scene:Scene){
  const fx=new PrismShotPreview();
  const assets=await LoadAssetContainerAsync('/models/weapons/prism-shots.glb?v=incendiary-2',scene);assets.addAllToScene();
  for(const name of ['Pulse','Lance','Grenade','Impact','Spark','Nova','Debris','Smoke','Ember']){
   const node=assets.transformNodes.find(n=>n.name===name);
   if(!node)throw new Error(`Missing PRISM projectile: ${name}`);
   node.setEnabled(false);fx.templates.set(name,node);
  }
  return fx;
 }
 private emit(name:string,position:Vector3,direction:Vector3,life:number,step:Effect['step'],end?:()=>void){
  // A finite preview budget prevents repeated firing from accumulating meshes.
  if(this.effects.length>=64)this.effects.shift()!.node.dispose();
  const node=this.templates.get(name)!.clone(`fx-${name}`,null)!;
  node.position.copyFrom(position);node.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Right(),direction.normalizeToNew(),new Quaternion());
  node.setEnabled(true);this.effects.push({node,age:0,life,step,end});return node;
 }
 fire(mode:number,origin:Vector3,direction:Vector3){
  const dir=direction.normalizeToNew(),range=mode===1?9:7;
  const orientation=Quaternion.FromUnitVectorsToRef(Vector3.Right(),dir,new Quaternion());
  const end=origin.add(dir.scale(range));
  let trail=0;
  this.emit('Impact',origin,dir,.13,(t,n)=>{n.scaling.setAll((mode===2?.65:.28)*(1-t)+.03);});
  this.emit(mode===0?'Pulse':mode===1?'Lance':'Grenade',origin,dir,PRISM_SHOTS[mode]!.travel,(t,n)=>{
   n.position.copyFrom(Vector3.Lerp(origin,end,t));
   if(mode===2){
    n.position.y+=Math.sin(Math.PI*t)*1.5;n.rotationQuaternion=orientation.multiply(Quaternion.RotationAxis(Vector3.Right(),t*Math.PI*4));n.scaling.setAll(1.4);
    if(t-trail>.06){trail=t;const p=n.position.clone();this.emit('Ember',p,dir,.3,(u,s)=>{s.scaling.setAll((1-u)*.6);});}
   }
   if(mode===1)n.scaling.x=1+Math.sin(Math.PI*t)*6;
  },()=>this.impact(mode,end,dir));
 }
 impact(mode:number,point:Vector3,dir:Vector3){
  this.onImpact?.(mode);
  const radius=mode===2?2.4:mode===1?.85:.4;
  if(mode===2){
   const fire=this.emit('Nova',point,dir,.8,(t,n)=>{n.scaling.setAll(.5+Math.sin(t*Math.PI*.7)*2.6);for(const mesh of n.getChildMeshes())mesh.visibility=Math.min(1,(1-t)*2);});
   for(const mesh of fire.getChildMeshes())mesh.billboardMode=7;
   for(let i=0;i<5;i++){
    const p=point.add(new Vector3(Math.cos(i*2.4)*.4,.1,Math.sin(i*2.4)*.4));
    const smoke=this.emit('Smoke',p,dir,1.6,(t,n)=>{n.position.y=p.y+t*1.7;n.scaling.setAll(.3+t*1.8);for(const mesh of n.getChildMeshes())mesh.visibility=Math.sin(Math.PI*t)*.32;});
    for(const mesh of smoke.getChildMeshes())mesh.billboardMode=7;
   }
  }else this.emit('Impact',point,dir,.32,(t,n)=>{n.scaling.set(.5*(1-t)+.03,radius*(.2+t),radius*(.2+t));for(const mesh of n.getChildMeshes())mesh.visibility=1-t;});
  const count=mode===2?14:mode===1?7:4;
  for(let i=0;i<count;i++){
   const a=i*Math.PI*2/count;
   const spread=new Vector3(Math.cos(a),Math.sin(a),Math.sin(a*2+.7)).normalize().scale(radius);
   this.emit(mode===2?(i%3===0?'Debris':'Ember'):'Spark',point,spread,mode===2?.9:.35+(i%3)*.09,(t,n)=>{n.position.copyFrom(point.add(spread.scale(t)));if(mode===2)n.position.y-=t*t*.8;n.scaling.setAll(1-t);});
  }
 }
 update(dt:number){
  const completed:Effect[]=[];
  for(const fx of [...this.effects]){fx.age+=dt;fx.step(Math.min(1,fx.age/fx.life),fx.node);if(fx.age>=fx.life)completed.push(fx);}
  this.effects=this.effects.filter(fx=>!completed.includes(fx));
  for(const fx of completed){fx.node.dispose();fx.end?.();}
 }
}

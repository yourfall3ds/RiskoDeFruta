import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {PointLight} from '@babylonjs/core/Lights/pointLight';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type {SkillTimeline} from '../combat/SkillTimeline';
import type {DualPistols} from '../combat/DualPistols';
import type {CollisionWorld} from '../physics/CollisionWorld';
import {quaternionFromBasis} from '../physics/SurfaceFrame';

/** Maps the two Blender phases to preparation and voiced action, independent of FPS. */
export function ritualPhase(t:Pick<SkillTimeline,'preparing'|'progress'|'actionProgress'>):number {
 return t.preparing?Math.min(1,Math.max(0,t.progress))*.5:.5+Math.min(1,Math.max(0,t.actionProgress))*.5;
}
/**
 * Choreography and glyphs come from Arcane_Skill_Ritual.blend. Only anchoring and audio sampling happen here.
 *
 * Referencial: a âncora do sigilo vem de `collision.surface`, lido A CADA uso — guardar o
 * referencial no construtor congelaria o `FlatSurface`, porque a cena constrói a aura antes de o
 * mundo do planeta chamar `configurePlanet`. Materiais, emissivas, cores por tier, `ritualPhase`,
 * clipes do `.blend`, luzes e as cópias do ultimate ficam **intocados**; só o "para cima" muda.
 */
export class SkillAura {
 ready=false;error='';private disposed=false;private container:AssetContainer|undefined;
 private ground:TransformNode|undefined;private readonly guns:TransformNode[]=[];private readonly rotations:Quaternion[]=[];
 private readonly lights:PointLight[]=[];private readonly emission:{material:StandardMaterial;color:Color3}[]=[];
 private readonly ultimateCopies:{source:TransformNode;copy:TransformNode;factor:number}[]=[];
 private previousElapsed=-1;private wasActive=false;private readonly origin=Vector3.Zero();
 /**
  * Rotação AUTORADA do sigilo (do GLB ou do clipe deste quadro). No planeta a pose radial é
  * composta com ela — `radial × autorada` — em vez de substituí-la, então o desenho do selo
  * continua o do Blender. Re-lida sempre que o clipe escreve na raiz, para não compor duas vezes.
  */
 private readonly groundAuthored=Quaternion.Identity();
 /** Vertical local da âncora neste quadro. No mundo plano é sempre `(0,1,0)`. */
 private readonly localUp=new Vector3(0,1,0);
 constructor(private readonly scene:Scene,private readonly collision?:CollisionWorld){
  for(let i=0;i<3;i++){const light=new PointLight('arcane-skill-light-'+i,Vector3.Zero(),scene);light.diffuse=new Color3(.035,.82,1);light.range=i===2?4:2.8;light.intensity=0;this.lights.push(light);}
 }
 async load(loader=()=>LoadAssetContainerAsync('/models/arcane-skill-ritual.glb',this.scene)):Promise<void>{
  try{const container=await loader();if(this.disposed){container.dispose();return;}this.container=container;container.addAllToScene();
   for(const clip of container.animationGroups)clip.stop();
   for(const name of ['GroundSigilRoot','RightAuraRoot','LeftAuraRoot']){
    const root=container.transformNodes.find(n=>n.name===name);if(!root)throw Error('Ritual sem '+name);
    root.setParent(null,true);root.setEnabled(false);
    if(name==='GroundSigilRoot'){this.ground=root;this.groundAuthored.copyFrom(root.rotationQuaternion??Quaternion.Identity());}
    else{this.guns.push(root);this.rotations.push(root.rotationQuaternion?.clone()??Quaternion.Identity());}
   }
   for(const mesh of container.meshes){mesh.isPickable=false;mesh.receiveShadows=false;mesh.alwaysSelectAsActiveMesh=true;}
   for(const original of [...container.materials]){const material=new StandardMaterial(original.name+' ritual glow',this.scene);material.disableLighting=true;material.backFaceCulling=false;material.diffuseColor=Color3.Black();material.specularColor=Color3.Black();material.emissiveColor=original instanceof PBRMaterial?original.emissiveColor.clone():new Color3(.05,1,1);for(const mesh of container.meshes)if(mesh.material===original)mesh.material=material;this.emission.push({material,color:material.emissiveColor.clone()});}
   for(const [name,factor] of [['Ground_Runewheel',1.28],['Ground_SixfoldWeave',1.48]] as const){const source=container.meshes.find(m=>m.name===name);if(source){const copy=source.clone(name+' ultimate crown',this.ground!);if(copy){copy.isPickable=false;copy.setEnabled(false);this.ultimateCopies.push({source,copy,factor});}}}
   this.ready=true;
  }catch(error){if(!this.disposed)this.error='Ritual arcano: '+String(error);}
 }
 update(t:SkillTimeline,position:Vector3,weapons:DualPistols):void{
  const active=t.active&&this.ready;
  if(active&&(!this.wasActive||t.elapsed<this.previousElapsed)){
   /**
    * Âncora do selo no piso real. `support(p, .4, Infinity)` é o `groundAt(x, z, y + .4)` de antes,
    * agora sondado ao longo da vertical LOCAL; `offset < 6` é o mesmo `y > position.y − 6`.
    */
   this.origin.copyFrom(position);
   const support=this.collision?.surface.support({x:position.x,y:position.y,z:position.z},.4,Infinity);
   if(support&&support.offset<6)this.origin.set(support.point.x,support.point.y,support.point.z);
  }
  const up=this.collision?.surface.up(this.origin);
  if(up)this.localUp.set(up.x,up.y,up.z);else this.localUp.set(0,1,0);
  this.wasActive=active;this.previousElapsed=t.elapsed;
  const roots=[this.ground,...this.guns];for(const root of roots)root?.setEnabled(active);
  const fade=active?Math.min(1,t.progress*3)*Math.min(1,(1-t.actionProgress)*8):0;
  if(!active){for(const light of this.lights)light.intensity=0;for(const x of this.ultimateCopies)x.copy.setEnabled(false);return;}
  const color=Color3.FromHexString(t.tier===1?'#ffd365':t.tier===2?'#ff6756':'#b880ff');for(const light of this.lights)light.diffuse.copyFrom(color);
  const phase=ritualPhase(t);
  for(const clip of this.container!.animationGroups)for(const track of clip.targetedAnimations){
   const value:unknown=track.animation.evaluate(clip.from+(clip.to-clip.from)*phase),node=track.target as TransformNode;
   if(value instanceof Quaternion){node.rotationQuaternion=value.clone();
    // O clipe é a fonte da rotação autorada da raiz do selo; guardar aqui impede compor duas vezes.
    if(node===this.ground)this.groundAuthored.copyFrom(value);}
   else if(value instanceof Vector3){if(track.animation.targetProperty==='scaling')node.scaling.copyFrom(value);else if(track.animation.targetProperty==='position')node.position.copyFrom(value);}
  }
  this.ground!.position.copyFrom(this.origin).addInPlaceFromFloats(this.localUp.x*.035,this.localUp.y*.035,this.localUp.z*.035);
  // No planeta o selo deita no plano tangente; no plano nada é escrito e a pose é a de sempre.
  if(this.collision?.spherical){
   const basis=this.collision.surface.basis(this.origin,{x:0,y:0,z:1});
   const radial=quaternionFromBasis(basis.right,basis.up,basis.forward);
   this.ground!.rotationQuaternion=new Quaternion(radial.x,radial.y,radial.z,radial.w).multiply(this.groundAuthored);
  }
  for(let i=0;i<2;i++){const pose=weapons.muzzlePose(i as 0|1),gun=this.guns[i]!;gun.position.copyFrom(pose.position);
   gun.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Up(),pose.direction,Quaternion.Identity()).multiply(this.rotations[i]!);
   this.lights[i]!.position.copyFrom(pose.position);this.lights[i]!.intensity=fade*(t.preparing?2.6:1.4);
  }
  this.lights[2]!.position.copyFrom(this.origin).addInPlaceFromFloats(this.localUp.x*.45,this.localUp.y*.45,this.localUp.z*.45);this.lights[2]!.intensity=fade*1.4;
  for(const {material} of this.emission)material.emissiveColor.copyFrom(color).scaleInPlace(fade*(.88+.12*Math.sin(t.elapsed*17)));
  for(const mesh of this.container!.meshes)mesh.visibility=fade;
  for(const {source,copy,factor} of this.ultimateCopies){copy.setEnabled(t.tier===3);copy.position.copyFrom(source.position).addInPlaceFromFloats(0,.025,0);copy.scaling.copyFrom(source.scaling).scaleInPlace(factor);copy.rotationQuaternion=Quaternion.RotationAxis(Vector3.Up(),t.elapsed*(factor>1.3?-1:1)*.7).multiply(source.rotationQuaternion??Quaternion.Identity());}
 }
 dispose():void{this.disposed=true;for(const root of [this.ground,...this.guns])root?.dispose();this.container?.dispose();for(const light of this.lights)light.dispose();for(const entry of this.emission)entry.material.dispose();}
}

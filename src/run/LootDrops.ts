import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {CreatePlane} from '@babylonjs/core/Meshes/Builders/planeBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
import {PERK_ICONS} from '../ui/PerkIcons';
import type {ItemDefinition} from './RunProgression';

export interface GroundLoot {item:ItemDefinition;root:TransformNode;start:Vector3;landing:Vector3;age:number;landed:boolean;waveField?:string}
/** A chest owns one drop. No expiry: an opened chest never silently loses its reward. */
export class LootDrops {
 readonly active:GroundLoot[]=[];
 private readonly materials=new Map<number,StandardMaterial>();
 constructor(private readonly scene:Scene,private readonly world:CollisionWorld){}
 private landing(origin:Vec3,toward:Vec3):Vector3 {
  const heading=Math.atan2(toward.x-origin.x,toward.z-origin.z);
  for(const radius of [1.5,1.9,1.1])for(const offset of [0,.65,-.65,1.3,-1.3,Math.PI]){
   const x=origin.x+Math.sin(heading+offset)*radius,z=origin.z+Math.cos(heading+offset)*radius;
   const y=this.world.groundAt(x,z,origin.y+.25);
   if(!Number.isFinite(y)||y<origin.y-.6)continue;
   const blocked=this.world.nearbyBoxes(x,z,.3).some(b=>b.min.x<x+.3&&b.max.x>x-.3&&b.min.z<z+.3&&b.max.z>z-.3&&b.max.y>y+.2&&b.min.y<y+1.5);
   if(!blocked)return new Vector3(x,y+.43,z);
  }
  // If every surrounding floor is obstructed, keep the reward reachable above its chest.
  return new Vector3(origin.x,origin.y+1.1,origin.z);
 }
 eject(item:ItemDefinition,origin:Vec3,toward:Vec3):GroundLoot {
  let material=this.materials.get(item.icon);
  if(!material){material=new StandardMaterial(`loot-icon-${item.icon}`,this.scene);const texture=new Texture(`/perks/${PERK_ICONS[item.icon]}`,this.scene);texture.hasAlpha=true;material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;material.emissiveColor=new Color3(.7,.7,.7);material.specularColor=Color3.Black();material.backFaceCulling=false;material.transparencyMode=StandardMaterial.MATERIAL_ALPHATESTANDBLEND;this.materials.set(item.icon,material);}
  const root=new TransformNode(`dropped-${item.id}`,this.scene);
  // A double-sided RGBA card rotates as the original flat item illustration.
  for(let i=0;i<1;i++){const card=CreatePlane(`loot-${item.id}-${i}`,{size:.65},this.scene);card.parent=root;card.rotation.y=i*Math.PI/2;card.material=material;card.isPickable=false;}
  const start=new Vector3(origin.x,origin.y+.78,origin.z);root.position.copyFrom(start);
  const drop={item,root,start,landing:this.landing(origin,toward),age:0,landed:false};this.active.push(drop);return drop;
 }
 update(dt:number):void {
  for(const d of this.active){d.age+=dt;const t=Math.min(1,d.age/.85);Vector3.LerpToRef(d.start,d.landing,t,d.root.position);d.root.position.y+=Math.sin(Math.PI*t)*1.15;d.landed=t>=1;d.root.rotation.y=d.age*1.65;if(d.landed)d.root.position.y+=Math.sin((d.age-.85)*2.4)*.035;}
 }
 nearest(position:Vec3):GroundLoot|undefined {
  return this.active.filter(d=>d.landed&&Math.abs(position.y-(d.landing.y-.43))<1.8&&Math.hypot(position.x-d.landing.x,position.z-d.landing.z)<1.8).sort((a,b)=>Math.hypot(position.x-a.landing.x,position.z-a.landing.z)-Math.hypot(position.x-b.landing.x,position.z-b.landing.z))[0];
 }
 take(position:Vec3):ItemDefinition|undefined {const drop=this.nearest(position);if(!drop)return;this.active.splice(this.active.indexOf(drop),1);drop.root.dispose();return drop.item;}
 clear():void {for(const d of this.active)d.root.dispose();this.active.length=0;}
 dispose():void {this.clear();for(const m of this.materials.values())m.dispose(false,true);this.materials.clear();}
}

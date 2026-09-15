import {CreateCylinder} from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
/** Eight hand-anchored laser beams, reused each frame; damage belongs to the attack simulation. */
export class EnemyLaser {
 private readonly material:StandardMaterial;private readonly core:StandardMaterial;
 private readonly slots;private used=0;
 constructor(scene:Scene){this.material=new StandardMaterial('carrot-laser-aura',scene);this.material.emissiveColor=new Color3(2,.3,.015);this.material.disableLighting=true;this.material.alpha=.38;this.core=new StandardMaterial('carrot-laser-core',scene);this.core.emissiveColor=new Color3(3,1.4,.5);this.core.disableLighting=true;this.slots=Array.from({length:8},()=>[this.material,this.core].map((material,i)=>{const mesh=CreateCylinder('robotic-hand-laser-'+i,{height:1,diameter:1,tessellation:8},scene);mesh.material=material;mesh.isPickable=false;mesh.setEnabled(false);return mesh;}));}
 begin():void {this.used=0;for(const slot of this.slots)for(const mesh of slot)mesh.setEnabled(false);}
 show(from:Vector3,to:Vector3,power:number):void{const slot=this.slots[this.used++];if(!slot)return;const delta=to.subtract(from),length=delta.length();if(length<.01)return;for(let i=0;i<slot.length;i++){const mesh=slot[i]!,width=(i===0?.24:.055)*power;mesh.setEnabled(true);mesh.position.copyFrom(from.add(to).scale(.5));mesh.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Up(),delta.scale(1/length),Quaternion.Identity());mesh.scaling.set(width,length,width);}}
 dispose():void{for(const s of this.slots)for(const m of s)m.dispose();this.material.dispose();this.core.dispose();}
}

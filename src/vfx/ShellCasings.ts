import {CreateCylinder} from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {WeaponAudio} from '../audio/WeaponAudio';
interface Casing {mesh:Mesh;velocity:Vector3;age:number;bounces:number;active:boolean;ground:number}
/** Fixed pool; contact-triggered recordings, no extra rigid bodies or shadow casters. */
export class ShellCasings {
 private readonly entries:Casing[]=[];private cursor=0;private readonly material:PBRMaterial;
 constructor(scene:Scene,private readonly world:CollisionWorld|undefined,private readonly audio:WeaponAudio){this.material=new PBRMaterial('spent-brass',scene);this.material.albedoColor=new Color3(.58,.36,.09);this.material.metallic=.85;this.material.roughness=.3;for(let i=0;i<48;i++){const mesh=CreateCylinder('spent-casing',{height:.045,diameter:.017,tessellation:6},scene);mesh.material=this.material;mesh.isPickable=false;mesh.setEnabled(false);this.entries.push({mesh,velocity:Vector3.Zero(),age:0,bounces:0,active:false,ground:0});}}
 eject(position:Vector3,forward:Vector3,side:0|1):void{const c=this.entries[this.cursor++%this.entries.length]!,sign=side===0?1:-1;c.mesh.position.copyFrom(position).subtractInPlace(forward.scale(.19));c.velocity.set(forward.z*sign*(1.3+this.cursor%3*.15),1.6,-forward.x*sign*1.3);c.age=0;c.bounces=0;c.active=true;c.ground=this.world?.groundAt(position.x,position.z,position.y)??0;c.mesh.setEnabled(true);}
 update(dt:number):void{for(const c of this.entries){if(!c.active)continue;c.age+=dt;if(c.age>5||c.mesh.position.y<-35){c.active=false;c.mesh.setEnabled(false);continue;}if(c.bounces>=2)continue;const previousY=c.mesh.position.y;c.velocity.y-=14*dt;c.mesh.position.addInPlace(c.velocity.scale(dt));c.mesh.rotation.x+=dt*13;c.mesh.rotation.z+=dt*8;const ground=this.world?.groundAt(c.mesh.position.x,c.mesh.position.z,previousY+.1)??c.ground;if(Number.isFinite(ground)&&c.mesh.position.y<=ground+.014&&c.velocity.y<0){c.mesh.position.y=ground+.014;c.velocity.y=Math.abs(c.velocity.y)*.25;c.velocity.x*=.4;c.velocity.z*=.4;c.bounces++;this.audio.casing?.(c.bounces===1?1:.35,c.mesh.position.x);}}}
 clear():void {for(const c of this.entries){c.active=false;c.mesh.setEnabled(false);}this.cursor=0;}
 dispose():void{for(const c of this.entries)c.mesh.dispose();this.material.dispose();}
}

import {CreateCylinder} from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {WeaponAudio} from '../audio/RecordedAudio';
import {radialSurfaceOf,type EnemySurface} from '../enemies/EnemySpace';
interface Casing {mesh:Mesh;velocity:Vector3;age:number;bounces:number;active:boolean;ground:number;up:Vector3}
/** Fixed pool; contact-triggered recordings, no extra rigid bodies or shadow casters. */
export class ShellCasings {
 private readonly entries:Casing[]=[];private cursor=0;private readonly material:PBRMaterial;
 /**
  * `surface` é o 4º argumento OPCIONAL: sem ele o casquilho cai em `−Y` e bate no `groundAt`, que é
  * exatamente a fazenda de hoje. `DualPistols` (que eu não edito) só precisa repassá-lo quando o
  * mundo tiver superfície radial.
  */
 constructor(scene:Scene,private readonly world:CollisionWorld|undefined,private readonly audio:WeaponAudio,surface?:EnemySurface){this.surface=radialSurfaceOf(surface);this.material=new PBRMaterial('spent-brass',scene);this.material.albedoColor=new Color3(.58,.36,.09);this.material.metallic=.85;this.material.roughness=.3;for(let i=0;i<48;i++){const mesh=CreateCylinder('spent-casing',{height:.045,diameter:.017,tessellation:6},scene);mesh.material=this.material;mesh.isPickable=false;mesh.setEnabled(false);this.entries.push({mesh,velocity:Vector3.Zero(),age:0,bounces:0,active:false,ground:0,up:new Vector3(0,1,0)});}}
 private surface:EnemySurface|undefined;
 useSurface(surface:EnemySurface|undefined):void {this.surface=radialSurfaceOf(surface);}
 eject(position:Vector3,forward:Vector3,side:0|1):void{const c=this.entries[this.cursor++%this.entries.length]!,sign=side===0?1:-1;c.mesh.position.copyFrom(position).subtractInPlace(forward.scale(.19));
  const up=this.surface?.up(position);c.up.copyFromFloats(up?.x??0,up?.y??1,up?.z??0);
  // Mesma ejeção lateral de sempre; o que muda é que "para cima" é a vertical local. A parte
  // lateral é projetada no plano tangente para não enterrar o casquilho nem atirá-lo ao céu.
  const sx=forward.z*sign*(1.3+this.cursor%3*.15),sz=-forward.x*sign*1.3;
  const along=this.surface?sx*c.up.x+sz*c.up.z:0;
  c.velocity.set(sx-c.up.x*along+c.up.x*1.6,-c.up.y*along+c.up.y*1.6,sz-c.up.z*along+c.up.z*1.6);
  c.age=0;c.bounces=0;c.active=true;c.ground=this.world?.groundAt(position.x,position.z,position.y)??0;c.mesh.setEnabled(true);}
 update(dt:number):void{for(const c of this.entries){if(!c.active)continue;c.age+=dt;if(c.age>5||(!this.surface&&c.mesh.position.y<-35)){c.active=false;c.mesh.setEnabled(false);continue;}if(c.bounces>=2)continue;
  const previousY=c.mesh.position.y,fall=14*dt;
  c.velocity.set(c.velocity.x-c.up.x*fall,c.velocity.y-c.up.y*fall,c.velocity.z-c.up.z*fall);
  c.mesh.position.addInPlaceFromFloats(c.velocity.x*dt,c.velocity.y*dt,c.velocity.z*dt);c.mesh.rotation.x+=dt*13;c.mesh.rotation.z+=dt*8;
  if(this.surface){
   const support=this.surface.support(c.mesh.position,.1,20),along=c.velocity.x*c.up.x+c.velocity.y*c.up.y+c.velocity.z*c.up.z;
   if(!support||this.surface.heightGap(c.mesh.position,support.point)>.014||along>=0)continue;
   c.mesh.position.copyFromFloats(support.point.x+c.up.x*.014,support.point.y+c.up.y*.014,support.point.z+c.up.z*.014);
   c.velocity.set((c.velocity.x-c.up.x*along)*.4+c.up.x*Math.abs(along)*.25,(c.velocity.y-c.up.y*along)*.4+c.up.y*Math.abs(along)*.25,(c.velocity.z-c.up.z*along)*.4+c.up.z*Math.abs(along)*.25);
   c.bounces++;this.audio.casing?.(c.bounces===1?1:.35,c.mesh.position.x);continue;
  }
  const ground=this.world?.groundAt(c.mesh.position.x,c.mesh.position.z,previousY+.1)??c.ground;if(Number.isFinite(ground)&&c.mesh.position.y<=ground+.014&&c.velocity.y<0){c.mesh.position.y=ground+.014;c.velocity.y=Math.abs(c.velocity.y)*.25;c.velocity.x*=.4;c.velocity.z*=.4;c.bounces++;this.audio.casing?.(c.bounces===1?1:.35,c.mesh.position.x);}}}
 clear():void {for(const c of this.entries){c.active=false;c.mesh.setEnabled(false);}this.cursor=0;}
 dispose():void{for(const c of this.entries)c.mesh.dispose();this.material.dispose();}
}

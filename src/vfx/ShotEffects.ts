import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3,Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Pool } from '../core/Pool';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Constants } from '@babylonjs/core/Engines/constants';
interface Effect { mesh: Mesh; time: number; duration: number; from:Vector3; direction:Vector3; distance:number; tracer:boolean;travel:boolean }
export class ShotEffects {
  readonly pool: Pool<Effect>;
  private readonly active: Effect[]=[];
  private readonly flashes: {mesh:Mesh;time:number}[]=[];
  private readonly marks:{mesh:Mesh;time:number}[]=[];private nextMark=0;
  constructor(scene: Scene) {
    const material=new StandardMaterial('shot-light',scene);material.disableLighting=true;material.emissiveColor=new Color3(3,1.8,.4);
    this.pool=new Pool<Effect>(128,()=>{const mesh=CreateSphere('impact-spark',{diameter:1,segments:3},scene);mesh.material=material;mesh.isPickable=false;return {mesh,time:0,duration:0,from:Vector3.Zero(),direction:Vector3.Zero(),distance:0,tracer:false,travel:false};},effect=>{effect.mesh.setEnabled(false);effect.time=0;effect.mesh.visibility=1;effect.mesh.scaling.setAll(1);effect.mesh.rotationQuaternion=null;effect.tracer=false;effect.travel=false;});
    if(!scene.getEngine().getRenderingCanvas())return;
    const texture=new DynamicTexture('muzzle-flash-atlas',128,scene,false);texture.hasAlpha=true;
    const ctx=texture.getContext();ctx.clearRect(0,0,128,128);
    const glow=ctx.createRadialGradient(64,64,0,64,64,60);glow.addColorStop(0,'#ffffff');glow.addColorStop(.13,'#fff6c7');glow.addColorStop(.36,'#ffba4766');glow.addColorStop(1,'#ff820000');ctx.fillStyle=glow;ctx.fillRect(0,0,128,128);
    ctx.fillStyle='#fff4c4';ctx.beginPath();for(let i=0;i<16;i++){const radius=i%2?7:34+(i%4)*9;const angle=i/16*Math.PI*2;const x=64+Math.cos(angle)*radius,y=64+Math.sin(angle)*radius;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.closePath();ctx.fill();texture.update();
    const flashMaterial=new StandardMaterial('muzzle-flash',scene);flashMaterial.disableLighting=true;flashMaterial.emissiveTexture=texture;flashMaterial.opacityTexture=texture;flashMaterial.alphaMode=Constants.ALPHA_ADD;flashMaterial.backFaceCulling=false;
    for(let i=0;i<8;i++){const mesh=CreatePlane('muzzle-flash',{size:1},scene);mesh.material=flashMaterial;mesh.billboardMode=7;mesh.isPickable=false;mesh.setEnabled(false);this.flashes.push({mesh,time:0});}
    const holes=new DynamicTexture('bullet-impact-decal',128,scene,false);holes.hasAlpha=true;const paint=holes.getContext();paint.clearRect(0,0,128,128);
    const scorch=paint.createRadialGradient(64,64,5,64,64,60);scorch.addColorStop(0,'#080706ff');scorch.addColorStop(.25,'#15120fff');scorch.addColorStop(.42,'#9c8976de');scorch.addColorStop(.58,'#2d211dd0');scorch.addColorStop(1,'#261b1200');paint.fillStyle=scorch;paint.fillRect(0,0,128,128);paint.strokeStyle='#1c151bcc';paint.lineWidth=2;
    for(let i=0;i<9;i++){const a=i*2.4;paint.beginPath();paint.moveTo(64+Math.sin(a)*15,64+Math.cos(a)*15);paint.lineTo(64+Math.sin(a+.12)*45,64+Math.cos(a+.12)*45);paint.stroke();}holes.update();
    const markMaterial=new StandardMaterial('surface-bullet-marks',scene);markMaterial.diffuseTexture=holes;markMaterial.opacityTexture=holes;markMaterial.specularColor=Color3.Black();markMaterial.backFaceCulling=false;markMaterial.zOffset=-2;
    for(let i=0;i<64;i++){const mesh=CreatePlane('bullet-impact-mark',{size:.18},scene);mesh.material=markMaterial;mesh.isPickable=false;mesh.setEnabled(false);this.marks.push({mesh,time:0});}
  }
  mark(position:Vector3,normal:Vector3):void {const item=this.marks[this.nextMark++%this.marks.length];if(!item)return;item.mesh.position.copyFrom(position).addInPlace(normal.scale(.004));item.mesh.rotationQuaternion=Quaternion.FromUnitVectorsToRef(new Vector3(0,0,-1),normal.normalizeToNew(),Quaternion.Identity());item.mesh.visibility=1;item.mesh.setEnabled(true);item.time=40;}
  get decalCount():number{return this.marks.filter(x=>x.time>0).length;}
  muzzle(position:Vector3):void {const flash=this.flashes.find(f=>f.time===0);if(!flash)return;flash.mesh.position.copyFrom(position);flash.mesh.scaling.setAll(.22);flash.mesh.visibility=1;flash.mesh.setEnabled(true);flash.time=.045;}
  impact(position:Vector3,normal:Vector3):void {
    for(let i=0;i<5;i++){
      const effect=this.pool.acquire();if(!effect)return;
      effect.mesh.position.copyFrom(position);effect.mesh.scaling.set(.012,.07,.012);effect.mesh.setEnabled(true);effect.duration=.10+i*.012;
      effect.direction.copyFrom(normal).addInPlaceFromFloats(Math.sin(i*2.4)*.9,.4+Math.cos(i*1.7)*.5,Math.cos(i*2.4)*.9).scaleInPlace(2.8);
      effect.mesh.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Up(),effect.direction.normalizeToNew(),new Quaternion());this.active.push(effect);
    }
  }
  burst(position: Vector3,size=.12,duration=.08): void {
    const effect=this.pool.acquire();if(!effect)return;
    effect.mesh.position.copyFrom(position);effect.direction.setAll(0);effect.mesh.scaling.setAll(size);effect.mesh.setEnabled(true);effect.duration=duration;this.active.push(effect);
  }
  tracer(from: Vector3,to: Vector3): void {
    const effect=this.pool.acquire();if(!effect)return;
    const delta=to.subtract(from);const length=delta.length();
    effect.from.copyFrom(from);effect.direction.copyFrom(delta).normalize();effect.distance=length;effect.tracer=true;
    const segment=length;effect.mesh.position.copyFrom(from).addInPlace(effect.direction.scale(segment*.5));
    effect.mesh.scaling.set(.045,segment,.045);effect.mesh.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Up(),effect.direction,new Quaternion());
    effect.mesh.setEnabled(true);effect.duration=Math.max(.12,length/350+.045);this.active.push(effect);
  }
  arcTrail(from:Vector3,to:Vector3):void {
    const e=this.pool.acquire();if(!e)return;const delta=to.subtract(from);e.from.copyFrom(from);e.direction.copyFrom(delta).normalize();e.distance=delta.length();e.tracer=true;e.mesh.position.copyFrom(from).addInPlace(delta.scale(.5));e.mesh.scaling.set(.065,e.distance,.065);e.mesh.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Up(),e.direction,new Quaternion());e.mesh.setEnabled(true);e.duration=.085;this.active.push(e);
  }
  piercer(from:Vector3,to:Vector3):void {
    const effect=this.pool.acquire();if(!effect)return;const delta=to.subtract(from);effect.from.copyFrom(from);effect.direction.copyFrom(delta).normalize();effect.distance=delta.length();effect.tracer=true;effect.travel=true;effect.mesh.position.copyFrom(from);effect.mesh.scaling.set(.16,.6,.16);effect.mesh.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Up(),effect.direction,new Quaternion());effect.mesh.setEnabled(true);effect.duration=effect.distance/95+.08;this.active.push(effect);
  }
  update(dt: number): void {
    for(const mark of this.marks)if(mark.time>0){mark.time=Math.max(0,mark.time-dt);mark.mesh.visibility=Math.min(1,mark.time/3);mark.mesh.setEnabled(mark.time>0);}
    for(const flash of this.flashes)if(flash.time>0){flash.time=Math.max(0,flash.time-dt);flash.mesh.visibility=flash.time/.045;flash.mesh.setEnabled(flash.time>0);}
    for(let i=this.active.length-1;i>=0;i--){const e=this.active[i]!;e.time+=dt;
      if(e.tracer){const head=e.travel?Math.min(e.distance,e.time*95):e.distance;const tail=e.travel?Math.max(0,head-2.3):0;e.mesh.position.copyFrom(e.from).addInPlace(e.direction.scale((head+tail)*.5));e.mesh.scaling.y=Math.max(.02,head-tail);}
      else {e.mesh.position.addInPlace(e.direction.scale(dt));e.direction.y-=dt*8;}
      e.mesh.visibility=Math.max(0,1-e.time/e.duration);
      if(e.time>=e.duration){this.pool.release(e);this.active.splice(i,1);}}
  }
  clear():void {for(const effect of this.active)this.pool.release(effect);this.active.length=0;for(const f of [...this.flashes,...this.marks]){f.time=0;f.mesh.setEnabled(false);}this.nextMark=0;}
  dispose(): void {this.pool.releaseAll();this.active.length=0;for(const flash of [...this.flashes,...this.marks])flash.mesh.dispose();}
}



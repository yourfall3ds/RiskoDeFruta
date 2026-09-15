import '@babylonjs/core/Meshes/thinInstanceMesh';
import {CreatePlane} from '@babylonjs/core/Meshes/Builders/planeBuilder';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../../core/contracts';
export interface FarCanopy {center:Vec3;size:number;visible:boolean}
/** A single GPU batch of camera-facing captures of the authored tree, only beyond detailed LODs. */
export class FarCanopies {
 readonly mesh;
 private readonly material:PBRMaterial;
 private readonly texture:Texture;
 private readonly matrices:Float32Array;
 private readonly matrix=Matrix.Identity();
 private readonly rotation=Quaternion.Identity();
 private readonly scale=Vector3.One();
 private readonly position=Vector3.Zero();
 private disposed=false;
 constructor(scene:Scene,capacity:number,texture?:Texture){
  this.mesh=CreatePlane('Rootwood distant textured canopies',{size:1},scene);
  this.mesh.isPickable=false;this.mesh.isVisible=false;
  this.material=new PBRMaterial('Baked original orchard canopy',scene);
  this.texture=texture??new Texture('/textures/orchard-canopy-far.png',scene);
  this.texture.hasAlpha=true;this.texture.wrapU=this.texture.wrapV=Texture.CLAMP_ADDRESSMODE;
  this.material.albedoTexture=this.texture;this.material.unlit=true;this.material.backFaceCulling=false;
  this.material.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHATEST;this.material.alphaCutOff=.3;
  this.mesh.material=this.material;
  this.matrices=new Float32Array(Math.max(1,capacity)*16);
  this.mesh.thinInstanceSetBuffer('matrix',this.matrices,16,false);this.mesh.thinInstanceCount=0;
 }
 update(canopies:readonly FarCanopy[],viewer:Vec3):void{
  if(this.disposed)return;let count=0;
  for(const canopy of canopies){
   if(!canopy.visible||Math.hypot(viewer.x-canopy.center.x,viewer.z-canopy.center.z)>1100)continue;
   if(count>=this.matrices.length/16)throw Error('Far canopy capacity exceeded');
   this.scale.setAll(canopy.size);this.position.copyFromFloats(canopy.center.x,canopy.center.y,canopy.center.z);
   Quaternion.RotationYawPitchRollToRef(Math.atan2(viewer.x-canopy.center.x,viewer.z-canopy.center.z),0,0,this.rotation);
   Matrix.ComposeToRef(this.scale,this.rotation,this.position,this.matrix);this.matrix.copyToArray(this.matrices,count++*16);
  }
  this.mesh.thinInstanceCount=count;this.mesh.isVisible=count>0;
  if(count){this.mesh.thinInstanceBufferUpdated('matrix');this.mesh.thinInstanceRefreshBoundingInfo(true);}
 }
 dispose():void{if(this.disposed)return;this.disposed=true;this.mesh.dispose();this.material.dispose();this.texture.dispose();}
}

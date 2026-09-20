import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {CreatePlane} from '@babylonjs/core/Meshes/Builders/planeBuilder';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import type {Scene} from '@babylonjs/core/scene';

const vertexSource=`precision highp float;
attribute vec3 position; attribute vec2 uv;
uniform mat4 worldViewProjection; varying vec2 vUV;
void main(){vUV=uv;gl_Position=worldViewProjection*vec4(position,1.0);}`;
const fragmentSource=`precision highp float;
varying vec2 vUV; uniform sampler2D atlas; uniform float progress;
vec4 sampleFrame(float f){
 vec2 cell=vec2(mod(f,4.0),3.0-floor(f/4.0));
 return texture2D(atlas,(cell+mix(vec2(.006),vec2(.994),vUV))*.25);
}
void main(){
 float frame=min(15.0,progress*16.0);
 vec4 a=sampleFrame(floor(frame)),b=sampleFrame(min(15.0,floor(frame)+1.0));
 float blend=fract(frame);float opacity=mix(a.a,b.a,blend);
 vec3 rgb=mix(a.rgb*a.a,b.rgb*b.a,blend)/max(.001,opacity);
 opacity*=1.0-smoothstep(.72,1.0,progress);
 if(opacity<.008)discard;
 gl_FragColor=vec4(rgb,opacity);
}`;

/** A shared atlas, at most eight quads, and radial smoke lift. No per-frame mesh allocation. */
export class RocketExplosion {
 private readonly texture:Texture;
 private readonly live:{mesh:Mesh;material:ShaderMaterial;at:Vector3;up:Vector3;age:number;size:number}[]=[];
 constructor(private readonly scene:Scene){
  this.texture=new Texture('/textures/weapons/prism-explosion-atlas.png',scene,false,true,Texture.BILINEAR_SAMPLINGMODE);
  this.texture.hasAlpha=true;this.texture.wrapU=Texture.CLAMP_ADDRESSMODE;this.texture.wrapV=Texture.CLAMP_ADDRESSMODE;
 }
 emit(at:Vector3,up:Vector3,radius:number):void {
  if(this.live.length>=8){const old=this.live.shift()!;old.mesh.dispose();old.material.dispose();}
  const mesh=CreatePlane('rocket-fire-smoke',{size:1},this.scene);
  mesh.billboardMode=Mesh.BILLBOARDMODE_ALL;mesh.isPickable=false;
  const material=new ShaderMaterial('rocket-fire-smoke',this.scene,{vertexSource,fragmentSource},{attributes:['position','uv'],uniforms:['worldViewProjection','progress'],samplers:['atlas'],needAlphaBlending:true});
  material.backFaceCulling=false;material.disableDepthWrite=true;
  material.setTexture('atlas',this.texture);material.setFloat('progress',0);mesh.material=material;
  const size=Math.max(1,radius*2.1),vertical=up.clone().normalize();
  mesh.scaling.setAll(size);mesh.position.copyFrom(at).addInPlace(vertical.scale(size*.32));
  this.live.push({mesh,material,at:at.clone(),up:vertical,age:0,size});
 }
 update(dt:number):void {
  for(let i=this.live.length-1;i>=0;i--){const fx=this.live[i]!;fx.age+=Math.max(0,dt);
   const t=fx.age/1.8;
   if(t>=1){fx.mesh.dispose();fx.material.dispose();this.live.splice(i,1);continue;}
   fx.material.setFloat('progress',t);
   fx.mesh.position.copyFrom(fx.at).addInPlace(fx.up.scale(fx.size*.32+t*.7));
  }
 }
 clear():void{for(const fx of this.live){fx.mesh.dispose();fx.material.dispose();}this.live.length=0;}
 dispose():void{this.clear();this.texture.dispose();}
}

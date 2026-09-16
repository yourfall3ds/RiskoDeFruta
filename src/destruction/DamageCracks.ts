import {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {Scene} from '@babylonjs/core/scene';
import {RawTexture} from '@babylonjs/core/Materials/Textures/rawTexture';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';

export const CRACK_STAGES=8;
/** Original, pixel-stepped fracture network. Later stages retain every earlier fissure. */
export function crackPixels(stage:number,size=128):Uint8Array {
  const pixels=new Uint8Array(size*size*4);
  const count=Math.max(0,Math.min(CRACK_STAGES,Math.ceil(stage)));
  const paint=(x:number,y:number,alpha:number)=>{
    const i=(((Math.round(y)%size+size)%size)*size+(Math.round(x)%size+size)%size)*4;
    pixels[i]=22;pixels[i+1]=17;pixels[i+2]=12;pixels[i+3]=Math.max(pixels[i+3]!,alpha);
  };
  for(let branch=0;branch<24;branch++){
    let seed=branch*731+191;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    let x=Math.floor(random()*size/2)*2,y=Math.floor(random()*size/2)*2;
    const angle=random()*Math.PI*2;
    const length=Math.max(0,count*4-(branch%6)*3);
    for(let step=0;step<length;step++){
      const heading=angle+(random()-.5)*1.9;
      const dx=Math.round(Math.cos(heading)*2),dy=Math.round(Math.sin(heading)*2);
      for(let k=0;k<=2;k++){paint(x+dx*k/2,y+dy*k/2,225);if(count>=5)paint(x+dx*k/2+1,y+dy*k/2,190);}
      x+=dx;y+=dy;
    }
  }
  const ink=pixels.slice();
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4;if(ink[i+3])continue;
    const neighbour=(((y+size-1)%size)*size+(x+size-1)%size)*4;
    if(ink[neighbour+3]){pixels[i]=188;pixels[i+1]=157;pixels[i+2]=113;pixels[i+3]=100;}
  }
  return pixels;
}
const vertexSource=`precision highp float;
attribute vec3 position; attribute vec3 normal;
uniform mat4 worldViewProjection;
varying vec3 crackPosition; varying vec3 crackNormal;
void main(){crackPosition=position;crackNormal=normal;gl_Position=worldViewProjection*vec4(position,1.0);}`;
const fragmentSource=`precision highp float;
varying vec3 crackPosition; varying vec3 crackNormal; uniform sampler2D cracks;
void main(){
 vec3 n=pow(abs(normalize(crackNormal)),vec3(8.0));n/=max(n.x+n.y+n.z,0.0001);
 vec3 p=crackPosition*0.85;
 vec4 c=texture2D(cracks,p.yz)*n.x+texture2D(cracks,p.xz)*n.y+texture2D(cracks,p.xy)*n.z;
 if(c.a<0.08)discard;gl_FragColor=c;
}`;

/** Surface-conforming overlay: shares authored geometry, never changes the original material. */
export class DamageCracks {
  private readonly materials:ShaderMaterial[]=[];
  private readonly textures:RawTexture[]=[];
  private readonly objects=new Map<string,Mesh[]>();
  constructor(private readonly scene:Scene,private readonly budget=96){}
  get count():number{return this.objects.size;}
  private material(stage:number):ShaderMaterial {
    const known=this.materials[stage];if(known)return known;
    const texture=RawTexture.CreateRGBATexture(crackPixels(stage+1),128,128,this.scene,false,false,Texture.NEAREST_SAMPLINGMODE);
    texture.wrapU=texture.wrapV=Texture.WRAP_ADDRESSMODE;texture.hasAlpha=true;
    const material=new ShaderMaterial(`damage-cracks-${stage}`,this.scene,{vertexSource,fragmentSource},{attributes:['position','normal'],uniforms:['worldViewProjection'],samplers:['cracks'],needAlphaBlending:true});
    material.setTexture('cracks',texture);material.backFaceCulling=false;material.zOffset=-2;material.disableDepthWrite=true;
    this.materials[stage]=material;this.textures.push(texture);return material;
  }
  apply(owner:string,parts:readonly AbstractMesh[],fraction:number):void {
    const stage=Math.max(0,Math.min(CRACK_STAGES-1,Math.ceil((1-fraction)*CRACK_STAGES)-1));
    let overlays=this.objects.get(owner);
    if(!overlays){
      if(this.objects.size>=this.budget)this.clear(this.objects.keys().next().value!);
      overlays=[];
      for(const part of parts){
        // Leaves keep their cutout silhouette; fractures belong on the solid wood/stone surface.
        if(!(part instanceof Mesh)||!part.geometry||(part.material?.needAlphaTesting()&&!/bark|trunk|wood/i.test(part.material.name)))continue;
        const overlay=new Mesh(`damage-surface-${owner}`,this.scene);part.geometry.applyToMesh(overlay);
        overlay.parent=part;overlay.overrideMaterialSideOrientation=part.overrideMaterialSideOrientation;overlay.isPickable=false;overlay.receiveShadows=false;
        overlay.metadata={damageOverlay:true};overlays.push(overlay);
      }
      this.objects.set(owner,overlays);
    }
    for(const overlay of overlays)overlay.material=this.material(stage);
  }
  clear(owner:string):void {for(const mesh of this.objects.get(owner)??[])mesh.dispose();this.objects.delete(owner);}
  reset():void {for(const owner of this.objects.keys())this.clear(owner);}
  dispose():void {this.reset();for(const m of this.materials)m?.dispose();for(const t of this.textures)t.dispose();}
}

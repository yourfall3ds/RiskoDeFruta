import {CreatePlane} from '@babylonjs/core/Meshes/Builders/planeBuilder';
import {CreateIcoSphere} from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {Constants} from '@babylonjs/core/Engines/constants';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {PointLight} from '@babylonjs/core/Lights/pointLight';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {Scene} from '@babylonjs/core/scene';
import type {CollisionWorld} from '../physics/CollisionWorld';
import {radialSurfaceOf,type EnemySurface} from '../enemies/EnemySpace';
export const ELEMENTS=['fire','water','earth','electricity','darkness','explosion'] as const;
export type ElementKind=typeof ELEMENTS[number];
export const ELEMENT_PRESETS={fire:{duration:1.7,size:1.25,rise:.9,glow:2.2},water:{duration:1.15,size:1.35,rise:.1,glow:0},earth:{duration:1.4,size:1.2,rise:.25,glow:0},electricity:{duration:.48,size:.65,rise:0,glow:2.8},darkness:{duration:2.2,size:1.4,rise:.6,glow:.6},explosion:{duration:1.25,size:2.3,rise:.35,glow:3}} as const;
interface Slot{meshes:AbstractMesh[];material:ShaderMaterial;kind:ElementKind;age:number;scale:number;origin:Vector3;active:boolean;serial:number}
/** `up` é a vertical local guardada quando o grão nasceu — `(0,1,0)` na fazenda. */
interface Grain{mesh:AbstractMesh;velocity:Vector3;age:number;active:boolean;water:boolean;up:Vector3}
const vertex='precision highp float;attribute vec3 position;attribute vec2 uv;uniform mat4 worldViewProjection;varying vec2 vUV;void main(){vUV=uv;gl_Position=worldViewProjection*vec4(position,1.);}';
const fragment=`precision highp float;varying vec2 vUV;uniform sampler2D atlas;uniform float element;uniform float age;uniform float opacity;uniform float glow;
void main(){vec2 p=vUV-.5;float edge=1.-smoothstep(.28,.96,length(p*2.));vec2 q=vUV+vec2(sin(vUV.y*17.+age*5.),cos(vUV.x*15.-age*4.))*.009*edge;
vec2 cell=vec2(mod(element,3.),1.-floor(element/3.));vec4 tex=texture2D(atlas,(cell+clamp(q,.002,.998))/vec2(3.,2.));
float lum=dot(tex.rgb,vec3(.2126,.7152,.0722));float luminous=step(.5,glow);float alpha=mix(.56,smoothstep(.16,.8,lum),luminous)*edge*opacity;
vec3 color=tex.rgb*(1.+glow*.16);gl_FragColor=vec4(color,alpha*tex.a);}`;
/** Bounded textured VFX library: 8 bursts / 24 soft cards + 48 ballistic droplets or soil grains.
 * No gameplay damage is hidden here; callers own damage and timing. Water is a splash effect, not a fluid solver.
 */
export class ElementalEffects {
 private readonly slots:Slot[]=[];private readonly grains:Grain[]=[];private readonly templates:AbstractMesh[]=[];
 private readonly materials:PBRMaterial[]=[];private readonly atlas:Texture;private readonly light:PointLight;private serial=0;private readonly auraSlots:Slot[]=[];
 constructor(scene:Scene,private readonly collision?:CollisionWorld,surface?:EnemySurface){
  this.surface=radialSurfaceOf(surface);
  this.atlas=new Texture('/textures/vfx/elemental-atlas.png',scene);this.atlas.wrapU=this.atlas.wrapV=Texture.CLAMP_ADDRESSMODE;
  for(let i=0;i<8;i++){
   const mat=new ShaderMaterial('element-burst-'+i,scene,{vertexSource:vertex,fragmentSource:fragment},{attributes:['position','uv'],uniforms:['worldViewProjection','element','age','opacity','glow'],samplers:['atlas'],needAlphaBlending:true});mat.setTexture('atlas',this.atlas);mat.backFaceCulling=false;mat.disableDepthWrite=true;
   const meshes=Array.from({length:3},(_,j)=>{const mesh=CreatePlane('element-card-'+i+'-'+j,{size:1},scene);mesh.material=mat;mesh.billboardMode=7;mesh.isPickable=false;mesh.setEnabled(false);return mesh;});
   this.slots.push({meshes,material:mat,kind:'fire',age:0,scale:1,origin:Vector3.Zero(),active:false,serial:0});
  }
  const soil=new PBRMaterial('element-soil',scene);soil.albedoTexture=new Texture('/textures/rock_face_03/Diffuse.jpg',scene);soil.roughness=.95;soil.metallic=0;
  const water=new PBRMaterial('element-water-droplets',scene);water.albedoColor=new Color3(.55,.78,.9);water.metallic=0;water.roughness=.07;water.alpha=.7;water.indexOfRefraction=1.333;
  this.materials.push(soil,water);
  for(let k=0;k<2;k++){const template=CreateIcoSphere('element-grain-template-'+k,{radius:k?.028:.035,subdivisions:k?2:1,flat:!k},scene);template.material=k?water:soil;template.isVisible=false;this.templates.push(template);for(let i=0;i<24;i++){const mesh=template.createInstance('element-grain-'+k+'-'+i);mesh.isVisible=true;mesh.isPickable=false;mesh.setEnabled(false);this.grains.push({mesh,velocity:Vector3.Zero(),age:0,active:false,water:!!k,up:new Vector3(0,1,0)});}}
  this.light=new PointLight('element-flash',Vector3.Zero(),scene);this.light.range=5;this.light.intensity=0;
 }
 private surface:EnemySurface|undefined;
 useSurface(surface:EnemySurface|undefined):void {this.surface=radialSurfaceOf(surface);}
 aura(kind:ElementKind,origins:Vector3[],time:number,power:number):void{
  if(power<=0){for(const slot of this.auraSlots){slot.active=false;for(const mesh of slot.meshes)mesh.setEnabled(false);}this.auraSlots.length=0;return;}
  while(this.auraSlots.length>origins.length){const slot=this.auraSlots.pop()!;slot.active=false;for(const mesh of slot.meshes)mesh.setEnabled(false);}
  for(let index=0;index<origins.length;index++){
   let slot=this.auraSlots[index];if(!slot){slot=this.slots.find(s=>!s.active&&!this.auraSlots.includes(s));if(!slot)break;this.auraSlots[index]=slot;}
   slot.active=true;slot.kind=kind;slot.age=0;slot.serial=++this.serial;slot.material.setFloat('element',ELEMENTS.indexOf(kind));slot.material.setFloat('glow',ELEMENT_PRESETS[kind].glow);slot.material.setFloat('age',time);slot.material.setFloat('opacity',power*(index===2?.07:.22));slot.material.alphaMode=kind==='fire'||kind==='electricity'?Constants.ALPHA_ADD:Constants.ALPHA_COMBINE;
   for(let j=0;j<3;j++){const mesh=slot.meshes[j]!;if(j===2){mesh.setEnabled(false);continue;}const a=time*(j%2?-3:3)+j*2.094,indexScale=index===2?.9:.42,r=index===2?.8:.07;mesh.setEnabled(true);mesh.position.copyFrom(origins[index]!).addInPlaceFromFloats(Math.cos(a)*r,Math.sin(a*1.3)*r,Math.sin(a)*r);mesh.scaling.set(indexScale*(.8+power*.5),indexScale*(1.1+power*.45),1);mesh.rotation.z=a*.3;}
  }
 }
 get activeCount():number{return this.slots.filter(s=>s.active).length;}
 emit(kind:ElementKind,origin:Vector3,scale=1):void{
  if(!ELEMENTS.includes(kind)||!Number.isFinite(scale)||scale<=0)return;
  const available=this.slots.filter(s=>!this.auraSlots.includes(s));if(!available.length)return;const s=available.find(s=>!s.active)??available.reduce((a,b)=>a.serial<b.serial?a:b);s.active=true;s.kind=kind;s.age=0;s.scale=Math.min(3,scale);s.origin.copyFrom(origin);s.serial=++this.serial;
  s.material.setFloat('element',ELEMENTS.indexOf(kind));s.material.setFloat('glow',ELEMENT_PRESETS[kind].glow);s.material.alphaMode=kind==='electricity'||kind==='fire'?Constants.ALPHA_ADD:Constants.ALPHA_COMBINE;
  if(kind==='earth'||kind==='water'||kind==='explosion'){
   const grains=this.grains.filter(g=>!g.active&&g.water===(kind==='water')).slice(0,12);
   const basis=this.surface?.basis(origin,{x:0,y:0,z:1});
   const right=basis?basis.right:{x:1,y:0,z:0},forward=basis?basis.forward:{x:0,y:0,z:1},up=basis?basis.up:{x:0,y:1,z:0};
   grains.forEach((g,i)=>{const a=i*2.399+s.serial,r=.4+(i%4)*.27;g.active=true;g.age=0;g.mesh.setEnabled(true);g.mesh.position.copyFrom(origin);g.mesh.scaling.set(s.scale*(.7+i%3*.3),s.scale*(g.water?1.7:1),s.scale);
    const side=Math.sin(a)*r*s.scale,ahead=Math.cos(a)*r*s.scale,lift=1.6+(i%4)*.5;
    g.up.copyFromFloats(up.x,up.y,up.z);
    g.velocity.set(right.x*side+forward.x*ahead+up.x*lift,right.y*side+forward.y*ahead+up.y*lift,right.z*side+forward.z*ahead+up.z*lift);});
  }
  this.update(0);
 }
 update(dt:number):void{
  let brightest=0;this.light.intensity=0;
  for(const s of this.slots){if(!s.active||this.auraSlots.includes(s))continue;const p=ELEMENT_PRESETS[s.kind];s.age+=Math.max(0,dt);const t=s.age/p.duration;if(t>=1){s.active=false;for(const mesh of s.meshes)mesh.setEnabled(false);continue;}
   const fade=Math.min(1,t*14+.15)*Math.pow(1-t,1.4);s.material.setFloat('age',s.age+s.serial);s.material.setFloat('opacity',fade*.4);
   for(let i=0;i<3;i++){const mesh=s.meshes[i]!;mesh.setEnabled(true);const angle=i*2.399+s.serial,size=s.scale*p.size*(.55+t*.7)*(i===0?1:.7);mesh.position.copyFrom(s.origin).addInPlaceFromFloats(Math.cos(angle)*size*.16,p.size*s.scale*.32+s.age*p.rise+Math.sin(i)*size*.1,Math.sin(angle)*size*.16);mesh.scaling.set(size,size*(s.kind==='fire'?1.3:1),1);mesh.rotation.z=s.kind==='water'?0:Math.sin(angle+s.age*.3)*.2;}
   const glow=p.glow*fade*s.scale;if(glow>brightest){brightest=glow;this.light.position.copyFrom(s.origin).addInPlaceFromFloats(0,.6,0);this.light.diffuse=s.kind==='fire'||s.kind==='explosion'?new Color3(1,.3,.04):s.kind==='darkness'?new Color3(.45,.04,1):new Color3(.03,.7,1);this.light.intensity=glow;}
  }
  for(const g of this.grains){if(!g.active)continue;g.age+=dt;
   const fall=9.8*dt;g.velocity.set(g.velocity.x-g.up.x*fall,g.velocity.y-g.up.y*fall,g.velocity.z-g.up.z*fall);
   g.mesh.position.addInPlaceFromFloats(g.velocity.x*dt,g.velocity.y*dt,g.velocity.z*dt);g.mesh.rotation.x+=dt*3;g.mesh.rotation.z+=dt*2;
   if(this.surface){const support=this.surface.support(g.mesh.position,.2,20);if(g.age>1.7||(support&&this.surface.heightGap(g.mesh.position,support.point)<.02)){g.active=false;g.mesh.setEnabled(false);}continue;}
   const ground=this.collision?.groundAt(g.mesh.position.x,g.mesh.position.z,g.mesh.position.y+.2)??0;if(g.age>1.7||g.mesh.position.y<ground+.02){g.active=false;g.mesh.setEnabled(false);}}
 }
 clear():void{this.auraSlots.length=0;for(const s of this.slots){s.active=false;for(const mesh of s.meshes)mesh.setEnabled(false);}for(const g of this.grains){g.active=false;g.mesh.setEnabled(false);}this.light.intensity=0;}
 dispose():void{for(const s of this.slots){for(const m of s.meshes)m.dispose();s.material.dispose();}for(const g of this.grains)g.mesh.dispose();for(const m of this.templates)m.dispose();for(const m of this.materials)m.dispose();this.atlas.dispose();this.light.dispose();}
}

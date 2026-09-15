import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
import {MirrorTexture} from '@babylonjs/core/Materials/Textures/mirrorTexture';
import {Plane} from '@babylonjs/core/Maths/math.plane';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {CreateGround} from '@babylonjs/core/Meshes/Builders/groundBuilder';
import {CreateTorus} from '@babylonjs/core/Meshes/Builders/torusBuilder';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3} from '@babylonjs/core/Maths/math.color';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';
import type {PlayerMotor} from '../player/PlayerMotor';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {WeaponAudio} from '../audio/WeaponAudio';
import type {Vec3} from '../core/contracts';
interface Puddle {x:number;y:number;z:number;width:number;depth:number;mesh:Mesh}

/** A small fixed water/ripple budget and distance-triggered recorded footfalls. */
export class FootingPresentation {
 private crack:Mesh|undefined;private readonly mirror:MirrorTexture;private reflectionClock=0;private readonly puddles:Puddle[]=[];private readonly water:ShaderMaterial;private time=0;private distance=0;private previous:Vec3;private grounded=true;
 private readonly ripples=Array.from({length:8},()=>[0,0,-100,0]);private rippleIndex=0;
 private readonly wind:{mesh:Mesh;life:number;direction:Vector3}[]=[];
 constructor(private readonly scene:Scene,private readonly player:PlayerMotor,private readonly world:CollisionWorld,private readonly audio:WeaponAudio){
  this.previous={...player.position};this.mirror=new MirrorTexture('puddle-scene-reflection',256,scene,true);this.mirror.mirrorPlane=new Plane(0,-1,0,.08);this.mirror.refreshRate=3;this.mirror.renderParticles=false;this.mirror.renderList=[];
  this.water=new ShaderMaterial('interactive-puddle-water',scene,{vertexSource:'precision highp float;attribute vec3 position;attribute vec2 uv;uniform mat4 world;uniform mat4 worldViewProjection;varying vec2 vUV;varying vec3 vWorld;varying vec4 vClip;void main(){vUV=uv;vWorld=(world*vec4(position,1.)).xyz;vClip=worldViewProjection*vec4(position,1.);gl_Position=vClip;}',fragmentSource:`precision highp float;varying vec2 vUV;varying vec3 vWorld;varying vec4 vClip;uniform sampler2D sky;uniform sampler2D planar;uniform float planarHeight;uniform vec3 eye;uniform float time;uniform vec4 ripples[8];void main(){vec2 p=(vUV-.5)*2.;float edge=length(p)+.045*sin(p.x*13.)*sin(p.y*11.);float alpha=1.-smoothstep(.78,1.,edge);if(alpha<.01)discard;vec2 slope=vec2(.003*sin(vWorld.z*8.+time),.003*cos(vWorld.x*7.-time));float foam=0.;for(int i=0;i<8;i++){vec2 d=vWorld.xz-ripples[i].xy;float age=time-ripples[i].z,dist=length(d),front=dist-age*1.7;float envelope=exp(-front*front*28.)*max(0.,1.-age/2.4)*step(0.,age)*ripples[i].w;float wave=cos(front*26.);slope+=d/max(.01,dist)*wave*envelope*.13;foam+=envelope*max(0.,wave)*.11;}vec3 n=normalize(vec3(-slope.x,1.,-slope.y)),v=normalize(eye-vWorld),r=reflect(-v,n);vec2 uv=vec2(atan(r.z,r.x)/6.28318+.5,acos(clamp(r.y,-1.,1.))/3.14159);vec3 reflected=texture2D(sky,uv).rgb;vec2 screenUV=vClip.xy/vClip.w*.5+.5+slope*.035;float planarWeight=(1.-smoothstep(.15,.5,abs(vWorld.y-planarHeight)))*step(0.,screenUV.x)*step(screenUV.x,1.)*step(0.,screenUV.y)*step(screenUV.y,1.);reflected=mix(reflected,texture2D(planar,screenUV).rgb,planarWeight*.9);float fresnel=.18+.65*pow(1.-max(0.,dot(n,v)),5.);vec3 halfVector=normalize(v+normalize(vec3(.6,1.,-.4)));float spec=pow(max(0.,dot(n,halfVector)),180.);vec3 color=mix(vec3(.09,.12,.13),reflected*.8,fresnel)+vec3(1.,.88,.65)*spec*.7+foam;gl_FragColor=vec4(color,alpha*.84);}`},{attributes:['position','uv'],uniforms:['world','worldViewProjection','eye','time','ripples','planarHeight'],samplers:['sky','planar'],needAlphaBlending:true});
  this.water.setTexture('planar',this.mirror);this.water.setFloat('planarHeight',.08);this.water.setTexture('sky',new Texture('/environment/cosmic-sky-v3.png',scene));this.water.backFaceCulling=false;this.water.disableDepthWrite=true;
  const windMaterial=new StandardMaterial('dodge-air-trails',scene);windMaterial.emissiveColor=new Color3(.62,.87,1);windMaterial.disableLighting=true;windMaterial.alpha=.55;
  for(let i=0;i<12;i++){const mesh=CreateTorus('dodge-wind',{diameter:1,thickness:.012,tessellation:28},scene);mesh.material=windMaterial;mesh.isPickable=false;mesh.setEnabled(false);this.wind.push({mesh,life:0,direction:Vector3.Zero()});}
 }
 private initialize():void {
  if(this.puddles.length||!this.world.surfaces.length||!this.world.geometry)return;
  for(const [x,y,z,width,depth] of [[1.8,0,-12.5,3.2,2.2],[-1,0,-5,3.6,2.5],[2,0,5,2.3,1.4],[-3,5,26,3,1.8],[-44,0,-2,2.8,1.8],[44,2,6,2.6,1.7]]){const height=this.world.groundAt(x!,z!,y!+.25);if(!Number.isFinite(height))continue;const mesh=CreateGround('reflective-water-puddle',{width:width!,height:depth!,subdivisions:24,updatable:true},this.scene);const vertices=mesh.getVerticesData(VertexBuffer.PositionKind)!;for(let i=0;i<vertices.length;i+=3){const h=this.world.groundAt(x!+vertices[i]!,z!+vertices[i+2]!,y!+1.2);vertices[i+1]=Number.isFinite(h)?h-height+.045:.045;}mesh.updateVerticesData(VertexBuffer.PositionKind,vertices);mesh.refreshBoundingInfo();mesh.position.set(x!,height,z!);mesh.material=this.water;mesh.isPickable=false;mesh.freezeWorldMatrix();this.puddles.push({x:x!,y:height,z:z!,width:width!,depth:depth!,mesh});}
 }
 impactCracks(p:Vec3):void{
  this.crack?.dispose(false,true);const texture=new DynamicTexture('meteor-fractured-soil',{width:512,height:512},this.scene,false),ctx=texture.getContext();ctx.clearRect(0,0,512,512);ctx.strokeStyle='#19120c';
  for(let i=0;i<11;i++){const a=i*2.399;let x=256,y=256;ctx.lineWidth=2.5+(i%3);ctx.beginPath();ctx.moveTo(x,y);for(let j=0;j<7;j++){const angle=a+Math.sin(i*7+j*3)*.28;x+=Math.cos(angle)*(19+j*2);y+=Math.sin(angle)*(19+j*2);ctx.lineTo(x,y);}ctx.stroke();ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(x*.75+64,y*.75+64);ctx.lineTo(x+Math.cos(a+.6)*25,y+Math.sin(a+.6)*25);ctx.stroke();}
  texture.hasAlpha=true;texture.update();const material=new StandardMaterial('meteor-cracked-earth',this.scene);material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;material.specularColor=Color3.Black();material.backFaceCulling=false;material.zOffset=-1;
  const mesh=CreateGround('meteor-impact-cracks',{width:3.6,height:3.6,subdivisions:12,updatable:true},this.scene),vertices=mesh.getVerticesData(VertexBuffer.PositionKind)!;for(let i=0;i<vertices.length;i+=3){const y=this.world.groundAt(p.x+vertices[i]!,p.z+vertices[i+2]!,p.y+1);vertices[i+1]=Number.isFinite(y)?y+.032:p.y+.032;}mesh.updateVerticesData(VertexBuffer.PositionKind,vertices);mesh.position.set(p.x,0,p.z);mesh.material=material;mesh.isPickable=false;this.crack=mesh;
 }
 private atWater(p:Vec3):boolean{return this.puddles.some(w=>((p.x-w.x)/(w.width*.42))**2+((p.z-w.z)/(w.depth*.42))**2<1&&Math.abs(p.y-w.y)<.22);}
 private surface():'water'|'wood'|'concrete'|'grass'{const p=this.player.position;if(this.atWater(p))return'water';for(const s of this.world.surfaces)if(/bridge|plank|stair|wood/i.test(s.id)&&Math.abs(p.x-s.x)<s.width/2&&Math.abs(p.z-s.z)<s.depth/2)return'wood';for(const b of this.world.nearbyBoxes(p.x,p.z,.2))if(Math.abs(b.max.y-p.y)<.12&&p.x>=b.min.x&&p.x<=b.max.x&&p.z>=b.min.z&&p.z<=b.max.z)return /wood|plank|timber|barn|crate|barrel/i.test(b.id)?'wood':'concrete';return'grass';}
 splash(p:Vec3,strength=1):void {if(!this.atWater(p))return;this.ripples[this.rippleIndex++%8]=[p.x,p.z,this.time,strength];}
 dodge(direction:Vec3):void {let emitted=0;for(const w of this.wind){if(w.life>0)continue;w.life=.55;w.direction.set(direction.x,0,direction.z);w.mesh.position.set(this.player.position.x-direction.x*.2,this.player.position.y+.5+emitted*.22,this.player.position.z-direction.z*.2);w.mesh.rotation.set(Math.PI/2,Math.atan2(direction.x,direction.z),emitted*.5);w.mesh.scaling.setAll(.6+emitted*.18);w.mesh.visibility=1;w.mesh.setEnabled(true);if(++emitted===3)break;}}
 update(dt:number):void {
  this.initialize();this.reflectionClock-=dt;if(this.reflectionClock<=0&&this.puddles.length){this.reflectionClock=.5;const nearest=[...this.puddles].sort((a,b)=>Math.hypot(a.x-this.player.position.x,a.z-this.player.position.z)-Math.hypot(b.x-this.player.position.x,b.z-this.player.position.z))[0]!;const h=nearest.y+.045;this.mirror.mirrorPlane=new Plane(0,-1,0,h);this.water.setFloat('planarHeight',h);this.mirror.renderList=Math.hypot(nearest.x-this.player.position.x,nearest.z-this.player.position.z)<18?this.scene.meshes.filter(m=>m.isEnabled()&&m.isVisible&&m.material!==this.water&&!/element-|arcane-|Ground_|Aura|Condenser|ElectricFlares|SpiralAura|dodge-wind|warning|projectile|charged/i.test(m.name)&&m.getTotalVertices()>0):[];}
  this.time+=dt;const p=this.player.position,moved=Math.hypot(p.x-this.previous.x,p.z-this.previous.z);this.previous={...p};
  if(dt>0&&this.player.grounded&&this.player.dodgeRemaining<=0){this.distance+=Math.min(1,moved);if(this.distance>1.65||!this.grounded){this.distance=0;const surface=this.surface();this.audio.footstep(surface,Math.hypot(this.player.velocity.x,this.player.velocity.z));if(surface==='water')this.splash(p,!this.grounded?1.5:1);}}
  this.grounded=this.player.grounded;
  this.water.setFloat('time',this.time);this.water.setArray4('ripples',this.ripples.flat());this.water.setVector3('eye',this.scene.activeCamera?.position??Vector3.Zero());
  for(const w of this.wind)if(w.life>0){w.life-=dt;w.mesh.setEnabled(w.life>0);w.mesh.visibility=Math.max(0,w.life/.55);w.mesh.position.addInPlace(w.direction.scale(-dt*2));w.mesh.scaling.scaleInPlace(1+dt*1.6);}
 }
 dispose():void {this.crack?.dispose(false,true);for(const p of this.puddles)p.mesh.dispose();for(const w of this.wind)w.mesh.dispose();this.water.dispose();this.mirror.dispose();}
}

import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
import {MirrorTexture} from '@babylonjs/core/Materials/Textures/mirrorTexture';
import {Plane} from '@babylonjs/core/Maths/math.plane';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {CreateGround} from '@babylonjs/core/Meshes/Builders/groundBuilder';
import {CreateTorus} from '@babylonjs/core/Meshes/Builders/torusBuilder';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {dot} from '../planet/PlanetFrame';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';
import type {PlayerMotor} from '../player/PlayerMotor';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {WeaponAudio} from '../audio/RecordedAudio';
import type {Vec3} from '../core/contracts';
import type {SurfaceFrame} from '../physics/SurfaceFrame';
import {FootstepSync} from '../animation/FootstepSync';
interface Puddle {x:number;y:number;z:number;width:number;depth:number;mesh:Mesh}
/** Material do piso para o som do passo. */
export type FootingMaterial='water'|'wood'|'concrete'|'grass';

/**
 * A small fixed water/ripple budget and distance-triggered recorded footfalls.
 *
 * Referencial: tudo o que encosta no chão — marco de passo, rachadura de impacto, rastro de
 * esquiva, poça — é medido e orientado por `collision.surface`, lido A CADA USO. Capturar o
 * referencial no construtor congelaria o `FlatSurface`, porque a cena constrói esta classe antes de
 * o mundo do planeta chamar `configurePlanet`. No mundo plano a base é exata e nada muda de valor.
 */
export class FootingPresentation {
 private crack:Mesh|undefined;private readonly mirror:MirrorTexture;private reflectionClock=0;private readonly puddles:Puddle[]=[];private readonly water:ShaderMaterial;private time=0;private distance=0;private previous:Vec3;private grounded=true;
 private readonly ripples=Array.from({length:8},()=>[0,0,-100,0]);private rippleIndex=0;
 /** Fonte de altura dos pés; quando ausente, o passo volta ao gatilho por distância percorrida. */
 footHeights:(()=>{right:number;left:number}|undefined)|undefined;
 /**
  * Gancho opcional para calar o passo sem perder o estado do pé: corpo a corpo, entrada da nave,
  * morte e qualquer pose autoral que mexa nas pernas sem o corpo se deslocar.
  *
  * Fica opcional de propósito — quem liga é o dono do `PlayerScene`, e sem ele o comportamento é o
  * de hoje. O corte por velocidade já silencia o caso comum (golpe parado); isto cobre o golpe em
  * movimento e o prólogo. Enquanto calado o `FootstepSync` continua vendo as alturas, então ao
  * voltar o pé já está no estado certo e não inventa um passo de retomada.
  */
 suppressSteps:(()=>boolean)|undefined;
 /**
  * Material do piso sob o pé, para quem TEM essa informação. O planeta é uma sopa de triângulos sem
  * id de material: sem este gancho toda ilha e toda ponte soam `grass` — o passo continua tocando,
  * só não distingue madeira. Quem tem o `PlanetManifest` devolve `'wood'` nas pontes com uma linha.
  * `undefined` (ou retorno `undefined`) mantém a decisão padrão por `id` de caixa/superfície.
  */
 footingMaterial:((p:Vec3)=>FootingMaterial|undefined)|undefined;
 readonly steps=new FootstepSync();
 private readonly wind:{mesh:Mesh;life:number;direction:Vector3}[]=[];
 constructor(private readonly scene:Scene,private readonly player:PlayerMotor,private readonly world:CollisionWorld,private readonly audio:WeaponAudio){
  this.previous={...player.position};this.mirror=new MirrorTexture('puddle-scene-reflection',256,scene,true);this.mirror.mirrorPlane=new Plane(0,-1,0,.08);this.mirror.refreshRate=3;this.mirror.renderParticles=false;this.mirror.renderList=[];
  this.water=new ShaderMaterial('interactive-puddle-water',scene,{vertexSource:'precision highp float;attribute vec3 position;attribute vec2 uv;uniform mat4 world;uniform mat4 worldViewProjection;varying vec2 vUV;varying vec3 vWorld;varying vec4 vClip;void main(){vUV=uv;vWorld=(world*vec4(position,1.)).xyz;vClip=worldViewProjection*vec4(position,1.);gl_Position=vClip;}',fragmentSource:`precision highp float;varying vec2 vUV;varying vec3 vWorld;varying vec4 vClip;uniform sampler2D sky;uniform sampler2D planar;uniform float planarHeight;uniform vec3 eye;uniform float time;uniform vec4 ripples[8];void main(){vec2 p=(vUV-.5)*2.;float edge=length(p)+.045*sin(p.x*13.)*sin(p.y*11.);float alpha=1.-smoothstep(.78,1.,edge);if(alpha<.01)discard;vec2 slope=vec2(.003*sin(vWorld.z*8.+time),.003*cos(vWorld.x*7.-time));float foam=0.;for(int i=0;i<8;i++){vec2 d=vWorld.xz-ripples[i].xy;float age=time-ripples[i].z,dist=length(d),front=dist-age*1.7;float envelope=exp(-front*front*28.)*max(0.,1.-age/2.4)*step(0.,age)*ripples[i].w;float wave=cos(front*26.);slope+=d/max(.01,dist)*wave*envelope*.13;foam+=envelope*max(0.,wave)*.11;}vec3 n=normalize(vec3(-slope.x,1.,-slope.y)),v=normalize(eye-vWorld),r=reflect(-v,n);vec2 uv=vec2(atan(r.z,r.x)/6.28318+.5,acos(clamp(r.y,-1.,1.))/3.14159);vec3 reflected=texture2D(sky,uv).rgb;vec2 screenUV=vClip.xy/vClip.w*.5+.5+slope*.035;float planarWeight=(1.-smoothstep(.15,.5,abs(vWorld.y-planarHeight)))*step(0.,screenUV.x)*step(screenUV.x,1.)*step(0.,screenUV.y)*step(screenUV.y,1.);reflected=mix(reflected,texture2D(planar,screenUV).rgb,planarWeight*.9);float fresnel=.18+.65*pow(1.-max(0.,dot(n,v)),5.);vec3 halfVector=normalize(v+normalize(vec3(.6,1.,-.4)));float spec=pow(max(0.,dot(n,halfVector)),180.);vec3 color=mix(vec3(.09,.12,.13),reflected*.8,fresnel)+vec3(1.,.88,.65)*spec*.7+foam;gl_FragColor=vec4(color,alpha*.84);}`},{attributes:['position','uv'],uniforms:['world','worldViewProjection','eye','time','ripples','planarHeight'],samplers:['sky','planar'],needAlphaBlending:true});
  this.water.setTexture('planar',this.mirror);this.water.setFloat('planarHeight',.08);this.water.setTexture('sky',new Texture('/environment/cosmic-sky-v3.png',scene));this.water.backFaceCulling=false;this.water.disableDepthWrite=true;
  const windMaterial=new StandardMaterial('dodge-air-trails',scene);windMaterial.emissiveColor=new Color3(.62,.87,1);windMaterial.disableLighting=true;windMaterial.alpha=.55;
  for(let i=0;i<12;i++){const mesh=CreateTorus('dodge-wind',{diameter:1,thickness:.012,tessellation:28},scene);mesh.material=windMaterial;mesh.isPickable=false;mesh.setEnabled(false);this.wind.push({mesh,life:0,direction:Vector3.Zero()});}
 }
 /** Provedor DINÂMICO de referencial: nunca guardado, senão o planeta nasce com a base plana. */
 private get frame():SurfaceFrame {return this.world.surface;}
 private initialize():void {
  // As seis poças são autoradas em coordenadas de FAZENDA e dependem da lista `world.surfaces`,
  // que o mundo esférico não tem. O guard já existia; no planeta simplesmente não há poça autorada
  // para carregar — nada aqui foi desligado.
  if(this.puddles.length||!this.world.surfaces.length||!this.world.geometry)return;
  for(const [x,y,z,width,depth] of [[1.8,0,-12.5,3.2,2.2],[-1,0,-5,3.6,2.5],[2,0,5,2.3,1.4],[-3,5,26,3,1.8],[-44,0,-2,2.8,1.8],[44,2,6,2.6,1.7]]){const height=this.world.groundAt(x!,z!,y!+.25);if(!Number.isFinite(height))continue;const mesh=CreateGround('reflective-water-puddle',{width:width!,height:depth!,subdivisions:24,updatable:true},this.scene);const vertices=mesh.getVerticesData(VertexBuffer.PositionKind)!;for(let i=0;i<vertices.length;i+=3){const h=this.world.groundAt(x!+vertices[i]!,z!+vertices[i+2]!,y!+1.2);vertices[i+1]=Number.isFinite(h)?h-height+.045:.045;}mesh.updateVerticesData(VertexBuffer.PositionKind,vertices);mesh.refreshBoundingInfo();mesh.position.set(x!,height,z!);mesh.material=this.water;mesh.isPickable=false;mesh.freezeWorldMatrix();this.puddles.push({x:x!,y:height,z:z!,width:width!,depth:depth!,mesh});}
 }
 impactCracks(p:Vec3):void{
  this.crack?.dispose(false,true);const texture=new DynamicTexture('meteor-fractured-soil',{width:512,height:512},this.scene,false),ctx=texture.getContext();ctx.clearRect(0,0,512,512);ctx.strokeStyle='#19120c';
  for(let i=0;i<11;i++){const a=i*2.399;let x=256,y=256;ctx.lineWidth=2.5+(i%3);ctx.beginPath();ctx.moveTo(x,y);for(let j=0;j<7;j++){const angle=a+Math.sin(i*7+j*3)*.28;x+=Math.cos(angle)*(19+j*2);y+=Math.sin(angle)*(19+j*2);ctx.lineTo(x,y);}ctx.stroke();ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(x*.75+64,y*.75+64);ctx.lineTo(x+Math.cos(a+.6)*25,y+Math.sin(a+.6)*25);ctx.stroke();}
  texture.hasAlpha=true;texture.update();const material=new StandardMaterial('meteor-cracked-earth',this.scene);material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;material.specularColor=Color3.Black();material.backFaceCulling=false;material.zOffset=-1;
  /**
   * O anel de rachaduras deita na SUPERFÍCIE, não num plano XZ.
   *
   * O cartão continua sendo o mesmo `CreateGround` de 3,6 m com a mesma textura procedural de
   * fissuras; o que muda é que cada vértice é sondado ao longo da tangente (passo geodésico no
   * planeta) e a altura vira um deslocamento LOCAL sobre a base de superfície, com o nó orientado
   * por `surface.orient`. No mundo plano o resultado é o de antes, vértice por vértice: a base é
   * `right=(1,0,0)`, `forward=(0,0,1)`, a rotação sai 0 e a altura de mundo é a mesma.
   */
  const frame=this.frame,basis=frame.basis(p,{x:0,y:0,z:1});
  const mesh=CreateGround('meteor-impact-cracks',{width:3.6,height:3.6,subdivisions:12,updatable:true},this.scene),vertices=mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for(let i=0;i<vertices.length;i+=3){
   const u=vertices[i]!,w=vertices[i+2]!;
   const probe=frame.walk(p,{x:basis.right.x*u+basis.forward.x*w,y:basis.right.y*u+basis.forward.y*w,z:basis.right.z*u+basis.forward.z*w});
   const support=frame.support(probe,1,Infinity);
   vertices[i+1]=support?-support.offset+.032:.032;
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind,vertices);mesh.refreshBoundingInfo();
  frame.orient(mesh,p,basis.forward);
  mesh.material=material;mesh.isPickable=false;this.crack=mesh;
 }
 private atWater(p:Vec3):boolean{return this.puddles.some(w=>((p.x-w.x)/(w.width*.42))**2+((p.z-w.z)/(w.depth*.42))**2<1&&Math.abs(this.frame.heightGap(p,{x:w.x,y:w.y,z:w.z}))<.22);}
 /**
  * Timbre do passo. A ordem importa: poça autorada primeiro (é geometria de verdade), depois o
  * gancho de quem conhece o material do mundo, e por último a decisão de sempre por `id` de
  * superfície/caixa. No planeta não há `id` de material na sopa de triângulos: sem o gancho o passo
  * **continua tocando** como `grass`.
  */
 private stepMaterial():FootingMaterial{const p=this.player.position;if(this.atWater(p))return'water';const hinted=this.footingMaterial?.(p);if(hinted)return hinted;for(const s of this.world.surfaces)if(/bridge|plank|stair|wood/i.test(s.id)&&Math.abs(p.x-s.x)<s.width/2&&Math.abs(p.z-s.z)<s.depth/2)return'wood';for(const b of this.world.nearbyBoxes(p.x,p.z,.2))if(Math.abs(b.max.y-p.y)<.12&&p.x>=b.min.x&&p.x<=b.max.x&&p.z>=b.min.z&&p.z<=b.max.z)return /wood|plank|timber|barn|crate|barrel/i.test(b.id)?'wood':'concrete';return'grass';}
 splash(p:Vec3,strength=1):void {if(!this.atWater(p))return;this.ripples[this.rippleIndex++%8]=[p.x,p.z,this.time,strength];}
 /**
  * Rastro de ar da esquiva: os mesmos doze toros, com o eixo do anel ao longo da MARCHA e o
  * deslocamento de altura ao longo da vertical LOCAL. No plano a pose é escrita por `rotation`,
  * exatamente como antes; no planeta por quaternion montado da base de superfície, porque um Euler
  * global deitaria o anel fora do polo.
  */
 dodge(direction:Vec3):void {
  const frame=this.frame,up=frame.up(this.player.position);
  const along=dot(direction,up);
  const tangent=new Vector3(direction.x-up.x*along,direction.y-up.y*along,direction.z-up.z*along);
  const unit=tangent.length()>1e-6?tangent.scale(1/tangent.length()):new Vector3(0,0,1);
  let emitted=0;
  for(const w of this.wind){
   if(w.life>0)continue;
   w.life=.55;w.direction.copyFrom(tangent);
   const lift=.5+emitted*.22;
   w.mesh.position.set(
    this.player.position.x-tangent.x*.2+up.x*lift,
    this.player.position.y-tangent.y*.2+up.y*lift,
    this.player.position.z-tangent.z*.2+up.z*lift,
   );
   if(frame.kind==='flat'){w.mesh.rotationQuaternion=null;w.mesh.rotation.set(Math.PI/2,Math.atan2(direction.x,direction.z),emitted*.5);}
   else w.mesh.rotationQuaternion=ringRotation(unit,up,emitted*.5);
   w.mesh.scaling.setAll(.6+emitted*.18);w.mesh.visibility=1;w.mesh.setEnabled(true);
   if(++emitted===3)break;
  }
 }
 update(dt:number):void {
  const frame=this.frame;
  this.initialize();this.reflectionClock-=dt;if(this.reflectionClock<=0&&this.puddles.length){this.reflectionClock=.5;const nearest=[...this.puddles].sort((a,b)=>Math.hypot(a.x-this.player.position.x,a.z-this.player.position.z)-Math.hypot(b.x-this.player.position.x,b.z-this.player.position.z))[0]!;const h=nearest.y+.045;this.mirror.mirrorPlane=new Plane(0,-1,0,h);this.water.setFloat('planarHeight',h);this.mirror.renderList=Math.hypot(nearest.x-this.player.position.x,nearest.z-this.player.position.z)<18?this.scene.meshes.filter(m=>m.isEnabled()&&m.isVisible&&m.material!==this.water&&!/element-|arcane-|Ground_|Aura|Condenser|ElectricFlares|SpiralAura|dodge-wind|warning|projectile|charged/i.test(m.name)&&m.getTotalVertices()>0):[];}
  // Distância e velocidade medidas PELA SUPERFÍCIE: arco e velocidade tangencial no planeta.
  // No plano `planarDistance` é `hypot(dx,dz)` e `tangentialSpeed` é `hypot(vx,vz)`, bit a bit.
  this.time+=dt;const p=this.player.position,moved=frame.planarDistance(p,this.previous);this.previous={...p};
  // Passo pelo contato real do pé. Sem os ossos disponíveis, mantém o gatilho antigo por distância.
  const heights=this.footHeights?.();
  const speed=this.player.tangentialSpeed;
  const footfall=()=>{const material=this.stepMaterial();this.audio.footstep(material,speed);if(material==='water')this.splash(p,!this.grounded?1.5:1);};
  if(dt>0){
   // Teleporte (respawn, troca de região, entrada da nave) não é passada: a altura guardada do
   // quadro anterior não vale mais e compará-la produziria uma descida inventada.
   if(moved>2){this.steps.reset();this.distance=0;}
   // Esquiva e mortal-reverso mexem as pernas sem ser caminhada; calar é diferente de parar de
   // medir — parar de medir é justamente o que fazia o passo falso ao voltar ao normal.
   this.steps.muted=this.player.dodgeRemaining>0||this.player.backflipProgress>=0||this.suppressSteps?.()===true;
   if(heights)this.steps.update(dt,[{side:0,height:heights.right},{side:1,height:heights.left}],this.player.grounded,speed,footfall);
   else if(this.steps.muted)this.distance=0;
   else if(this.player.grounded){this.distance+=Math.min(1,moved);if(this.distance>1.65||!this.grounded){this.distance=0;footfall();}}
  }
  this.grounded=this.player.grounded;
  this.water.setFloat('time',this.time);this.water.setArray4('ripples',this.ripples.flat());this.water.setVector3('eye',this.scene.activeCamera?.position??Vector3.Zero());
  for(const w of this.wind)if(w.life>0){w.life-=dt;w.mesh.setEnabled(w.life>0);w.mesh.visibility=Math.max(0,w.life/.55);w.mesh.position.addInPlace(w.direction.scale(-dt*2));w.mesh.scaling.scaleInPlace(1+dt*1.6);}
 }
 dispose():void {this.crack?.dispose(false,true);for(const p of this.puddles)p.mesh.dispose();for(const w of this.wind)w.mesh.dispose();this.water.dispose();this.mirror.dispose();}
}

/**
 * Pose de um anel de ar cujo EIXO é a marcha, com giro `roll` em torno dele.
 *
 * O toro do Babylon nasce no plano XZ com eixo +Y; basta mapear o +Y local em `axis`. O `up` local
 * só serve para escolher um lado estável do anel — nos polos, onde `up × axis` degeneraria, cai em
 * +X, como o resto do referencial faz.
 */
function ringRotation(axis:Vector3,up:Vec3,roll:number):Quaternion {
 const side=Vector3.Cross(new Vector3(up.x,up.y,up.z),axis);
 const right=side.lengthSquared()>1e-12?side.normalize():new Vector3(1,0,0);
 const forward=Vector3.Cross(axis,right);
 const basis=Matrix.Identity();
 Matrix.FromXYZAxesToRef(right,axis,forward,basis);
 return Quaternion.FromRotationMatrix(basis).multiply(Quaternion.RotationAxis(axis,roll));
}

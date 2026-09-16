import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { EnemyKind } from '../run/MonsterDirector';
import '@babylonjs/core/Meshes/instancedMesh';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Vec3 } from '../core/contracts';
/** `stretch` só é usado por faixas (`band`/`aim`) e vale o comprimento real em metros; círculos ficam em 1. */
export interface GroundWarning {mesh:AbstractMesh;circle:AbstractMesh;remaining:number;duration:number;radius:number;position:Vec3;active:boolean;damage:number;owner:number;kind:string;pulses:number;stretch:number}
export interface ProjectileImpact {zone?:'fire'|'acid';summon?:EnemyKind;seed?:boolean}
export interface EnemyProjectile {mesh:AbstractMesh;active:boolean;remaining:number;position:Vector3;velocity:Vector3;gravity:number;damage:number;owner:number;radius:number;delay:number;impact:ProjectileImpact|undefined}
interface Burst {mesh:AbstractMesh;active:boolean;remaining:number;duration:number;velocity:Vector3;color:'energy'|'juice'|'seed'|'soil'}
/** Fixed-size GPU/CPU pools. Telegraph coordinates remain locked after cast. */
export class CombatPresentation {
  readonly warnings:GroundWarning[]=[];readonly projectiles:EnemyProjectile[]=[];private readonly bursts:Burst[]=[];
  private readonly materials:StandardMaterial[]=[];
  private readonly roots:{mesh:AbstractMesh;life:number;height:number}[]=[];
  private readonly cones:AbstractMesh[]=[];
  private readonly bands:AbstractMesh[]=[];
  private readonly summons:AbstractMesh[]=[];
  constructor(private readonly scene:Scene){
    for(const [name,color] of [['warning','#ff6336'],['seed','#ffd15a'],['energy','#83ffc8'],['juice','#b958ed']] as const){const mat=new StandardMaterial(name,scene);mat.diffuseColor=Color3.FromHexString(color);mat.emissiveColor=mat.diffuseColor.scale(.8);mat.disableLighting=true;this.materials.push(mat);}
    const warning=CreateTorus('warning-template',{diameter:2,thickness:.045,tessellation:40},scene);warning.material=this.materials[0]!;warning.isVisible=false;
    for(let i=0;i<48;i++){const mesh=warning.createInstance(`attack-warning-${i}`);mesh.isVisible=true;mesh.isPickable=false;mesh.setEnabled(false);this.warnings.push({mesh,circle:mesh,remaining:0,duration:1,radius:1,position:{x:0,y:0,z:0},active:false,damage:0,owner:0,kind:'',pulses:0,stretch:1});}
    const coneMat=this.materials[0]!.clone('cone-danger');coneMat.alpha=.28;coneMat.backFaceCulling=false;
    const sector=CreateDisc('cone-warning-template',{radius:1,tessellation:32,arc:1/3},scene);sector.material=coneMat;sector.isVisible=false;
    for(let i=0;i<8;i++){const cone=sector.createInstance(`cone-warning-${i}`);cone.isVisible=true;cone.isPickable=false;cone.rotation.x=Math.PI/2;cone.setEnabled(false);this.cones.push(cone);}
    // Faixa = plano retangular no plano XZ: escala X é a largura de contato e escala Z o comprimento do trajeto.
    const bandMat=this.materials[0]!.clone('band-danger');bandMat.alpha=.24;bandMat.backFaceCulling=false;
    const band=CreateGround('band-warning-template',{width:1,height:1,subdivisions:1},scene);band.material=bandMat;band.isVisible=false;
    for(let i=0;i<16;i++){const strip=band.createInstance(`band-warning-${i}`);strip.isVisible=true;strip.isPickable=false;strip.setEnabled(false);this.bands.push(strip);}
    // Invocação não é área de dano: anel menta, mais grosso, separado do vermelho de perigo.
    const summonMat=new StandardMaterial('summon-signal',scene);summonMat.diffuseColor=Color3.FromHexString('#83ffc8');summonMat.emissiveColor=summonMat.diffuseColor.scale(.9);summonMat.disableLighting=true;summonMat.alpha=.75;
    const portal=CreateTorus('summon-warning-template',{diameter:2,thickness:.11,tessellation:24},scene);portal.material=summonMat;portal.isVisible=false;
    for(let i=0;i<12;i++){const ring=portal.createInstance(`summon-warning-${i}`);ring.isVisible=true;ring.isPickable=false;ring.setEnabled(false);this.summons.push(ring);}
    const seed=new StandardMaterial('corn-kernel-lighting',scene);seed.diffuseColor=new Color3(1,.52,.08);seed.emissiveColor=new Color3(.35,.09,.005);seed.specularColor=new Color3(.7,.52,.2);seed.specularPower=48;
    const fire=new StandardMaterial('tomato-fireball',scene);fire.diffuseColor=new Color3(1,.15,.015);fire.emissiveColor=new Color3(3,.6,.04);fire.disableLighting=true;this.materials.push(fire);const pit=new StandardMaterial('watermelon-seed',scene);pit.diffuseColor=new Color3(.07,.025,.014);pit.specularColor=new Color3(.5,.3,.2);this.materials.push(pit);
    const projectile=CreateSphere('enemy-projectile-template',{diameter:.32,segments:10},scene);projectile.material=seed;projectile.isVisible=false;
    for(let i=0;i<128;i++){const mesh=projectile.clone(`enemy-projectile-${i}`);mesh.isVisible=true;mesh.isPickable=false;mesh.setEnabled(false);this.projectiles.push({mesh,active:false,remaining:0,position:Vector3.Zero(),velocity:Vector3.Zero(),gravity:0,damage:0,owner:0,radius:.18,delay:0,impact:undefined});}
    const dirt=new StandardMaterial('birth-earth',scene);dirt.diffuseTexture=new Texture('/textures/brown_mud_leaves_01/Diffuse.jpg',scene);dirt.specularColor=Color3.Black();this.materials.push(dirt);
    for(const color of ['energy','juice','seed','soil'] as const){const template=projectile.clone(`${color}-template`);template.material=this.materials[color==='soil'?6:color==='energy'?2:color==='juice'?3:1]!;template.isVisible=false;for(let i=0;i<32;i++){const mesh=template.createInstance(`${color}-fragment-${i}`);mesh.isVisible=true;mesh.isPickable=false;mesh.setEnabled(false);this.bursts.push({mesh,active:false,remaining:0,duration:1,velocity:Vector3.Zero(),color});}}
    const bark=new StandardMaterial('erupting-root-bark',scene);bark.diffuseColor=new Color3(.38,.29,.12);bark.diffuseTexture=new Texture('/textures/wood_planks/Diffuse.jpg',scene);bark.specularColor=Color3.Black();
    const spike=CreateCylinder('root-spear-template',{height:1,diameterBottom:.42,diameterTop:.02,tessellation:7},scene);spike.material=bark;spike.isVisible=false;
    for(let i=0;i<48;i++){const mesh=spike.createInstance(`root-spear-${i}`);mesh.isVisible=true;mesh.isPickable=false;mesh.setEnabled(false);this.roots.push({mesh,life:0,height:1});}
  }
  /** Trocar o mesh de um slot sempre desliga o anterior: cone/faixa/invocação voltam para o pool. */
  private attach(w:GroundWarning,mesh:AbstractMesh):void {if(w.mesh!==mesh)w.mesh.setEnabled(false);w.mesh=mesh;}
  /** Círculo só onde existe dano de área real (fogo, ácido, raízes) ou marca de invocação. */
  warning(position:Vec3,radius:number,seconds:number,damage:number,owner:number,kind='impact'):GroundWarning|undefined {const w=this.warnings.find(x=>!x.active);if(!w)return;const ring=kind==='summon'?this.summons.find(m=>!m.isEnabled()):w.circle;if(!ring)return;this.attach(w,ring);Object.assign(w,{active:true,position:{x:position.x,y:position.y,z:position.z},radius,remaining:seconds,duration:seconds,damage,owner,kind,pulses:kind==='acid'?8:kind==='fire'?5:0,stretch:1});w.mesh.position.set(position.x,position.y+.055,position.z);w.mesh.rotation.set(0,0,0);w.mesh.scaling.set(radius,1,radius);w.mesh.setEnabled(true);return w;}
  /** Setor de 120° (arco 1/3) apontado ao alvo travado — a mesma abertura testada pela varredura. */
  cone(from:Vec3,to:Vec3,radius:number,seconds:number,owner:number):void {const mesh=this.cones.find(x=>!x.isEnabled());if(!mesh)return;const w=this.warnings.find(x=>!x.active);if(!w)return;this.attach(w,mesh);Object.assign(w,{active:true,position:{x:from.x,y:from.y,z:from.z},radius,remaining:seconds,duration:seconds,damage:0,owner,kind:'cone',pulses:0,stretch:1});mesh.position.set(from.x,from.y+.065,from.z);mesh.rotation.set(Math.PI/2,Math.atan2(to.x-from.x,to.z-from.z)-Math.PI/6,0);mesh.scaling.setAll(radius);mesh.setEnabled(true);}
  /** Faixa retangular real (largura × comprimento do trajeto); nunca um torus esticado em elipse. */
  line(from:Vec3,to:Vec3,width:number,seconds:number,owner:number,kind:'band'|'aim'='band'):void {const dx=to.x-from.x,dz=to.z-from.z,length=Math.hypot(dx,dz);if(length<.05)return;const mesh=this.bands.find(x=>!x.isEnabled());if(!mesh)return;const w=this.warnings.find(x=>!x.active);if(!w)return;this.attach(w,mesh);Object.assign(w,{active:true,position:{x:(from.x+to.x)/2,y:(from.y+to.y)/2,z:(from.z+to.z)/2},radius:width,remaining:seconds,duration:seconds,damage:0,owner,kind,pulses:0,stretch:length});mesh.position.set(w.position.x,w.position.y+.05,w.position.z);mesh.rotation.set(0,Math.atan2(dx,dz),0);mesh.scaling.set(width,1,length);mesh.setEnabled(true);}
  projectile(origin:Vec3,target:Vec3,speed:number,damage:number,owner:number,gravity=0,impact?:ProjectileImpact,delay=0):void {const p=this.projectiles.find(x=>!x.active);if(!p)return;p.active=true;p.remaining=6;p.damage=damage;p.owner=owner;p.gravity=gravity;p.impact=impact;p.delay=delay;p.mesh.material=impact?.zone==='fire'?this.materials[4]!:impact?.seed?this.materials[5]!:this.scene.getMaterialByName('corn-kernel-lighting');p.mesh.scaling.set(impact?.seed?.65:impact?.zone==='fire'?2.1:1,impact?.seed?.45:impact?.zone==='fire'?2.1:1,impact?.seed?1.5:impact?.zone==='fire'?2.1:1);p.radius=impact?.zone==='fire'?.3:impact?.seed?.12:.18;p.position.copyFromFloats(origin.x,origin.y,origin.z);p.velocity.copyFromFloats(target.x-origin.x,target.y-origin.y,target.z-origin.z).normalize().scaleInPlace(speed);if(gravity)p.velocity.y+=Math.hypot(target.x-origin.x,target.z-origin.z)/speed*gravity*.5;p.mesh.position.copyFrom(p.position);p.mesh.setEnabled(delay===0);}
  eruption(position:Vec3,radius:number):void {let count=0;for(const root of this.roots){if(root.life>0)continue;root.life=.85;root.height=1.4+count*.22;const angle=count*2.4;root.mesh.position.set(position.x+Math.sin(angle)*radius*.5,position.y+root.height/2,position.z+Math.cos(angle)*radius*.5);root.mesh.rotation.set(Math.sin(angle)*.3,angle,Math.cos(angle)*.2);root.mesh.scaling.set(1,root.height,1);root.mesh.setEnabled(true);if(++count===6)break;}}
  burst(position:Vec3,color:'energy'|'juice'|'seed'|'soil'='juice',scale=1):void {let emitted=0;for(const b of this.bursts){if(b.active||b.color!==color)continue;b.active=true;b.duration=b.remaining=.5+(emitted%3)*.12;b.mesh.position.set(position.x,position.y+.7,position.z);const angle=emitted*Math.PI*.7639;b.velocity.set(Math.sin(angle)*scale*3,2+(emitted%4),Math.cos(angle)*scale*3);b.mesh.scaling.setAll(.3*scale);b.mesh.setEnabled(true);if(++emitted>=12)break;}}
  render(dt:number):void {const camera=this.scene.activeCamera;for(const projectile of this.projectiles)if(projectile.active&&camera)projectile.mesh.isVisible=projectile.impact?.zone!=='fire'&&Vector3.DistanceSquared(camera.position,projectile.position)>.4;for(const root of this.roots)if(root.life>0){root.life-=dt;root.mesh.scaling.y=root.height*Math.min(1,(.85-root.life)*15,root.life*5);if(root.life<=0)root.mesh.setEnabled(false);}for(const w of this.warnings)if(w.active){const pulse=1+.035*Math.sin(w.remaining*30);if(w.kind==='cone')w.mesh.scaling.setAll(w.radius*pulse);else if(w.kind==='band'||w.kind==='aim')w.mesh.scaling.set(w.radius*pulse,1,w.stretch);else w.mesh.scaling.set(w.radius*pulse,1,w.radius*pulse);}for(const b of this.bursts)if(b.active){b.remaining-=dt;if(b.remaining<=0){b.active=false;b.mesh.setEnabled(false);continue;}b.velocity.y-=8*dt;b.mesh.position.addInPlace(b.velocity.scale(dt));if(b.remaining<.2)b.mesh.scaling.scaleInPlace(Math.exp(-dt*8));}}
  clear():void {for(const x of [...this.projectiles,...this.bursts]){x.active=false;x.mesh.setEnabled(false);}for(const w of this.warnings){w.mesh.setEnabled(false);w.mesh=w.circle;w.mesh.setEnabled(false);Object.assign(w,{active:false,remaining:0,damage:0,pulses:0,stretch:1,kind:''});}for(const mesh of [...this.cones,...this.bands,...this.summons])mesh.setEnabled(false);for(const root of this.roots){root.life=0;root.mesh.setEnabled(false);}}
  get active():number {return this.warnings.filter(x=>x.active).length+this.projectiles.filter(x=>x.active).length+this.bursts.filter(x=>x.active).length+this.roots.filter(x=>x.life>0).length;}
  /** Diagnóstico de vazamento: meshes auxiliares (cone/faixa/invocação) que continuam ligados. */
  get attachedShapes():number {return this.cones.filter(m=>m.isEnabled()).length+this.bands.filter(m=>m.isEnabled()).length+this.summons.filter(m=>m.isEnabled()).length;}
}




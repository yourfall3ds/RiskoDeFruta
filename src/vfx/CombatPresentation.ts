import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import '@babylonjs/core/Meshes/instancedMesh';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Matrix,Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Vec3 } from '../core/contracts';
import { radialSurfaceOf,type EnemySurface } from '../enemies/EnemySpace';
/** `stretch` só é usado por faixas (`band`/`aim`) e vale o comprimento real em metros; círculos ficam em 1. */
export interface GroundWarning {mesh:AbstractMesh;circle:AbstractMesh;remaining:number;duration:number;radius:number;position:Vec3;active:boolean;damage:number;owner:number;kind:string;pulses:number;stretch:number}
/**
 * A forma do impacto vive em `CombatField`, junto com o lado de GAMEPLAY dos projéteis: o servidor
 * precisa dela e não pode importar este arquivo (que instancia malha). Reexportada para todo
 * chamador existente continuar lendo daqui.
 */
export type {ProjectileImpact} from './CombatField';
import type {ProjectileImpact} from './CombatField';
export interface EnemyProjectile {mesh:AbstractMesh;active:boolean;remaining:number;position:Vector3;velocity:Vector3;gravity:number;damage:number;owner:number;radius:number;delay:number;impact:ProjectileImpact|undefined}
interface Burst {mesh:AbstractMesh;active:boolean;remaining:number;duration:number;velocity:Vector3;color:'energy'|'juice'|'seed'|'soil';up:Vector3}
/** Rascunhos dos decalques: pool fixo, nenhuma alocação por aviso por quadro. */
const AXIS_X=new Vector3(),AXIS_Y=new Vector3(),AXIS_Z=new Vector3();
const DECAL_MATRIX=new Matrix(),DECAL_BASE=new Quaternion(),DECAL_LOCAL=new Quaternion();
const DECAL_HINT:Vec3={x:0,y:0,z:1};
const ROOT_SPOT=new Vector3(),BURST_SPOT=new Vector3();
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
    for(const color of ['energy','juice','seed','soil'] as const){const template=projectile.clone(`${color}-template`);template.material=this.materials[color==='soil'?6:color==='energy'?2:color==='juice'?3:1]!;template.isVisible=false;for(let i=0;i<32;i++){const mesh=template.createInstance(`${color}-fragment-${i}`);mesh.isVisible=true;mesh.isPickable=false;mesh.setEnabled(false);this.bursts.push({mesh,active:false,remaining:0,duration:1,velocity:Vector3.Zero(),color,up:new Vector3(0,1,0)});}}
    const bark=new StandardMaterial('erupting-root-bark',scene);bark.diffuseColor=new Color3(.38,.29,.12);bark.diffuseTexture=new Texture('/textures/wood_planks/Diffuse.jpg',scene);bark.specularColor=Color3.Black();
    const spike=CreateCylinder('root-spear-template',{height:1,diameterBottom:.42,diameterTop:.02,tessellation:7},scene);spike.material=bark;spike.isVisible=false;
    for(let i=0;i<48;i++){const mesh=spike.createInstance(`root-spear-${i}`);mesh.isVisible=true;mesh.isPickable=false;mesh.setEnabled(false);this.roots.push({mesh,life:0,height:1});}
  }
  /**
   * Referencial dos decalques. Sem superfície, cada aviso continua sendo um plano XZ com
   * `rotation.set(0,yaw,0)` e `y+.05` — a fazenda não muda. Com superfície, o mesmo mesh recebe
   * `rotationQuaternion` da base tangente e sobe pela radial: o aviso deita no convés em qualquer
   * ilha, incluindo os polos, sem nenhum número de raio, duração ou dano mudar.
   */
  private surface:EnemySurface|undefined;
  useSurface(surface:EnemySurface|undefined):void {this.surface=radialSurfaceOf(surface);}
  /** Trocar o mesh de um slot sempre desliga o anterior: cone/faixa/invocação voltam para o pool. */
  private attach(w:GroundWarning,mesh:AbstractMesh):void {if(w.mesh!==mesh)w.mesh.setEnabled(false);w.mesh=mesh;}
  /**
   * Deita o mesh no convés em `p`, `lift` metros acima, com `spin` radianos de giro em torno da
   * vertical local. `tilt` é a inclinação extra em torno do eixo tangente (o cone usa π/2, porque
   * o disco nasce em pé).
   */
  private layFlat(mesh:AbstractMesh,p:Vec3,lift:number,spin:number,tilt=0):void {
    const surface=this.surface;
    if(!surface){mesh.rotationQuaternion=null;mesh.position.set(p.x,p.y+lift,p.z);mesh.rotation.set(tilt,spin,0);return;}
    const up=surface.up(p);
    mesh.position.set(p.x+up.x*lift,p.y+up.y*lift,p.z+up.z*lift);
    const basis=surface.basis(p,DECAL_HINT);
    AXIS_X.set(basis.right.x,basis.right.y,basis.right.z);
    AXIS_Y.set(basis.up.x,basis.up.y,basis.up.z);
    AXIS_Z.set(basis.forward.x,basis.forward.y,basis.forward.z);
    Matrix.FromXYZAxesToRef(AXIS_X,AXIS_Y,AXIS_Z,DECAL_MATRIX);
    Quaternion.FromRotationMatrixToRef(DECAL_MATRIX,DECAL_BASE);
    // Ordem idêntica à do euler `(tilt, spin, 0)` do caminho plano, agora dentro da base local.
    Quaternion.RotationYawPitchRollToRef(spin,tilt,0,DECAL_LOCAL);
    (mesh.rotationQuaternion??=new Quaternion()).copyFrom(DECAL_BASE.multiply(DECAL_LOCAL));
  }
  /** Direção tangente de `from` para `to`, e o giro que a alinha à frente da base do decalque. */
  private spinToward(from:Vec3,to:Vec3):number {
    const surface=this.surface;
    if(!surface)return Math.atan2(to.x-from.x,to.z-from.z);
    const basis=surface.basis(from,DECAL_HINT);
    const dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z;
    const right=dx*basis.right.x+dy*basis.right.y+dz*basis.right.z;
    const forward=dx*basis.forward.x+dy*basis.forward.y+dz*basis.forward.z;
    return Math.atan2(right,forward);
  }
  /** Comprimento CAMINHÁVEL do trajeto de uma faixa. Plano: `hypot(dx,dz)`. */
  private span(from:Vec3,to:Vec3):number {
    return this.surface?this.surface.planarDistance(from,to):Math.hypot(to.x-from.x,to.z-from.z);
  }
  /** Círculo só onde existe dano de área real (fogo, ácido, raízes) ou marca de invocação. */
  warning(position:Vec3,radius:number,seconds:number,damage:number,owner:number,kind='impact'):GroundWarning|undefined {const w=this.warnings.find(x=>!x.active);if(!w)return;const ring=kind==='summon'?this.summons.find(m=>!m.isEnabled()):w.circle;if(!ring)return;this.attach(w,ring);Object.assign(w,{active:true,position:{x:position.x,y:position.y,z:position.z},radius,remaining:seconds,duration:seconds,damage,owner,kind,pulses:kind==='acid'?8:kind==='fire'?5:0,stretch:1});this.layFlat(w.mesh,position,.055,0);w.mesh.scaling.set(radius,1,radius);w.mesh.setEnabled(true);return w;}
  /** Setor de 120° (arco 1/3) apontado ao alvo travado — a mesma abertura testada pela varredura. */
  cone(from:Vec3,to:Vec3,radius:number,seconds:number,owner:number):void {const mesh=this.cones.find(x=>!x.isEnabled());if(!mesh)return;const w=this.warnings.find(x=>!x.active);if(!w)return;this.attach(w,mesh);Object.assign(w,{active:true,position:{x:from.x,y:from.y,z:from.z},radius,remaining:seconds,duration:seconds,damage:0,owner,kind:'cone',pulses:0,stretch:1});this.layFlat(mesh,from,.065,this.spinToward(from,to)-Math.PI/6,Math.PI/2);mesh.scaling.setAll(radius);mesh.setEnabled(true);}
  /** Faixa retangular real (largura × comprimento do trajeto); nunca um torus esticado em elipse. */
  line(from:Vec3,to:Vec3,width:number,seconds:number,owner:number,kind:'band'|'aim'='band'):void {const length=this.span(from,to);if(length<.05)return;const mesh=this.bands.find(x=>!x.isEnabled());if(!mesh)return;const w=this.warnings.find(x=>!x.active);if(!w)return;this.attach(w,mesh);Object.assign(w,{active:true,position:{x:(from.x+to.x)/2,y:(from.y+to.y)/2,z:(from.z+to.z)/2},radius:width,remaining:seconds,duration:seconds,damage:0,owner,kind,pulses:0,stretch:length});this.layFlat(mesh,w.position,.05,this.spinToward(from,to));mesh.scaling.set(width,1,length);mesh.setEnabled(true);}
  projectile(origin:Vec3,target:Vec3,speed:number,damage:number,owner:number,gravity=0,impact?:ProjectileImpact,delay=0):void {const p=this.projectiles.find(x=>!x.active);if(!p)return;p.active=true;p.remaining=6;p.damage=damage;p.owner=owner;p.gravity=gravity;p.impact=impact;p.delay=delay;p.mesh.material=impact?.zone==='fire'?this.materials[4]!:impact?.seed?this.materials[5]!:this.scene.getMaterialByName('corn-kernel-lighting');p.mesh.scaling.set(impact?.seed?.65:impact?.zone==='fire'?2.1:1,impact?.seed?.45:impact?.zone==='fire'?2.1:1,impact?.seed?1.5:impact?.zone==='fire'?2.1:1);p.radius=impact?.zone==='fire'?.3:impact?.seed?.12:.18;p.position.copyFromFloats(origin.x,origin.y,origin.z);p.velocity.copyFromFloats(target.x-origin.x,target.y-origin.y,target.z-origin.z).normalize().scaleInPlace(speed);
    // Elevação balística: a compensação da queda sobe pela vertical LOCAL da origem, senão um tiro
    // do outro lado do globo seria lançado para dentro do planeta.
    if(gravity){const lead=this.span(origin,target)/speed*gravity*.5,up=this.surface?.up(origin);if(up)p.velocity.addInPlaceFromFloats(up.x*lead,up.y*lead,up.z*lead);else p.velocity.y+=lead;}
    p.mesh.position.copyFrom(p.position);p.mesh.setEnabled(delay===0);}
  /** A raiz brota PARA CIMA do convés: o espeto sobe meio comprimento na vertical local. */
  eruption(position:Vec3,radius:number):void {let count=0;for(const root of this.roots){if(root.life>0)continue;root.life=.85;root.height=1.4+count*.22;const angle=count*2.4;
    this.ringInto(position,angle,radius*.5,root.height/2,ROOT_SPOT);
    if(this.surface)this.layFlat(root.mesh,ROOT_SPOT,0,angle,0);
    else{root.mesh.rotationQuaternion=null;root.mesh.rotation.set(Math.sin(angle)*.3,angle,Math.cos(angle)*.2);}
    root.mesh.position.copyFrom(ROOT_SPOT);
    root.mesh.scaling.set(1,root.height,1);root.mesh.setEnabled(true);if(++count===6)break;}}
  burst(position:Vec3,color:'energy'|'juice'|'seed'|'soil'='juice',scale=1):void {let emitted=0;for(const b of this.bursts){if(b.active||b.color!==color)continue;b.active=true;b.duration=b.remaining=.5+(emitted%3)*.12;const angle=emitted*Math.PI*.7639;
    // Cada estilhaço guarda a vertical do ponto onde nasceu: é ela que o puxa de volta no `render`,
    // em vez de um `−Y` global que na esfera empurraria o caco para o lado.
    const up=this.surface?.up(position);b.up.copyFromFloats(up?.x??0,up?.y??1,up?.z??0);
    this.ringInto(position,angle,scale*0,.7,BURST_SPOT);b.mesh.position.copyFromFloats(BURST_SPOT.x,BURST_SPOT.y,BURST_SPOT.z);
    this.ringInto(position,angle,scale*3,0,BURST_SPOT);
    b.velocity.set(BURST_SPOT.x-position.x+b.up.x*(2+(emitted%4)),BURST_SPOT.y-position.y+b.up.y*(2+(emitted%4)),BURST_SPOT.z-position.z+b.up.z*(2+(emitted%4)));
    b.mesh.scaling.setAll(.3*scale);b.mesh.setEnabled(true);if(++emitted>=12)break;}}
  /** Ponto do anel tangente em torno de `centre`; no plano é `sin` em X e `cos` em Z, como antes. */
  private ringInto(centre:Vec3,angle:number,radius:number,lift:number,out:Vector3):Vector3 {
    if(!this.surface)return out.copyFromFloats(centre.x+Math.sin(angle)*radius,centre.y+lift,centre.z+Math.cos(angle)*radius);
    const basis=this.surface.basis(centre,DECAL_HINT),s=Math.sin(angle)*radius,c=Math.cos(angle)*radius;
    return out.copyFromFloats(
      centre.x+basis.right.x*s+basis.forward.x*c+basis.up.x*lift,
      centre.y+basis.right.y*s+basis.forward.y*c+basis.up.y*lift,
      centre.z+basis.right.z*s+basis.forward.z*c+basis.up.z*lift,
    );
  }
  render(dt:number):void {const camera=this.scene.activeCamera;for(const projectile of this.projectiles)if(projectile.active&&camera)projectile.mesh.isVisible=projectile.impact?.zone!=='fire'&&Vector3.DistanceSquared(camera.position,projectile.position)>.4;for(const root of this.roots)if(root.life>0){root.life-=dt;root.mesh.scaling.y=root.height*Math.min(1,(.85-root.life)*15,root.life*5);if(root.life<=0)root.mesh.setEnabled(false);}for(const w of this.warnings)if(w.active){const pulse=1+.035*Math.sin(w.remaining*30);if(w.kind==='cone')w.mesh.scaling.setAll(w.radius*pulse);else if(w.kind==='band'||w.kind==='aim')w.mesh.scaling.set(w.radius*pulse,1,w.stretch);else w.mesh.scaling.set(w.radius*pulse,1,w.radius*pulse);}for(const b of this.bursts)if(b.active){b.remaining-=dt;if(b.remaining<=0){b.active=false;b.mesh.setEnabled(false);continue;}
    // Queda pela vertical guardada no nascimento do caco: `(0,1,0)` na fazenda, radial no planeta.
    const fall=8*dt;b.velocity.set(b.velocity.x-b.up.x*fall,b.velocity.y-b.up.y*fall,b.velocity.z-b.up.z*fall);
    b.mesh.position.addInPlaceFromFloats(b.velocity.x*dt,b.velocity.y*dt,b.velocity.z*dt);if(b.remaining<.2)b.mesh.scaling.scaleInPlace(Math.exp(-dt*8));}}
  clear():void {for(const x of [...this.projectiles,...this.bursts]){x.active=false;x.mesh.setEnabled(false);}for(const w of this.warnings){w.mesh.setEnabled(false);w.mesh=w.circle;w.mesh.setEnabled(false);Object.assign(w,{active:false,remaining:0,damage:0,pulses:0,stretch:1,kind:''});}for(const mesh of [...this.cones,...this.bands,...this.summons])mesh.setEnabled(false);for(const root of this.roots){root.life=0;root.mesh.setEnabled(false);}}
  get active():number {return this.warnings.filter(x=>x.active).length+this.projectiles.filter(x=>x.active).length+this.bursts.filter(x=>x.active).length+this.roots.filter(x=>x.life>0).length;}
  /** Diagnóstico de vazamento: meshes auxiliares (cone/faixa/invocação) que continuam ligados. */
  get attachedShapes():number {return this.cones.filter(m=>m.isEnabled()).length+this.bands.filter(m=>m.isEnabled()).length+this.summons.filter(m=>m.isEnabled()).length;}
}




import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {CreatePlane} from '@babylonjs/core/Meshes/Builders/planeBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
import {quaternionFromBasis,type SurfaceFrame} from '../physics/SurfaceFrame';
import {PERK_ICONS} from '../ui/PerkIcons';
import type {ItemDefinition} from './RunProgression';

export interface GroundLoot {item:ItemDefinition;root:TransformNode;start:Vector3;landing:Vector3;age:number;landed:boolean;waveField?:string;
 /** Vertical LOCAL do pouso. Ausente no mundo plano, onde ela é sempre `+Y`. */
 up?:Vec3}

/**
 * A chest owns one drop. No expiry: an opened chest never silently loses its reward.
 *
 * O referencial é lido de `world.surface` **a cada uso**, nunca guardado num campo: o
 * `configurePlanet` troca o `surface` do `CollisionWorld` depois que o mapa carrega, e uma cópia
 * capturada no construtor congelaria o item no plano para sempre.
 */
export class LootDrops {
 readonly active:GroundLoot[]=[];
 private readonly materials=new Map<number,StandardMaterial>();
 constructor(private readonly scene:Scene,private readonly world:CollisionWorld){}
 /** Referencial corrente. `undefined` enquanto o mundo for plano — daí vale o caminho literal. */
 private get radial():SurfaceFrame|undefined {
  const surface=this.world.surface;return surface.kind==='sphere'?surface:undefined;
 }
 private landing(origin:Vec3,toward:Vec3):Vector3 {
  const radial=this.radial;
  if(radial)return this.radialLanding(radial,origin,toward);
  const heading=Math.atan2(toward.x-origin.x,toward.z-origin.z);
  for(const radius of [1.5,1.9,1.1])for(const offset of [0,.65,-.65,1.3,-1.3,Math.PI]){
   const x=origin.x+Math.sin(heading+offset)*radius,z=origin.z+Math.cos(heading+offset)*radius;
   const y=this.world.groundAt(x,z,origin.y+.25);
   if(!Number.isFinite(y)||y<origin.y-.6)continue;
   const blocked=this.world.nearbyBoxes(x,z,.3).some(b=>b.min.x<x+.3&&b.max.x>x-.3&&b.min.z<z+.3&&b.max.z>z-.3&&b.max.y>y+.2&&b.min.y<y+1.5);
   if(!blocked)return new Vector3(x,y+.43,z);
  }
  // If every surrounding floor is obstructed, keep the reward reachable above its chest.
  return new Vector3(origin.x,origin.y+1.1,origin.z);
 }
 /**
  * O mesmo leque de tentativas do plano — três raios × seis desvios, na mesma ordem — só que
  * andado no plano TANGENTE e apoiado pela sonda radial. O item continua caindo entre o baú e o
  * jogador, e continua sendo colocado acima do baú quando tudo em volta está obstruído.
  */
 private radialLanding(surface:SurfaceFrame,origin:Vec3,toward:Vec3):Vector3 {
  const up=surface.up(origin);
  const away={x:toward.x-origin.x,y:toward.y-origin.y,z:toward.z-origin.z};
  const basis=surface.basis(origin,away);
  for(const radius of [1.5,1.9,1.1])for(const angle of [0,.65,-.65,1.3,-1.3,Math.PI]){
   const step={x:Math.sin(angle)*radius,z:Math.cos(angle)*radius};
   const probe=surface.walk(origin,{
    x:basis.right.x*step.x+basis.forward.x*step.z,
    y:basis.right.y*step.x+basis.forward.y*step.z,
    z:basis.right.z*step.x+basis.forward.z*step.z});
   const support=surface.support(probe,.25,.6);
   if(!support)continue;
   const point=support.point;
   // Queda e recuperação: apoio mais de 0,6 m abaixo da origem é beirada, não chão de entrega.
   if(surface.heightGap(point,origin)<-.6)continue;
   if(surface.insideSolid(point,1.2))continue;
   const head=add(point,surface.up(point),.2);
   if(surface.sweep(head,scale(surface.up(point),.6),.3))continue;
   return toVector(add(point,surface.up(point),.43));
  }
  return toVector(add(origin,up,1.1));
 }
 eject(item:ItemDefinition,origin:Vec3,toward:Vec3):GroundLoot {
  let material=this.materials.get(item.icon);
  if(!material){material=new StandardMaterial(`loot-icon-${item.icon}`,this.scene);const texture=new Texture(`/perks/${PERK_ICONS[item.icon]}`,this.scene);texture.hasAlpha=true;material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;material.emissiveColor=new Color3(.7,.7,.7);material.specularColor=Color3.Black();material.backFaceCulling=false;material.transparencyMode=StandardMaterial.MATERIAL_ALPHATESTANDBLEND;this.materials.set(item.icon,material);}
  const root=new TransformNode(`dropped-${item.id}`,this.scene);
  // A double-sided RGBA card rotates as the original flat item illustration.
  for(let i=0;i<1;i++){const card=CreatePlane(`loot-${item.id}-${i}`,{size:.65},this.scene);card.parent=root;card.rotation.y=i*Math.PI/2;card.material=material;card.isPickable=false;}
  const radial=this.radial;
  const up=radial?radial.up(origin):undefined;
  const start=up?toVector(add(origin,up,.78)):new Vector3(origin.x,origin.y+.78,origin.z);
  root.position.copyFrom(start);
  const landing=this.landing(origin,toward);
  const drop:GroundLoot={item,root,start,landing,age:0,landed:false,
   ...(radial?{up:radial.up({x:landing.x,y:landing.y,z:landing.z})}:{})};
  this.active.push(drop);return drop;
 }
 update(dt:number):void {
  for(const d of this.active){
   d.age+=dt;const t=Math.min(1,d.age/.85);
   Vector3.LerpToRef(d.start,d.landing,t,d.root.position);
   const hop=Math.sin(Math.PI*t)*1.15,bob=t>=1?Math.sin((d.age-.85)*2.4)*.035:0;
   d.landed=t>=1;
   if(d.up){
    // Subir é subir na vertical LOCAL: no equador do planeta o `+Y` do mundo é horizontal.
    d.root.position.addInPlaceFromFloats(d.up.x*(hop+bob),d.up.y*(hop+bob),d.up.z*(hop+bob));
    d.root.rotationQuaternion=spinAround(d.up,d.age*1.65);
   }else{
    d.root.position.y+=hop;d.root.rotation.y=d.age*1.65;
    if(d.landed)d.root.position.y+=bob;
   }
  }
 }
 nearest(position:Vec3):GroundLoot|undefined {
  const radial=this.radial;
  if(radial){
   const reach=(d:GroundLoot)=>radial.planarDistance(position,d.landing);
   return this.active
    .filter(d=>d.landed&&Math.abs(radial.heightGap(position,footOf(d)))<1.8&&reach(d)<1.8)
    .sort((a,b)=>reach(a)-reach(b))[0];
  }
  return this.active.filter(d=>d.landed&&Math.abs(position.y-(d.landing.y-.43))<1.8&&Math.hypot(position.x-d.landing.x,position.z-d.landing.z)<1.8).sort((a,b)=>Math.hypot(position.x-a.landing.x,position.z-a.landing.z)-Math.hypot(position.x-b.landing.x,position.z-b.landing.z))[0];
 }
 take(position:Vec3):ItemDefinition|undefined {const drop=this.nearest(position);if(!drop)return;this.active.splice(this.active.indexOf(drop),1);drop.root.dispose();return drop.item;}
 clear():void {for(const d of this.active)d.root.dispose();this.active.length=0;}
 dispose():void {this.clear();for(const m of this.materials.values())m.dispose(false,true);this.materials.clear();}
}

/** Pé do card: o ponto de pouso menos os 0,43 m de levantamento, ao longo da vertical dele. */
function footOf(drop:GroundLoot):Vec3 {
 const up=drop.up??{x:0,y:1,z:0};
 return {x:drop.landing.x-up.x*.43,y:drop.landing.y-up.y*.43,z:drop.landing.z-up.z*.43};
}
const add=(p:Vec3,d:Vec3,s:number):Vec3=>({x:p.x+d.x*s,y:p.y+d.y*s,z:p.z+d.z*s});
const scale=(d:Vec3,s:number):Vec3=>({x:d.x*s,y:d.y*s,z:d.z*s});
const toVector=(p:Vec3):Vector3=>new Vector3(p.x,p.y,p.z);

/**
 * O mesmo giro de vitrine de sempre, agora em torno da vertical local: o card fica de pé sobre a
 * ilha em vez de deitado no plano `XZ` do mundo.
 */
function spinAround(up:Vec3,angle:number):Quaternion {
 const seed=Math.abs(up.y)<.9?{x:0,y:1,z:0}:{x:0,y:0,z:1};
 const rightRaw=cross(seed,up),length=Math.hypot(rightRaw.x,rightRaw.y,rightRaw.z)||1;
 const right={x:rightRaw.x/length,y:rightRaw.y/length,z:rightRaw.z/length};
 const base=cross(up,right);
 const cos=Math.cos(angle),sin=Math.sin(angle);
 const forward={x:base.x*cos+right.x*sin,y:base.y*cos+right.y*sin,z:base.z*cos+right.z*sin};
 const q=quaternionFromBasis(cross(up,forward),up,forward);
 return new Quaternion(q.x,q.y,q.z,q.w);
}
const cross=(a:Vec3,b:Vec3):Vec3=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});

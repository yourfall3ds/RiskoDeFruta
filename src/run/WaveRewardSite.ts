import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {SurfaceFrame} from '../physics/SurfaceFrame';
import type {WorldSite} from '../world/GameWorld';
import {DISTRICT_CONTRACTS} from './DistrictContracts';

export const WAVE_FIELDS=[{id:'initial',name:'Campo inicial',x:0,y:0,z:0},...DISTRICT_CONTRACTS] as const;
export interface WaveRewardSite {name:string;position:Vec3}

/** Campo candidato à recompensa, já independente de eixo de mundo. */
export interface RewardField {readonly id:string;readonly name:string;readonly centre:Vec3;readonly radius?:number}

export interface WaveRewardOptions {
 /** Campos candidatos. Ausente ⇒ `WAVE_FIELDS`, os campos autorais da fazenda. */
 readonly fields?:readonly RewardField[];
 /** Referencial CORRENTE. Ausente ⇒ caminho plano literal de hoje. */
 readonly surface?:SurfaceFrame;
}

/**
 * Espaço reservado para a ejeção e para a cápsula do jogador ao recolher.
 * São os mesmos nove pontos do jogo plano; no planeta eles viram deslocamentos TANGENTES.
 */
const CLEARANCE:readonly (readonly [number,number])[]=[[0,0],[2.3,0],[-2.3,0],[0,2.3],[0,-2.3],[1.65,1.65],[-1.65,1.65],[1.65,-1.65],[-1.65,-1.65]];

/** `WorldSite[]` → campos de recompensa. O sítio do mapa é o campo. */
export function sitesAsFields(sites:readonly WorldSite[]):RewardField[] {
 return sites.map(site=>({id:site.id,name:site.name,centre:site.centre,radius:site.radius}));
}

/**
 * Piso seguro e desobstruído em torno de uma âncora, medido no referencial dado.
 *
 * É a MESMA regra do jogo plano — anéis crescentes, nove sondas de folga, degrau máximo de meio
 * metro, recusa de sólido e de teto baixo. O que muda é de onde vêm os eixos: `surface.basis` em
 * vez de X/Z do mundo, e `surface.support` em vez de `groundAt`. Numa esfera os anéis são
 * geodésicos, então a folga continua valendo 2,3 m de CAMINHADA, não de corda.
 */
export function surfaceRewardGround(surface:SurfaceFrame,anchor:Vec3,maxRings=4,drop=14):Vec3|undefined {
 const up=surface.up(anchor),basis=surface.basis(anchor,pickTangent(up));
 for(let ring=0;ring<=maxRings;ring++){
  const radius=ring*3.5;
  for(let i=0;i<(ring?12:1);i++){
   const angle=i*Math.PI/6;
   const probe=surface.walk(anchor,tangent(basis,Math.sin(angle)*radius,Math.cos(angle)*radius));
   // Morte no ar ou na borda: aceita apoio vários metros abaixo do ponto do abate.
   const support=surface.support(probe,1.5,drop);
   if(!support)continue;
   const point=support.point;
   let clear=true;
   for(const [dx,dz] of CLEARANCE){
    const near=surface.walk(point,tangent(surface.basis(point,basis.forward),dx,dz));
    const step=surface.support(near,.5,2);
    if(!step||Math.abs(surface.heightGap(step.point,point))>.5){clear=false;break;}
    if(surface.insideSolid(step.point,1.8)){clear=false;break;}
    const head=offset(step.point,surface.up(step.point),.8);
    if(surface.sweep(head,offset({x:0,y:0,z:0},surface.up(step.point),.6),.35)){clear=false;break;}
   }
   if(clear)return point;
  }
 }
 return undefined;
}

/** Tangente estável para semear a base quando não há direção preferida. */
function pickTangent(up:Vec3):Vec3 {
 return Math.abs(up.y)<.9?{x:0,y:1,z:0}:{x:0,y:0,z:1};
}
function tangent(basis:{right:Vec3;forward:Vec3},x:number,z:number):Vec3 {
 return {x:basis.right.x*x+basis.forward.x*z,y:basis.right.y*x+basis.forward.y*z,z:basis.right.z*x+basis.forward.z*z};
}
function offset(p:Vec3,direction:Vec3,scale:number):Vec3 {
 return {x:p.x+direction.x*scale,y:p.y+direction.y*scale,z:p.z+direction.z*scale};
}

/**
 * Only the closest field may receive the reward. Unloaded/obstructed terrain defers delivery.
 *
 * Dois argumentos ⇒ exatamente o caminho de hoje, sem passar por `SurfaceFrame`: é ele o oráculo
 * de regressão da fazenda. Com `options.surface` esférico, a mesma regra roda no referencial local.
 */
export function waveRewardSite(world:CollisionWorld,player:Vec3,options?:WaveRewardOptions):WaveRewardSite|undefined {
 const surface=options?.surface;
 if(surface&&surface.kind==='sphere')return sphericalSite(surface,player,options?.fields??sitesFallback());
 const fields=options?.fields;
 if(fields)return flatSite(world,player,fields);
 // Caminho original, literal, com os campos autorais.
 const field=WAVE_FIELDS.reduce((a,b)=>Math.hypot(a.x-player.x,a.z-player.z)<=Math.hypot(b.x-player.x,b.z-player.z)?a:b);
 for(const radius of [0,4,8,12,16])for(let i=0;i<(radius?16:1);i++){
  const angle=i*Math.PI/8,x=field.x+Math.sin(angle)*radius,z=field.z+Math.cos(angle)*radius;
  const y=world.groundAt(x,z,field.y+.5);
  if(!Number.isFinite(y)||y<field.y-8)continue;
  // Reserve a patch large enough for the ejection and the player's pickup capsule.
  let clear=true;
  for(const [dx,dz] of CLEARANCE){
   const p={x:x+dx!,y:world.groundAt(x+dx!,z+dz!,y+.5),z:z+dz!};
   if(!Number.isFinite(p.y)||Math.abs(p.y-y)>.5||world.insideSolid(p,1.8)||world.sweepSphere({x:p.x,y:p.y+.8,z:p.z},{x:0,y:.6,z:0},.35,true)){clear=false;break;}
  }
  if(clear)return {name:field.name,position:{x,y,z}};
 }
 return undefined;
}

/** Campos autorais no formato genérico, para quem passa `fields` sem querer trocá-los. */
function sitesFallback():readonly RewardField[] {
 return WAVE_FIELDS.map(f=>({id:f.id,name:f.name,centre:{x:f.x,y:f.y,z:f.z}}));
}

/** Mesma busca do caminho original, com campos vindos do mapa em vez dos literais da fazenda. */
function flatSite(world:CollisionWorld,player:Vec3,fields:readonly RewardField[]):WaveRewardSite|undefined {
 const field=nearestField(fields,player,(a,b)=>Math.hypot(a.x-b.x,a.z-b.z));
 if(!field)return undefined;
 const c=field.centre;
 for(const radius of [0,4,8,12,16])for(let i=0;i<(radius?16:1);i++){
  const angle=i*Math.PI/8,x=c.x+Math.sin(angle)*radius,z=c.z+Math.cos(angle)*radius;
  const y=world.groundAt(x,z,c.y+.5);
  if(!Number.isFinite(y)||y<c.y-8)continue;
  let clear=true;
  for(const [dx,dz] of CLEARANCE){
   const p={x:x+dx!,y:world.groundAt(x+dx!,z+dz!,y+.5),z:z+dz!};
   if(!Number.isFinite(p.y)||Math.abs(p.y-y)>.5||world.insideSolid(p,1.8)||world.sweepSphere({x:p.x,y:p.y+.8,z:p.z},{x:0,y:.6,z:0},.35,true)){clear=false;break;}
  }
  if(clear)return {name:field.name,position:{x,y,z}};
 }
 return undefined;
}

/** O campo mais próximo por ARCO, e o piso seguro dentro dele. */
function sphericalSite(surface:SurfaceFrame,player:Vec3,fields:readonly RewardField[]):WaveRewardSite|undefined {
 const field=nearestField(fields,player,(a,b)=>surface.planarDistance(a,b));
 if(!field)return undefined;
 const ground=surfaceRewardGround(surface,field.centre,4,8);
 return ground?{name:field.name,position:ground}:undefined;
}

function nearestField(fields:readonly RewardField[],player:Vec3,metric:(a:Vec3,b:Vec3)=>number):RewardField|undefined {
 let best:RewardField|undefined,bestDistance=Infinity;
 for(const field of fields){const d=metric(field.centre,player);if(d<bestDistance){bestDistance=d;best=field;}}
 return best;
}

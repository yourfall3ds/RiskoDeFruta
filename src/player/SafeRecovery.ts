import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {SurfaceFrame} from '../physics/SurfaceFrame';
import {tangentFrom} from '../physics/SurfaceFrame';
import {PLAYER_TUNING as t} from './PlayerTuning';

/**
 * Recuperação de apoio, agora medida pela vertical LOCAL.
 *
 * As assinaturas não mudaram e o comportamento no mundo plano é **idêntico bit a bit**: com
 * `up = (0,1,0)`, `forward = (0,0,1)` e `right = (1,0,0)`, `walk(p, right·cos·r + forward·sin·r)`
 * devolve exatamente `{x + cos·r, y, z + sin·r}`, e `support(p, above, Infinity)` é exatamente
 * `groundAt(p.x, p.z, p.y + above, maxSlope)`. No planeta os anéis passam a ser geodésicos e a
 * última cartada (varrer `recoverySurfaces()`) vira anéis largos, porque a esfera não tem lista de
 * `GroundSurface`.
 */

/** A broad, exposed floor with enough room for the entire player capsule. */
export function safeRecoverySupport(world:CollisionWorld,p:Vec3):boolean {
 const s=world.surface;
 if(![p.x,p.y,p.z].every(Number.isFinite)||world.onMovingGround(p)||s.insideSolid(p,t.height))return false;
 // A ledge under another walkable surface must not replace the island-top checkpoint.
 const top=s.support(p,Infinity,Infinity,t.maxSlopeDegrees);
 if(!top||Math.abs(top.offset)>.12)return false;
 const basis=s.basis(p,{x:0,y:0,z:1}),up=basis.up;
 for(let i=0;i<8;i++){
  const angle=i*Math.PI/4,r=t.radius+.45;
  const probe=s.walk(p,tangentFrom(basis,Math.cos(angle)*r,Math.sin(angle)*r));
  const sample=s.support(probe,.4,Infinity,t.maxSlopeDegrees);
  if(!sample||Math.abs(sample.offset)>.4)return false;
 }
 // Sweep a sphere from ankles to head: this covers the full capsule and detects walls/ceilings.
 const ankles={x:p.x+up.x*(t.radius+.04),y:p.y+up.y*(t.radius+.04),z:p.z+up.z*(t.radius+.04)};
 const rise=t.height-2*t.radius;
 return !s.sweep(ankles,{x:up.x*rise,y:up.y*rise,z:up.z*rise},t.radius);
}

/** Resolve stale or buried checkpoints to a validated top surface, never copy them blindly. */
export function findSafeRecovery(world:CollisionWorld,preferred:Vec3,fallback:Vec3):Vec3|undefined {
 const s=world.surface;
 const probe=(at:Vec3):Vec3|undefined=>{
  const sample=s.support(at,Infinity,Infinity,t.maxSlopeDegrees);
  if(!sample)return undefined;
  const p={...sample.point};return safeRecoverySupport(world,p)?p:undefined;
 };
 const ring=(anchor:Vec3,radius:number,steps:number):Vec3|undefined=>{
  const basis=s.basis(anchor,{x:0,y:0,z:1});
  for(let i=0;i<steps;i++){
   const a=i/steps*Math.PI*2;
   const found=probe(s.walk(anchor,tangentFrom(basis,Math.cos(a)*radius,Math.sin(a)*radius)));
   if(found)return found;
  }
  return undefined;
 };
 for(const anchor of [preferred,fallback]){
  // First lift the checkpoint to the uppermost floor at the same horizontal position.
  const direct=probe(anchor);if(direct)return direct;
  for(const radius of [1.5,3,5,8]){const found=ring(anchor,radius,12);if(found)return found;}
 }
 if(s.kind!=='flat'){
  // Numa esfera não existe lista de pisos autorados: o último recurso é abrir o anel geodésico,
  // que é exatamente como o convés de uma ilha vizinha ou de uma ponte é reencontrado.
  for(const anchor of [preferred,fallback])
   for(const radius of [14,24,40,64,100]){const found=ring(anchor,radius,16);if(found)return found;}
  return undefined;
 }
 const floors=[...world.recoverySurfaces()].filter(floor=>floor.width>2&&floor.depth>2)
  .sort((a,b)=>Math.hypot(a.x-preferred.x,a.z-preferred.z)-Math.hypot(b.x-preferred.x,b.z-preferred.z));
 for(const floor of floors){
  // Keep well inside the rim; try the centre and a small interior grid around structures.
  for(const [u,v] of [[0,0],[-.25,0],[.25,0],[0,-.25],[0,.25],[-.25,-.25],[.25,.25]]){
   const found=probe({x:floor.x+u!*floor.width,y:preferred.y,z:floor.z+v!*floor.depth});if(found)return found;
  }
 }
 return undefined;
}

/** Referencial em uso por este mundo — açúcar para quem só quer a vertical local. */
export function worldSurface(world:CollisionWorld):SurfaceFrame {return world.surface;}

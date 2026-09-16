import {sweepCapsuleBox} from './CapsuleBox';
import {SolidInteriors} from './SolidInteriors';
import {actorContact,type SolidActor} from './ActorContact';
import type { Vec3 } from '../core/contracts';
import {StaticRayIndex,type RayIndexSnapshot} from './StaticRayIndex';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Ray} from '@babylonjs/core/Culling/ray';
import { TriangleGround,type GroundSample } from './TriangleGround';
export type { GroundSample } from './TriangleGround';
export interface BoxCollider { id: string; min: Vec3; max: Vec3 }
export interface GroundSurface { id: string; x: number; z: number; width: number; depth: number; height: number; slopeX?: number; slopeZ?: number; ellipse?:boolean }
export interface SweepHit { time: number; normal: Vec3; collider: BoxCollider }

/** Continuous sphere vs expanded AABB: conservative at corners, no tunnelling through thin walls. */
export function sweepBox(origin: Vec3, delta: Vec3, box: BoxCollider, radius = 0): SweepHit | undefined {
  let enter = 0; let exit = 1; const normal = {x:0,y:0,z:0};
  for (const axis of ['x','y','z'] as const) {
    const low = box.min[axis] - radius; const high = box.max[axis] + radius;
    if (Math.abs(delta[axis]) < 1e-10) { if (origin[axis] < low || origin[axis] > high) return; continue; }
    let a = (low-origin[axis])/delta[axis]; let b = (high-origin[axis])/delta[axis];
    const sign = delta[axis] > 0 ? -1 : 1;
    if(a>b) [a,b]=[b,a];
    if(a>=enter) {enter=a;normal.x=0;normal.y=0;normal.z=0;normal[axis]=sign;}
    exit=Math.min(exit,b); if(enter>exit) return;
  }
  if(exit<0 || enter>1) return;
  return {time:Math.max(0,enter),normal,collider:box};
}

export class CollisionWorld {
  private regionOwners=0;
  private readonly regions=new Map<string,{world:CollisionWorld;minX:number;maxX:number;minZ:number;maxZ:number}>();
  get regionCount():number{return this.regions.size;}
  regionIdsAt(p:Vec3,radius=0):string[]{const ids:string[]=[];for(const [id,r] of this.regions)if(p.x+radius>=r.minX&&p.x-radius<=r.maxX&&p.z+radius>=r.minZ&&p.z-radius<=r.maxZ)ids.push(id);return ids;}
  /** A prepared region becomes queryable atomically; stale release handles cannot detach replacements. */
  attachRegion(id:string,world:CollisionWorld):()=>void {
    if(this.regionOwners||!id||world===this||world.regions.size||world.geometry&&!world.rays)throw Error('Collision region must be independent and prepared');
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    const include=(x:number,z:number)=>{if(!Number.isFinite(x)||!Number.isFinite(z))throw Error('Invalid collision region coordinates');minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);};
    const positions=world.geometry?.positions??[];for(let i=0;i<positions.length;i+=3)include(positions[i]!,positions[i+2]!);
    for(const b of [...world.boxes,...world.movingBoxes]){include(b.min.x,b.min.z);include(b.max.x,b.max.z);}
    for(const s of world.surfaces){include(s.x-s.width/2,s.z-s.depth/2);include(s.x+s.width/2,s.z+s.depth/2);}
    if(!Number.isFinite(minX))throw Error('Empty collision region');
    const previous=this.regions.get(id);if(previous)previous.world.regionOwners--;
    const region={world,minX,maxX,minZ,maxZ};world.regionOwners++;this.regions.set(id,region);
    return()=>{if(this.regions.get(id)===region){this.regions.delete(id);world.regionOwners--;}};
  }
  private *nearbyRegions(x:number,z:number,radius=0):Generator<CollisionWorld>{for(const r of this.regions.values())if(x+radius>=r.minX&&x-radius<=r.maxX&&z+radius>=r.minZ&&z-radius<=r.maxZ)yield r.world;}
  private meshSweep(origin:Vector3,delta:Vector3,radius:number,height:number):ReturnType<StaticRayIndex['sweepCapsule']>{
    let nearest=this.rays?.sweepCapsule(origin,delta,radius,height);
    for(const world of this.nearbyRegions(origin.x+delta.x/2,origin.z+delta.z/2,Math.max(Math.abs(delta.x),Math.abs(delta.z))/2+radius)){
      const hit=world.rays?.sweepCapsule(origin,delta,radius,height);if(hit&&(!nearest||hit.time<nearest.time))nearest=hit;
    }return nearest;
  }
  private interiors:SolidInteriors|undefined;
  setRecoveryVolumes(positions:readonly number[],indices:readonly number[]):void {this.interiors=new SolidInteriors(positions,indices);}
  insideSolid(p:Vec3,height=1.8):boolean {const center={x:p.x,y:p.y+height*.5,z:p.z};if(this.interiors?.contains(center))return true;for(const world of this.nearbyRegions(p.x,p.z))if(world.insideSolid(p,height))return true;return this.nearbyBoxes(p.x,p.z,0).some(b=>center.x>b.min.x+.04&&center.x<b.max.x-.04&&center.z>b.min.z+.04&&center.z<b.max.z-.04&&center.y>b.min.y+.02&&center.y<b.max.y-.02);}
  readonly playerBodies=new Map<number,SolidActor>();
  readonly boxes: BoxCollider[] = [];readonly movingBoxes:BoxCollider[]=[];
  onMovingGround(p:Vec3):boolean{return this.surfaces.some(s=>s.id.startsWith("moving-")&&Math.abs(p.y-s.height)<.2&&((p.x-s.x)/(s.width/2))**2+((p.z-s.z)/(s.depth/2))**2<=1); }
  readonly surfaces: GroundSurface[] = [];
  readonly walkableLinks:{a:Vec3;b:Vec3;width:number}[]=[];
  readonly navigationPatches:{positions:number[];indices:number[]}[]=[];
  geometry:{positions:number[];indices:number[]}|undefined;
  private triangles:TriangleGround|undefined;private rays:StaticRayIndex|undefined;
  raycast(ray:Ray):ReturnType<StaticRayIndex["cast"]>{let result=this.rays?.cast(ray);for(const region of this.regions.values()){const hit=region.world.raycast(ray);if(hit&&(!result||hit.distance<result.distance))result=hit;}for(const box of this.movingBoxes){const hit=sweepBox(ray.origin,ray.direction.scale(ray.length),box);if(hit&&(!result||hit.time*ray.length<result.distance)){const distance=hit.time*ray.length;result={distance,point:ray.origin.add(ray.direction.scale(distance)),normal:new Vector3(hit.normal.x,hit.normal.y,hit.normal.z)};}}return result; }
  private boxCount=-1;private readonly cells=new Map<string,BoxCollider[]>();
  setGeometry(positions:number[],indices:number[]):void {if(this.regionOwners)throw Error('Detach collision region before changing geometry');this.geometry={positions,indices};this.triangles=new TriangleGround(positions,indices);this.rays=undefined;}
  async prepareRaycastsAsync():Promise<void>{
    if(!this.geometry||this.rays)return;if(typeof Worker==='undefined'){this.prepareRaycasts();return;}
    const geometry=this.geometry,worker=new Worker(new URL('../workers/collision-index.worker.ts',import.meta.url),{type:'module'});
    try{const snapshot=await new Promise<RayIndexSnapshot>((resolve,reject)=>{worker.onmessage=(e:MessageEvent<{snapshot?:RayIndexSnapshot;error?:string}>)=>e.data.snapshot?resolve(e.data.snapshot):reject(Error(e.data.error));worker.onerror=e=>reject(Error(e.message));worker.postMessage(geometry);});if(this.geometry===geometry)this.rays=new StaticRayIndex(geometry.positions,geometry.indices,snapshot);}finally{worker.terminate();}
  }
  prepareRaycasts():void{if(this.geometry&&!this.rays)this.rays=new StaticRayIndex(this.geometry.positions,this.geometry.indices);}
  nearbyBoxes(x:number,z:number,radius=2):BoxCollider[]{
    if(this.boxCount!==this.boxes.length){this.cells.clear();this.boxCount=this.boxes.length;for(const box of this.boxes)for(let bx=Math.floor(box.min.x/4);bx<=Math.floor(box.max.x/4);bx++)for(let bz=Math.floor(box.min.z/4);bz<=Math.floor(box.max.z/4);bz++){const key=`${bx},${bz}`,list=this.cells.get(key)??[];list.push(box);this.cells.set(key,list);}}
    const found=new Set<BoxCollider>();for(let bx=Math.floor((x-radius)/4);bx<=Math.floor((x+radius)/4);bx++)for(let bz=Math.floor((z-radius)/4);bz<=Math.floor((z+radius)/4);bz++)for(const box of this.cells.get(`${bx},${bz}`)??[])found.add(box);for(const box of this.movingBoxes)if(box.min.x<=x+radius&&box.max.x>=x-radius&&box.min.z<=z+radius&&box.max.z>=z-radius)found.add(box);for(const world of this.nearbyRegions(x,z,radius))for(const box of world.nearbyBoxes(x,z,radius))found.add(box);return [...found];
  }
  groundAt(x: number,z: number,maxHeight=Infinity,maxSlope=50): number {
    let height=this.triangles?.height(x,z,maxHeight,maxSlope)??-Infinity;for(const world of this.nearbyRegions(x,z))height=Math.max(height,world.groundAt(x,z,maxHeight,maxSlope));
    for(const s of this.surfaces) {
      if(Math.abs(x-s.x)>s.width/2 || Math.abs(z-s.z)>s.depth/2) continue;
      if(s.ellipse&&((x-s.x)/(s.width/2))**2+((z-s.z)/(s.depth/2))**2>1)continue;
      if(Math.atan(Math.hypot(s.slopeX??0,s.slopeZ??0))*180/Math.PI>maxSlope) continue;
      const y=s.height+(x-s.x)*(s.slopeX??0)+(z-s.z)*(s.slopeZ??0);
      if(y<=maxHeight+1e-5) height=Math.max(height,y);
    }
    for(const b of this.nearbyBoxes(x,z,0)) {
      if(b.id.startsWith("moving-"))continue;
      if(x>=b.min.x && x<=b.max.x && z>=b.min.z && z<=b.max.z && b.max.y<=maxHeight+1e-5) height=Math.max(height,b.max.y);
    }
    return height;
  }
  /**
   * Superfície real mais alta sob o ponto, sem descartar inclinações acima do limite jogável.
   * `groundAt` continua respondendo apenas o piso caminhável; este método existe para o
   * deslizamento controlado e para checar se um topo sólido coincide com a malha.
   */
  surfaceAt(x:number,z:number,maxHeight=Infinity):GroundSample|undefined {
    let best=this.triangles?.sample(x,z,maxHeight);
    const consider=(sample:GroundSample|undefined)=>{if(sample&&(!best||sample.height>best.height))best=sample;};
    for(const world of this.nearbyRegions(x,z))consider(world.surfaceAt(x,z,maxHeight));
    for(const s of this.surfaces){
      if(Math.abs(x-s.x)>s.width/2||Math.abs(z-s.z)>s.depth/2)continue;
      if(s.ellipse&&((x-s.x)/(s.width/2))**2+((z-s.z)/(s.depth/2))**2>1)continue;
      const y=s.height+(x-s.x)*(s.slopeX??0)+(z-s.z)*(s.slopeZ??0);if(y>maxHeight+1e-5)continue;
      const sx=s.slopeX??0,sz=s.slopeZ??0,length=Math.hypot(sx,1,sz);
      consider({height:y,normal:{x:-sx/length,y:1/length,z:-sz/length},slopeDegrees:Math.atan(Math.hypot(sx,sz))*180/Math.PI});
    }
    for(const b of this.nearbyBoxes(x,z,0)){
      if(b.id.startsWith('moving-'))continue;
      if(x>=b.min.x&&x<=b.max.x&&z>=b.min.z&&z<=b.max.z&&b.max.y<=maxHeight+1e-5)consider({height:b.max.y,normal:{x:0,y:1,z:0},slopeDegrees:0});
    }
    return best;
  }
  sweepSphere(origin: Vec3,delta: Vec3,radius: number,mesh=false): SweepHit | undefined {
    let closest: SweepHit | undefined;
    for(const box of this.nearbyBoxes(origin.x+delta.x*.5,origin.z+delta.z*.5,Math.max(Math.abs(delta.x),Math.abs(delta.z))*.5+radius)) {const hit=sweepBox(origin,delta,box,radius);if(hit && (!closest || hit.time<closest.time))closest=hit;}
    if(mesh){const hit=this.meshSweep(new Vector3(origin.x,origin.y-radius,origin.z),new Vector3(delta.x,delta.y,delta.z),radius,radius*2);if(hit&&(!closest||hit.time<closest.time))closest=hit;}
    return closest;
  }
  /**
   * Continuous full-height sweep for airborne movement, with sliding instead of wall penetration.
   *
   * Devolve `true` só quando o contato é piso ou teto DE VERDADE. Uma face íngreme tem normal com
   * componente vertical pequena, mas não sustenta: tratá-la como contato vertical zerava a queda e
   * deixava o corpo pairando na beira do penhasco. `supportNormalY` é o cosseno da inclinação
   * máxima caminhável — acima dela é piso, abaixo é parede.
   */
  moveAirborne(position:Vec3,delta:Vec3,radius:number,height:number,supportNormalY=Math.cos(50*Math.PI/180)):boolean {
    const remaining={...delta};let verticalHit=false;
    for(let iteration=0;iteration<4;iteration++){
      let nearest:{time:number;normal:Vec3}|undefined;
      for(const b of this.nearbyBoxes(position.x+remaining.x*.5,position.z+remaining.z*.5,Math.max(Math.abs(remaining.x),Math.abs(remaining.z))*.5+radius)){
        const box={id:b.id,min:{x:b.min.x-radius,y:b.min.y-height,z:b.min.z-radius},max:{x:b.max.x+radius,y:b.max.y,z:b.max.z+radius}};
        if(!sweepBox(position,remaining,box))continue;
        const hit=sweepCapsuleBox(position,remaining,b,radius,height);if(hit&&(!nearest||hit.time<nearest.time))nearest=hit;
      }
      const surface=this.meshSweep(new Vector3(position.x,position.y,position.z),new Vector3(remaining.x,remaining.y,remaining.z),radius,height);if(surface&&(!nearest||surface.time<nearest.time))nearest=surface;
      if(!nearest){position.x+=remaining.x;position.y+=remaining.y;position.z+=remaining.z;break;}
      const advance=Math.max(0,nearest.time-.0001);position.x+=remaining.x*advance;position.y+=remaining.y*advance;position.z+=remaining.z*advance;
      const left=1-advance;remaining.x*=left;remaining.y*=left;remaining.z*=left;
      const dot=remaining.x*nearest.normal.x+remaining.y*nearest.normal.y+remaining.z*nearest.normal.z;
      remaining.x-=dot*nearest.normal.x;remaining.y-=dot*nearest.normal.y;remaining.z-=dot*nearest.normal.z;
      if(nearest.normal.y>=supportNormalY||nearest.normal.y<=-.2)verticalHit=true;
    }return verticalHit;
  }
  constrainPlayer(origin:Vec3,delta:Vec3,radius:number,height:number):Vec3 {
    const p={...origin},remaining={...delta};
    for(let i=0;i<3;i++){
      let nearest:ReturnType<typeof actorContact>;
      for(const body of this.playerBodies.values()){if(!body.active())continue;const hit=actorContact(p,remaining,body,radius,height);if(hit&&(!nearest||hit.time<nearest.time))nearest=hit;}
      if(!nearest){p.x+=remaining.x;p.z+=remaining.z;break;}
      const advance=Math.max(0,nearest.time-.0001);p.x+=remaining.x*advance;p.z+=remaining.z*advance;
      remaining.x*=1-advance;remaining.z*=1-advance;const dot=remaining.x*nearest.normal.x+remaining.z*nearest.normal.z;remaining.x-=dot*nearest.normal.x;remaining.z-=dot*nearest.normal.z;
    }return{x:p.x-origin.x,y:delta.y,z:p.z-origin.z};
  }
  move(position: Vec3,dx: number,dz: number,radius: number,height: number,step: number,mesh=false): void {
    let remaining={x:dx,y:0,z:dz};
    for(let iteration=0;iteration<3;iteration++) {
      let nearest: SweepHit | undefined;
      for(const b of this.nearbyBoxes(position.x,position.z,Math.max(Math.abs(remaining.x),Math.abs(remaining.z))+radius)) {
        if(b.max.y<=position.y+step+0.002 || b.min.y>=position.y+height)continue;
        const box={...b,min:{...b.min,y:-1e6},max:{...b.max,y:1e6}};
        const hit=sweepBox(position,remaining,box,radius);
        if(hit && (hit.normal.x!==0 || hit.normal.z!==0) && (!nearest || hit.time<nearest.time))nearest=hit;
      }
      if(mesh){const hit=this.meshSweep(new Vector3(position.x,position.y+step,position.z),new Vector3(remaining.x,0,remaining.z),radius,Math.max(radius*2,height-step));if(hit&&(!nearest||hit.time<nearest.time))nearest=hit;}
      if(!nearest) {position.x+=remaining.x;position.z+=remaining.z;break;}
      const time=Math.max(0,nearest.time-0.001);
      position.x+=remaining.x*time;position.z+=remaining.z*time;
      const leftover=1-time;
      remaining.x*=leftover;remaining.z*=leftover;
      const dot=remaining.x*nearest.normal.x+remaining.z*nearest.normal.z;
      remaining.x-=dot*nearest.normal.x;remaining.z-=dot*nearest.normal.z;
    }
  }
}

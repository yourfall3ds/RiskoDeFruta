import {init,Crowd,NavMeshQuery,importNavMesh,type CrowdAgent,type NavMesh} from '@recast-navigation/core';
import {generateTiledNavMesh} from '@recast-navigation/generators';
import {NavigationTileResidency} from './NavigationTileResidency';
import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
let initialization:Promise<void>|undefined;
export function navigationGeometry(world:CollisionWorld):{positions:number[];indices:number[]} {
  const positions:number[]=[],indices:number[]=[];
  // Smooth authored floors keep bridges and stairs connected even with sub-centimetre visual gaps.
  for(const s of world.surfaces){const base=positions.length/3,steps=s.ellipse?64:4;positions.push(s.x,s.height,s.z);
    for(let i=0;i<steps;i++){const a=i/steps*Math.PI*2,x=s.ellipse?Math.cos(a)*s.width/2:[-1,1,1,-1][i]!*s.width/2,z=s.ellipse?Math.sin(a)*s.depth/2:[-1,-1,1,1][i]!*s.depth/2;positions.push(s.x+x,s.height+x*(s.slopeX??0)+z*(s.slopeZ??0),s.z+z);}
    for(let i=0;i<steps;i++)indices.push(base,base+1+(i+1)%steps,base+1+i);
  }
  for(const link of world.walkableLinks??[]){const dx=link.b.x-link.a.x,dz=link.b.z-link.a.z,length=Math.hypot(dx,dz);if(length<.01)continue;const rx=-dz/length*link.width/2,rz=dx/length*link.width/2,base=positions.length/3;
    for(const [p,side] of [[link.a,-1],[link.a,1],[link.b,1],[link.b,-1]] as const)positions.push(p.x+rx*side,p.y,p.z+rz*side);
    indices.push(base,base+1,base+2,base,base+2,base+3);
  }
  for(const patch of world.navigationPatches??[]){const offset=positions.length/3;for(const value of patch.positions)positions.push(value);for(const index of patch.indices)indices.push(index+offset);}
  for(const box of world.boxes){const b=positions.length/3;
    // Reward crates are obstacles for the crowd, never stair steps. Physics keeps the authored height.
    const crate=/^(interactive|city|frontier|highland|rootwood)-chest-/.test(box.id??''),top=crate?Math.max(box.max.y,box.min.y+1.8):box.max.y;for(const [x,y,z] of [[0,0,0],[1,0,0],[1,0,1],[0,0,1],[0,1,0],[1,1,0],[1,1,1],[0,1,1]])positions.push(x?box.max.x:box.min.x,y?top:box.min.y,z?box.max.z:box.min.z);
    for(const i of [4,7,6,4,6,5,0,1,2,0,2,3,0,4,5,0,5,1,1,5,6,1,6,2,2,6,7,2,7,3,3,7,4,3,4,0])indices.push(b+i);
  }
  return{positions,indices};
}
/** Recast polygon mesh, Detour crowd avoidance, and stable attack slots around the player. */
export class TacticalNavigation {
  readonly crowd:Crowd;readonly query:NavMeshQuery;private agents=new Map<number,CrowdAgent>();private playerAgent:CrowdAgent|undefined;private readonly slots=new Map<number,{rank:number;ranged:boolean}>();private readonly goals=new Map<number,Vec3>();
  private residency:NavigationTileResidency|undefined;private residencyClock=0;private residencyPosition:Vec3|undefined;
  private readonly takenRanks:boolean[]=[];
  private constructor(private readonly mesh:NavMesh){this.query=new NavMeshQuery(mesh,{maxNodes:8192});this.query.defaultQueryHalfExtents={x:2,y:3,z:2};this.crowd=new Crowd(mesh,{maxAgents:162,maxAgentRadius:3});}
  static async create(world:CollisionWorld,baked=false):Promise<TacticalNavigation>{
    initialization??=init();await initialization;
    if(baked){
      const response=await fetch('/models/farm-navmesh.bin');
      if(!response.ok)throw Error('Falha ao carregar navmesh');
      const navigation=new TacticalNavigation(importNavMesh(new Uint8Array(await response.arrayBuffer())).navMesh);
      navigation.residency=new NavigationTileResidency(navigation.mesh);return navigation;
    }
    const data=navigationGeometry(world);
    const low:[number,number,number]=[Infinity,Infinity,Infinity],high:[number,number,number]=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<data.positions.length;i++){
      const axis=i%3;low[axis]=Math.min(low[axis]!,data.positions[i]!);high[axis]=Math.max(high[axis]!,data.positions[i]!);
    }
    // Keep the raster grid aligned as new districts extend the world bounds.
    for(let axis=0;axis<3;axis++){
      const cell=axis===1?.1:25.6;
      low[axis]=Math.floor((low[axis]!-2)/cell)*cell;high[axis]=Math.ceil((high[axis]!+2)/cell)*cell;
    }
    const result=generateTiledNavMesh(data.positions,data.indices,{
      tileSize:128,cs:.2,ch:.1,walkableSlopeAngle:49,walkableHeight:18,
      // The suspended west bridge drops 0.52 m at its island landing.
      walkableClimb:6,walkableRadius:3,minRegionArea:8,mergeRegionArea:20,
      maxSimplificationError:1.1,detailSampleDist:6,detailSampleMaxError:1,bounds:[low,high],
    });
    if(!result.success)throw Error('Falha no navmesh: '+result.error);
    return new TacticalNavigation(result.navMesh);
  }
  closest(p:Vec3):Vec3|undefined{const r=this.query.findClosestPoint(p);return r.success?r.point:undefined;}
  reachable(p:Vec3,target:Vec3):boolean {const nearest=this.closest(p);if(!nearest||Math.hypot(p.x-nearest.x,p.z-nearest.z)>1.4)return false;const path=this.query.computePath(nearest,target,{maxPathPolys:2048,maxStraightPathPoints:2048});return path.success&&path.path.length>0&&Math.hypot(path.path.at(-1)!.x-target.x,path.path.at(-1)!.z-target.z)<3;}
  add(id:number,p:Vec3,radius:number,speed:number):boolean {this.remove(id);const nearest=this.closest(p);if(!nearest)return false;const agent=this.crowd.addAgent(nearest,{radius,height:1.8,maxSpeed:speed,maxAcceleration:16,collisionQueryRange:radius*10,pathOptimizationRange:12,separationWeight:3.5,updateFlags:31,obstacleAvoidanceType:0});if(agent.state()===0){this.crowd.removeAgent(agent);return false;}this.agents.set(id,agent);return true;}
  remove(id:number):void {const agent=this.agents.get(id);if(agent)this.crowd.removeAgent(agent);this.agents.delete(id);this.slots.delete(id);this.goals.delete(id);}
  /**
   * Menor sector livre da classe, sem montar lista/`Set` novos a cada chamada. `target` roda uma vez
   * por ator por tique, então as três listas intermediárias de antes eram O(agentes) de lixo por ator.
   * Só interessam ranks abaixo do total de ocupantes — acima disso o primeiro buraco já apareceu.
   */
  private freeRank(id:number,ranged:boolean):number {
    const taken=this.takenRanks,limit=this.slots.size+1;
    if(taken.length<limit)taken.length=limit;
    taken.fill(false,0,limit);
    this.slots.forEach((slot,other)=>{if(other!==id&&slot.ranged===ranged&&slot.rank>=0&&slot.rank<limit)taken[slot.rank]=true;});
    let free=0;while(free<limit&&taken[free])free++;
    return free;
  }
  /** Each attacker owns a sector. Further ranks wait outside the inner attack circle. */
  target(id:number,player:Vec3,rank:number,ranged:boolean,speed:number):void {const a=this.agents.get(id);if(!a)return;const free=this.freeRank(id,ranged);const previous=this.slots.get(id);rank=previous?Math.min(previous.rank,free):free;this.slots.set(id,{rank,ranged});const slots=ranged?10:7,ring=Math.floor(rank/slots),angle=(rank%slots)/slots*Math.PI*2+(ranged?.31:0),radius=ranged?9+ring*2.1:2.0+ring*1.6;
    const wanted={x:player.x+Math.sin(angle)*radius,y:player.y,z:player.z+Math.cos(angle)*radius},near=this.closest(wanted);a.updateFlags=31;a.maxAcceleration=16;a.maxSpeed=speed;const goal=this.goals.get(id);if(goal&&Math.hypot(goal.x-wanted.x,goal.z-wanted.z)<.6)return;this.goals.set(id,wanted);if(near)a.requestMoveTarget(near);else a.requestMoveTarget(this.closest(player)??player);
  }
  velocity(id:number,velocity:Vec3,maxSpeed:number,committed=false):void {const a=this.agents.get(id);if(a){this.goals.delete(id);a.updateFlags=committed?0:31;a.maxAcceleration=committed?45:16;a.maxSpeed=maxSpeed;a.requestMoveVelocity(velocity);}}
  private updateResidency(dt:number,player:Vec3):void {
    if(!this.residency)return;
    this.residencyClock-=dt;
    const moved=!this.residencyPosition||Math.hypot(player.x-this.residencyPosition.x,player.z-this.residencyPosition.z)>25;
    if(this.residencyClock>0&&!moved)return;
    this.residencyClock=.5;this.residencyPosition={...player};
    const agents=[...this.agents.values()],points=[player,...agents.map(a=>a.position())];
    this.residency.ensureNear(points);
    const protectedTiles=new Set<number>();
    const protectPath=(from:Vec3,to:Vec3):boolean=>{
      const a=this.query.findNearestPoly(from),b=this.query.findNearestPoly(to);
      if(!a.nearestRef||!b.nearestRef)return false;
      const route=this.query.findPath(a.nearestRef,b.nearestRef,a.nearestPoint,b.nearestPoint,{maxPathPolys:2048});
      try{
        if(!route.success||!route.polys.size||route.polys.get(route.polys.size-1)!==b.nearestRef)return false;
        for(let i=0;i<route.polys.size;i++)protectedTiles.add(this.mesh.decodePolyId(route.polys.get(i)).tileIndex);
        return true;
      }finally{route.polys.destroy();}
    };
    for(const agent of agents){
      const from=agent.position();
      // Retain both the existing request and the next pursuit destination.
      for(const destination of [agent.target(),player]){
        if(protectPath(from,destination))continue;
        this.residency.restoreAll();
        if(!protectPath(from,destination))return; // Disconnected actor: retain safely until it is retired.
      }
    }
    this.residency.prune(points,protectedTiles);
  }
  /**
   * Devolve TODOS os tiles à malha antes de validar uma rota longa.
   *
   * `updateResidency` poda tudo a mais de 155 m do jogador e dos agentes. Uma rota entre duas ilhas
   * a 250 m atravessa exatamente os tiles podados, e `reachable` responderia "sem rota" por um
   * motivo de streaming, não de mapa. A poda volta a acontecer no `step` seguinte.
   */
  restoreNavigation():void {this.residency?.restoreAll();}
  get navigationResidency(){return this.residency?.stats;}
  get residencyDescription():string {const s=this.residency?.stats;return s?`Tiles ${s.resident}/${s.total} · Detour ${(s.residentBytes/1024).toFixed(0)} KiB · cache ${(s.cachedBytes/1024).toFixed(0)} KiB`:'Tiles sem streaming';}
  step(dt:number,player:Vec3):void {this.updateResidency(dt,player);const p=this.closest(player);if(p){if(!this.playerAgent)this.playerAgent=this.crowd.addAgent(p,{radius:.32,height:1.8,maxSpeed:0,separationWeight:0});else this.playerAgent.teleport(p);}this.crowd.update(dt);}
  position(id:number):Vec3|undefined{return this.agents.get(id)?.position();}
  motion(id:number):Vec3|undefined{return this.agents.get(id)?.velocity();}
  get count():number{return this.agents.size;}
  clear():void{for(const id of this.agents.keys())this.remove(id);}
  dispose():void{this.clear();this.crowd.destroy();this.query.destroy();this.residency?.dispose();this.mesh.destroy();}
}

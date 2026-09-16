/** Read the shipped collision + navigation assets and validate real spawn/chalice pairs. */
import {readFileSync,writeFileSync} from 'node:fs';
import {init,importNavMesh,NavMeshQuery} from '@recast-navigation/core';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {applyInitialRockFix} from '../src/world/terrain/InitialRocks';
import {sculptRegion,isSculptedRegion} from '../src/world/terrain/WorldTerrain';
import {STAGE_BIOMES} from '../src/stages/StageRoute';
import {planStage,HOME_MIN_ROUTE,WIDE_MIN_ROUTE} from '../src/stages/StagePlan';
import {findSpawnPoint} from '../src/stages/StageSpawn';
import {findTotemSite} from '../src/run/ExpeditionObjectives';
import {RunRNG} from '../src/core/RunRNG';
import type {Vec3} from '../src/core/contracts';
const read=(name:string)=>JSON.parse(readFileSync('public/models/'+name,'utf8'));
const world=new CollisionWorld(),base=read('farm-collision.json'),mesh=read('world-collision-mesh.json'),solid=read('solid-island-collision.json'),shape=read('outcrop-rocks.json');
applyInitialRockFix(mesh,read('initial-rock-fix.json'),shape);
const offset=mesh.positions.length/3;for(const x of solid.positions)mesh.positions.push(x);for(const x of solid.indices)mesh.indices.push(x+offset);
world.boxes.push(...base.boxes,...mesh.boxes,...solid.boxes);world.surfaces.push(...base.surfaces);
sculptRegion('base',{positions:mesh.positions,indices:mesh.indices,boxes:world.boxes});
world.setGeometry(mesh.positions,mesh.indices);world.setRecoveryVolumes(solid.positions,solid.indices);world.prepareRaycasts();
for(const biome of STAGE_BIOMES){
 const data=read(biome.region+'-collision.json'),part=new CollisionWorld();
 if(isSculptedRegion(biome.region!))sculptRegion(biome.region!,data,shape);
 part.boxes.push(...data.boxes);part.surfaces.push(...data.surfaces);part.setGeometry(data.positions,data.indices);part.setRecoveryVolumes(data.solidPositions,data.solidIndices);part.prepareRaycasts();world.attachRegion(biome.id,part);
}
await init();const nav=importNavMesh(new Uint8Array(readFileSync('public/models/farm-navmesh.bin'))).navMesh,query=new NavMeshQuery(nav,{maxNodes:8192});query.defaultQueryHalfExtents={x:2,y:3,z:2};
const reachable=(spawn:Vec3,chalice:Vec3)=>{
 const p=query.findClosestPoint(spawn);if(!p.success||Math.hypot(p.point.x-spawn.x,p.point.z-spawn.z)>1.4)return undefined;
 const route=query.computePath(p.point,chalice,{maxPathPolys:2048,maxStraightPathPoints:2048});
 if(!route.success||!route.path.length||Math.hypot(route.path.at(-1)!.x-chalice.x,route.path.at(-1)!.z-chalice.z)>=3)return undefined;
 return route.path.slice(1).reduce((total,p,i)=>total+Math.hypot(p.x-route.path[i]!.x,p.z-route.path[i]!.z),0);
};
const report=[];let failed=false;
for(const [index,biome] of STAGE_BIOMES.entries()){
 const points=biome.islands.map(i=>({id:i.id,spawn:findSpawnPoint(world,i),chalice:[11,8.5,6.5].map(r=>findTotemSite(world,i,r,()=>true)).find(Boolean)}));
 const seeds=['mutant-farm-m0',...Array.from({length:12},(_,i)=>'route-'+i)],plans=[];
 for(const seed of seeds){
  const rng=new RunRNG(`${seed}:stage:${index+1}`).stream('scene');
  const plan=planStage(biome,rng,{spawnPoint:i=>findSpawnPoint(world,i),chalicePoint:i=>points.find(p=>p.id===i.id)?.chalice,route:reachable},{minRoute:biome.separation>=150?WIDE_MIN_ROUTE:HOME_MIN_ROUTE});
  if(!plan)failed=true;
  plans.push({seed,spawn:plan?.spawnIsland.id,chalice:plan?.chaliceIsland.id,distance:plan?.distance,routeLength:plan?.routeLength,shortfall:plan?.shortfall,position:plan?.spawn});
 }
 report.push({biome:biome.id,points,plans});console.log(biome.id,JSON.stringify(plans));
}
writeFileSync('docs/stage-route-audit.json',JSON.stringify(report,null,2)+'\n');query.destroy();nav.destroy();
if(failed)throw Error('Some real biome routes have no valid distant island pair; see docs/stage-route-audit.json');

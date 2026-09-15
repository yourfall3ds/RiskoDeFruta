import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {chooseSpawnAround} from '../src/ai/SpawnPlanner';
import {RandomStream} from '../src/core/RunRNG';
import {CITY_CHESTS} from '../src/world/ExplorationSites';
import {CollisionWorld} from '../src/physics/CollisionWorld';
it('spawn sampling is deterministic and follows the player into distant districts',()=>{const player={x:900,y:12,z:-750},floor={groundAt:()=>12};const a=chooseSpawnAround(player,new RandomStream(42),floor,()=>true,()=>false),b=chooseSpawnAround(player,new RandomStream(42),floor,()=>true,()=>false);expect(a).toEqual(b);expect(Math.hypot(a!.x-player.x,a!.z-player.z)).toBeGreaterThanOrEqual(17);expect(Math.hypot(a!.x-player.x,a!.z-player.z)).toBeLessThanOrEqual(32);});
it('spawn failures use bounded work and never place enemies over the void or occupied ground',()=>{let attempts=0;const terrain={groundAt:()=>{attempts++;return -Infinity;}};expect(chooseSpawnAround({x:0,y:0,z:0},new RandomStream(1),terrain,()=>true,()=>false)).toBeUndefined();expect(attempts).toBe(24);expect(chooseSpawnAround({x:0,y:0,z:0},new RandomStream(1),{groundAt:()=>0},()=>true,()=>true)).toBeUndefined();});
it('all nine exploration chests have unique IDs and rest on real city ground',()=>{const data=JSON.parse(readFileSync('public/models/farm-city-collision.json','utf8')),world=new CollisionWorld();world.surfaces.push(...data.surfaces);world.setGeometry(data.positions,data.indices);expect(new Set(CITY_CHESTS.map(s=>s.id)).size).toBe(9);for(const chest of CITY_CHESTS)expect(world.groundAt(chest.x,chest.z,chest.y+.3)).toBeCloseTo(chest.y,1);});
import {init,importNavMesh,NavMeshQuery} from '@recast-navigation/core';
import {cityChestColliders} from '../src/world/ExplorationSites';
import {sweepBox} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/InputFrame';
it('the exported navigation routes around city crates instead of walking through them',async()=>{
 await init();const {navMesh}=importNavMesh(new Uint8Array(readFileSync('public/models/farm-navmesh.bin'))),query=new NavMeshQuery(navMesh);
 try{for(const box of cityChestColliders()){
  const x=(box.min.x+box.max.x)/2,z=(box.min.z+box.max.z)/2,y=box.min.y;
  const from={x:x-2,y,z},to={x:x+2,y,z},route=query.computePath(from,to);
  expect(route.success,box.id).toBe(true);expect(route.path.length,box.id).toBeGreaterThan(1);
  expect(Math.hypot(route.path.at(-1)!.x-to.x,route.path.at(-1)!.z-to.z),box.id).toBeLessThan(.4);
  for(let i=1;i<route.path.length;i++){const a=route.path[i-1]!,b=route.path[i]!,origin={x:a.x,y:y+.3,z:a.z},delta={x:b.x-a.x,y:0,z:b.z-a.z};expect(sweepBox(origin,delta,box,.2),box.id).toBeUndefined();}
 }}finally{query.destroy();navMesh.destroy();}
});
it('city crate stops player movement and projectiles using the same shared volume',()=>{
 const world=new CollisionWorld(),box=cityChestColliders()[0]!,site=CITY_CHESTS[0]!;world.movingBoxes.push(box);world.surfaces.push({id:'floor',x:site.x,z:site.z,width:12,depth:12,height:site.y});
 const player=new PlayerMotor(world,new EventBus(),{x:site.x,y:site.y,z:site.z-2});
 for(let i=0;i<60;i++)player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},0);
 expect(player.position.z).toBeLessThan(box.min.z);expect(player.position.y).toBeCloseTo(site.y,1);
 expect(world.sweepSphere({x:site.x,y:site.y+.4,z:site.z-2},{x:0,y:0,z:4},.02)?.collider.id).toBe(box.id);
});

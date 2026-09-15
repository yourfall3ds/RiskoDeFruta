import {it,expect,vi} from 'vitest';
import {TacticalNavigation} from '../src/ai/TacticalNavigation';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {readFileSync} from 'node:fs';
import {init,importNavMesh,NavMeshQuery} from '@recast-navigation/core';
import {NavigationTileResidency} from '../src/ai/NavigationTileResidency';
it('unloads distant tiles and repeatedly restores their original references and complete paths',async()=>{
 await init();const {navMesh}=importNavMesh(new Uint8Array(readFileSync('public/models/farm-navmesh.bin'))),query=new NavMeshQuery(navMesh),tiles=new NavigationTileResidency(navMesh),spawn={x:2,y:0,z:-16},far={x:285,y:15,z:280};
 try{
  const original=query.findNearestPoly(far).nearestRef,total=tiles.stats.total;
  for(let cycle=0;cycle<12;cycle++){
   tiles.prune([spawn],new Set());expect(tiles.stats.resident).toBeLessThan(total);expect(tiles.stats.residentBytes).toBeLessThan(tiles.stats.cachedBytes);
   expect(query.findNearestPoly(far).nearestRef).toBe(0);
   tiles.restoreAll();expect(tiles.stats.resident).toBe(total);expect(query.findNearestPoly(far).nearestRef).toBe(original);
   const path=query.computePath(spawn,far),end=path.path.at(-1)!;expect(Math.hypot(end.x-far.x,end.y-far.y,end.z-far.z)).toBeLessThan(.5);
  }
  const pinned=navMesh.decodePolyId(original).tileIndex;
  tiles.prune([spawn],new Set([pinned]));expect(query.findNearestPoly(far).nearestRef).toBe(original);
  tiles.ensureNear([far]);expect(query.findNearestPoly(far).nearestRef).toBe(original);
 }finally{query.destroy();tiles.dispose();tiles.dispose();navMesh.destroy();}
});

it('the game integration restores after teleport and keeps a pursuing agent on a valid route',async()=>{
 const bytes=new Uint8Array(readFileSync('public/models/farm-navmesh.bin'));
 vi.stubGlobal('fetch',async()=>new Response(bytes));
 const nav=await TacticalNavigation.create(new CollisionWorld(),true);
 try{
  nav.step(1/60,{x:0,y:0,z:0});expect(nav.navigationResidency!.resident).toBeLessThan(nav.navigationResidency!.total);
  nav.step(1/60,{x:285,y:15,z:280});expect(nav.closest({x:285,y:15,z:280})!.x).toBeCloseTo(285,0);
  nav.step(1/60,{x:0,y:0,z:0});expect(nav.add(1,{x:0,y:0,z:0},.6,4)).toBe(true);
  const player={x:-44,y:0,z:0};
  for(let i=0;i<1500;i++){nav.target(1,player,0,false,4);nav.step(1/60,player);}
  const p=nav.position(1)!;expect(Math.hypot(p.x-player.x,p.z-player.z)).toBeLessThan(3);
  expect(nav.navigationResidency!.resident).toBeLessThan(nav.navigationResidency!.total);
  nav.remove(1);nav.step(1,{x:285,y:15,z:280});expect(nav.count).toBe(0);
 }finally{nav.dispose();vi.unstubAllGlobals();}
});

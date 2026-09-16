import {it,expect} from 'vitest';
import {WALK_SPEED} from '../src/player/PlayerTuning';
import {readFileSync} from 'node:fs';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/InputFrame';
import {FRONTIER_CHESTS,frontierChestColliders} from '../src/world/ExplorationSites';
import {init,importNavMesh,NavMeshQuery} from '@recast-navigation/core';
import {loadCollision} from '../server/rooms/FarmRoom';
import {FarmSimulation} from '../server/FarmSimulation';
const data=JSON.parse(readFileSync('public/models/solar-frontier-collision.json','utf8'));
function world(){const root=new CollisionWorld(),region=new CollisionWorld();region.setGeometry(data.positions,data.indices);region.boxes.push(...data.boxes);region.prepareRaycasts();root.attachRegion('frontier',region);return root;}
it.each([0,1,2,3,4,5,6,7])('crosses real frontier bridge %i in both directions without falling or passing through the landing',index=>{
 const w=world(),link=data.walkableLinks[Math.floor(index/2)],a=index%2?link.b:link.a,b=index%2?link.a:link.b,p=new PlayerMotor(w,new EventBus(),{...a}),yaw=Math.atan2(b.x-a.x,b.z-a.z),distance=Math.hypot(b.x-a.x,b.z-a.z);
 for(let i=0;i<Math.ceil(distance/WALK_SPEED*60)+90;i++){if(Math.hypot(p.position.x-b.x,p.position.z-b.z)<.25)break;p.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},yaw);}
 expect(Math.hypot(p.position.x-b.x,p.position.z-b.z)).toBeLessThan(.4);expect(p.position.y).toBeCloseTo(b.y,0);expect(p.respawns).toBe(0);
});
it('frontier loot rests on authored terrain and does not overlap permanent structures',()=>{
 const w=world();expect(FRONTIER_CHESTS).toHaveLength(11);for(const chest of FRONTIER_CHESTS){expect(w.groundAt(chest.x,chest.z,chest.y+.25),chest.id).toBeCloseTo(chest.y,1);expect(w.insideSolid(chest,.7),chest.id).toBe(false);}expect(frontierChestColliders()).toHaveLength(11);
});
it('all frontier islands are reachable from the original spawn in the exported navmesh',async()=>{
 await init();const {navMesh}=importNavMesh(new Uint8Array(readFileSync('public/models/farm-navmesh.bin'))),query=new NavMeshQuery(navMesh);
 try{for(const to of [{x:248,y:9,z:45},{x:285,y:15,z:147},{x:285,y:15,z:280}]){const route=query.computePath({x:2,y:0,z:-16},to),end=route.path.at(-1)!;expect(route.success).toBe(true);expect(Math.hypot(end.x-to.x,end.y-to.y,end.z-to.z)).toBeLessThan(.4);}}finally{query.destroy();navMesh.destroy();}
});
it('server loads the frontier floor and the same eleven crate collision volumes',()=>{
 const sim=new FarmSimulation('frontier-server',loadCollision());for(const chest of FRONTIER_CHESTS)expect(sim.collision.groundAt(chest.x+1.2,chest.z,chest.y+.2)).toBeCloseTo(chest.y,1);expect(sim.collision.movingBoxes.filter(b=>b.id.startsWith('frontier-chest-'))).toHaveLength(11);
});

it('every frontier reward has a complete walkable approach from the original spawn',async()=>{
 await init();const {navMesh}=importNavMesh(new Uint8Array(readFileSync('public/models/farm-navmesh.bin'))),query=new NavMeshQuery(navMesh);
 try{for(const site of FRONTIER_CHESTS){const to={x:site.x+1.3,y:site.y,z:site.z},route=query.computePath({x:2,y:0,z:-16},to),end=route.path.at(-1);expect(route.success,site.id).toBe(true);expect(end,site.id).toBeDefined();expect(Math.hypot(end!.x-to.x,end!.y-to.y,end!.z-to.z),site.id).toBeLessThan(1.2);}}finally{query.destroy();navMesh.destroy();}
});
it('glasshouse district has solid authored floor across its avenue and both crop halls',()=>{
 const w=world();w.setRecoveryVolumes(data.solidPositions,data.solidIndices);
 for(const x of [254,285,316])for(const z of [245,270,298,315]){expect(w.groundAt(x,z,15.5)).toBeCloseTo(15,1);}
 expect(Math.max(...data.navPositions.filter((_v:number,i:number)=>i%3===2))).toBeGreaterThan(350);
 expect(data.walkableLinks).toHaveLength(4);
});

import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {waveRewardSite,WAVE_FIELDS} from '../src/run/WaveRewardSite';
import {RunInteractables} from '../src/run/RunInteractables';
import {RunProgression} from '../src/run/RunProgression';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {RunRNG} from '../src/core/RunRNG';
import type {GameEvents} from '../src/core/contracts';

it('delivers every field reward on real reachable collision terrain, including the distant highlands',async()=>{
 const {loadCollision}=await import('../server/rooms/FarmRoom');const {FarmSimulation}=await import('../server/FarmSimulation');
 const sim=new FarmSimulation('wave-reward-terrain',loadCollision());
 const {init,importNavMesh,NavMeshQuery}=await import('@recast-navigation/core');await init();
 const {navMesh}=importNavMesh(new Uint8Array(readFileSync('public/models/farm-navmesh.bin'))),query=new NavMeshQuery(navMesh,{maxNodes:8192});
 const engine=new NullEngine(),scene=new Scene(engine),events=new EventBus<GameEvents>(),run=new RunProgression(events),player=new PlayerMotor(sim.collision,events,{x:0,y:0,z:0}),chests=new RunInteractables(scene,player,run,events,new RunRNG('actual-fields').stream('interactable'),sim.collision);
 try{for(const field of WAVE_FIELDS){
  Object.assign(player.position,field);const site=waveRewardSite(sim.collision,player.position);expect(site,field.id).toBeDefined();expect(site!.name).toBe(field.name);
  expect(Math.hypot(site!.position.x-field.x,site!.position.z-field.z)).toBeLessThanOrEqual(16.01);
  expect(chests.deliverWaveReward(new RunRNG(field.id).stream('loot')),field.id).toBe(true);
  chests.update(1,false);const drop=chests.drops.active.at(-1)!;
  expect(drop.landed).toBe(true);expect(sim.collision.insideSolid({x:drop.landing.x,y:drop.landing.y-.43,z:drop.landing.z},1.8)).toBe(false);
  const to={x:drop.landing.x,y:drop.landing.y-.43,z:drop.landing.z};expect(sim.collision.groundAt(to.x,to.z,to.y+.2)).toBeCloseTo(to.y,2);
  const path=query.computePath({x:2,y:0,z:-16},to,{maxPathPolys:2048,maxStraightPathPoints:2048}),end=path.path.at(-1);
  expect(path.success,field.id).toBe(true);expect(end,field.id).toBeDefined();expect(Math.hypot(end!.x-to.x,end!.y-to.y,end!.z-to.z),field.id).toBeLessThan(1.2);
 }
 expect(run.inventory.size).toBe(0);expect(chests.drops.active).toHaveLength(WAVE_FIELDS.length);
 }finally{chests.dispose();scene.dispose();engine.dispose();query.destroy();navMesh.destroy();}
},30000);

it('defers an unloaded field without consuming loot RNG, then drops and grants exactly once on pickup',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),world=new CollisionWorld(),events=new EventBus<GameEvents>(),run=new RunProgression(events),player=new PlayerMotor(world,events,{x:610,y:25,z:520});
 world.surfaces.push({id:'old-origin',x:0,z:0,height:0,width:50,depth:50});
 const chests=new RunInteractables(scene,player,run,events,new RunRNG('retry').stream('interactable'),world),rng=new RunRNG('reward').stream('loot'),expected=run.randomItem(new RunRNG('reward').stream('loot'));
 try{
  expect(chests.deliverWaveReward(rng)).toBe(false);expect(chests.drops.active).toHaveLength(0);
  world.surfaces.push({id:'valley-loaded',x:610,z:520,height:25,width:100,depth:100});chests.update(1,false);
  expect(chests.deliverWaveReward(rng)).toBe(true);const drop=chests.drops.active[0]!;expect(drop.item.id).toBe(expected.id);expect(chests.waveRewardGuide?.drop).toBe(drop);expect(run.inventory.size).toBe(0);
  Object.assign(player.position,{x:drop.landing.x,y:25,z:drop.landing.z});expect(chests.buy()).toBe(false);
  chests.update(1,false);expect(chests.buy()).toBe(true);expect(run.inventory.get(expected.id)).toBe(1);expect(chests.buy()).toBe(false);expect(chests.drops.active).toHaveLength(0);expect(chests.waveRewardGuide).toBeUndefined();
  chests.reset();expect(chests.drops.active).toHaveLength(0);
 }finally{chests.dispose();scene.dispose();engine.dispose();}
});

it('moves the delivery patch away from a central wall and refuses a field with no safe floor',()=>{
 const w=new CollisionWorld();w.surfaces.push({id:'field',x:0,z:0,width:50,depth:50,height:0});
 w.boxes.push({id:'solid-center',min:{x:-3,y:0,z:-3},max:{x:3,y:5,z:3}});
 const site=waveRewardSite(w,{x:0,y:0,z:0});expect(site).toBeDefined();expect(Math.hypot(site!.position.x,site!.position.z)).toBeGreaterThan(3);
 w.boxes.push({id:'sealed-field',min:{x:-30,y:0,z:-30},max:{x:30,y:8,z:30}});expect(waveRewardSite(w,{x:0,y:0,z:0})).toBeUndefined();
});

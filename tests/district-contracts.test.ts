import {it,expect} from 'vitest';
import {DistrictContracts,DISTRICT_CONTRACTS} from '../src/run/DistrictContracts';
import {CITY_CHESTS,FRONTIER_CHESTS,HIGHLAND_CHESTS,ROOTWOOD_CHESTS} from '../src/world/ExplorationSites';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {RunInteractables} from '../src/run/RunInteractables';
import {RunProgression} from '../src/run/RunProgression';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {RandomStream} from '../src/core/RunRNG';
import type {GameEvents} from '../src/core/contracts';
it('requires distinct real chests and rewards each district only once until next stage',()=>{
 const contracts=new DistrictContracts();expect(contracts.recordOpened('seeds-made-up')).toBeUndefined();
 for(const district of DISTRICT_CONTRACTS){const sites=[...CITY_CHESTS,...FRONTIER_CHESTS,...HIGHLAND_CHESTS,...ROOTWOOD_CHESTS].filter(s=>s.id.startsWith(district.prefix));expect(sites.length).toBeGreaterThanOrEqual(2);expect(contracts.recordOpened(sites[0]!.id)).toBeUndefined();expect(contracts.recordOpened(sites[0]!.id)).toBeUndefined();expect(contracts.recordOpened(sites[1]!.id)?.id).toBe(district.id);for(const site of sites)expect(contracts.recordOpened(site.id)).toBeUndefined();}
 expect(contracts.completedCount).toBe(12);expect(contracts.nearest({x:285,y:15,z:280})).toBeUndefined();contracts.reset();expect(contracts.completedCount).toBe(0);expect(contracts.nearest({x:285,y:15,z:280})?.contract.id).toBe('glasshouse');
});
it('failed payment does not advance a contract; successful completion drops a physical bonus without granting inventory',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),events=new EventBus<GameEvents>(),world=new CollisionWorld();world.surfaces.push({id:'district',x:100,z:8,width:70,depth:60,height:2});const player=new PlayerMotor(world,events,{x:97,y:2,z:-9}),run=new RunProgression(events),chests=new RunInteractables(scene,player,run,events,new RandomStream(714),world);
 try{
  chests.update(0,false);expect(chests.nearest?.id).toBe('seeds-courtyard');expect(chests.buy()).toBe(false);expect(chests.contracts.completedCount).toBe(0);expect(chests.districtContract?.opened).toBe(0);
  // Os preços são PROGRESSIVOS (cada compra encarece as seguintes), então o teste soma o que foi
  // realmente cobrado em vez de fixar um total — o contrato aqui é de contrato de distrito, não de tabela.
  run.credits=200;const first=chests.nearest!.cost;expect(chests.buy()).toBe(true);chests.update(.4,false);expect(chests.drops.active).toHaveLength(1);
  Object.assign(player.position,{x:82,y:2,z:13});chests.update(0,false);expect(chests.nearest?.id).toBe('seeds-west-market');const second=chests.nearest!.cost;expect(second).toBeGreaterThan(0);expect(chests.buy()).toBe(true);expect(run.credits).toBe(200-first-second);expect(chests.contracts.completedCount).toBe(1);expect(run.inventory.size).toBe(0);expect(chests.drops.active).toHaveLength(2);expect(chests.buy()).toBe(false);
  chests.update(1,false);expect(chests.drops.active).toHaveLength(3);const bonus=chests.drops.active[1]!;expect(bonus.landed).toBe(true);Object.assign(player.position,{x:bonus.landing.x,y:2,z:bonus.landing.z});expect(chests.buy()).toBe(true);expect([...run.inventory.values()].reduce((a,b)=>a+b,0)).toBe(1);expect(run.credits).toBe(200-first-second);
  chests.reset();expect(chests.contracts.completedCount).toBe(0);expect(chests.drops.active).toHaveLength(0);
 }finally{chests.dispose();scene.dispose();engine.dispose();}
});

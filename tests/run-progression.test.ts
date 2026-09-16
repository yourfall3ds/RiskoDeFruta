import { describe,it,expect } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { RunRNG } from '../src/core/RunRNG';
import { ITEMS,RunProgression } from '../src/run/RunProgression';
import { MonsterDirector } from '../src/run/MonsterDirector';
import { FarmNavigation } from '../src/ai/FarmNavigation';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { readFileSync } from 'node:fs';
describe('run progression',()=>{
  it('opens expeditions gently, replenishes one at a time, and respects the early live cap',()=>{
    for(const seed of ['gentle-a','gentle-b','gentle-c']){
      const director=new MonsterDirector(new RunRNG(seed).stream('director'),1,50,'expedition');
      let alive=0,first=Infinity;const types:string[]=[];
      for(let tick=0;tick<30*60;tick++){
        let arrivals=0;
        director.update(1/60,0,alive,kind=>{alive++;arrivals++;first=Math.min(first,tick/60);types.push(kind);return true;});
        expect(arrivals).toBeLessThanOrEqual(1);
        expect(alive).toBeLessThanOrEqual(3);
      }
      expect(first).toBeGreaterThanOrEqual(5.9);expect(first).toBeLessThan(6.1);
      expect(alive).toBe(3);expect(types).not.toContain('watermelon');expect(types).not.toContain('tomato');
      director.pressure=1;
      for(let tick=0;tick<30*60;tick++)director.update(1/60,0,alive,()=>{alive++;return true;},7);
      expect(alive).toBeGreaterThan(3);expect(alive).toBeLessThanOrEqual(7);
    }
  });
  it('preserves existing item balance and diminishing critical returns',()=>{const run=new RunProgression(new EventBus());
    // 90 PNGs continuam cobertos; os dois itens de 15/09 (corrida e carga de especial) reaproveitam ícones existentes.
    expect(ITEMS).toHaveLength(92);expect(new Set(ITEMS.map(i=>i.icon)).size).toBe(90);
    for(const item of ITEMS){expect(item.icon).toBeGreaterThanOrEqual(0);expect(item.icon).toBeLessThan(90);}
    expect(new Set(ITEMS.map(i=>i.id)).size).toBe(ITEMS.length);run.addItem('belt');expect(run.stats.armor).toBe(20);run.addItem('pruner');run.addItem('pruner');expect(run.stats.damage).toBeCloseTo(1.3);for(let i=0;i<100;i++)run.addItem('goggles');expect(run.stats.crit).toBeLessThan(1);expect(run.stats.crit).toBeGreaterThan(.8);});
  it('charges once, awards levels and converts stage credits to XP while retaining inventory',()=>{const run=new RunProgression(new EventBus());expect(run.purchase(30,'pruner')).toBe(false);for(let i=0;i<7;i++)run.reward();expect(run.level).toBeGreaterThan(1);expect(run.purchase(30,'pruner')).toBe(true);const old=run.credits;expect(old).toBe(40);run.advanceStage();expect(run.stage).toBe(2);expect(run.credits).toBe(0);expect(run.inventory.get('pruner')).toBe(1);});
  it('reaches the boss without kills and stops permanently after death',()=>{const director=new MonsterDirector(new RunRNG('run').stream('director'));const spawned:string[]=[];for(let i=0;i<2400;i++)director.update(.1,0,0,kind=>{spawned.push(kind);return true;});expect(spawned.filter(x=>x==='boss')).toHaveLength(1);expect(director.state).toBe(4);director.bossKilled();const before=spawned.length;for(let i=0;i<500;i++)director.update(.1,100,0,kind=>{spawned.push(kind);return true;});expect(spawned).toHaveLength(before);expect(director.state).toBe(5);});
  it('cannot spend credits or exceed the live population budget on failed spawns',()=>{const director=new MonsterDirector(new RunRNG('budget').stream('director'));director.update(1,0,50,()=>{throw new Error('cap exceeded');});const before=director.credits;director.update(.1,0,0,()=>false);expect(director.credits).toBeGreaterThanOrEqual(before);});
  it('routes enemies from the lower field through the ramp toward the barn',()=>{const world=new CollisionWorld();const map=JSON.parse(readFileSync('public/models/farm-collision.json','utf8'));world.boxes.push(...map.boxes);world.surfaces.push(...map.surfaces);const nav=new FarmNavigation(world);nav.update({x:0,y:5,z:32});const p={x:0,y:0,z:-12};expect(nav.reachable(p)).toBe(true);for(let i=0;i<1500;i++){const d=nav.direction(p,{x:0,y:5,z:32});world.move(p,d.x*.04,d.z*.04,.4,1.8,.8);p.y=world.groundAt(p.x,p.z,p.y+.8);}expect(p.z).toBeGreaterThan(29);expect(p.y).toBeCloseTo(5);});
});

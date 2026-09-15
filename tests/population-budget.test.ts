import {it,expect} from 'vitest';
import {PopulationBudget} from '../src/run/PopulationBudget';
import {MonsterDirector} from '../src/run/MonsterDirector';
import {RunRNG} from '../src/core/RunRNG';
it('backs off under sustained pressure, recovers slowly, and never exceeds its hard maximum',()=>{const b=new PopulationBudget();for(let i=0;i<900;i++)b.update(1/60,40);expect(b.limit).toBe(12);for(let i=0;i<12000;i++)b.update(1/60,16.6);expect(b.limit).toBe(32);});
it('does not spend credits or spawn ordinary enemies when the runtime budget is full',()=>{const d=new MonsterDirector(new RunRNG('cap').stream('director'));let spawned=0;d.credits=80;for(let i=0;i<1200;i++)d.update(1/60,0,12,()=>{spawned++;return true;},12);expect(spawned).toBe(0);expect(d.credits).toBeGreaterThanOrEqual(80);});

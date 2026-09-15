import { expect,it,vi } from 'vitest';
import { ItemProcs } from '../src/items/ItemProcs';
import { RunProgression } from '../src/run/RunProgression';
import { RunRNG } from '../src/core/RunRNG';
import { EventBus } from '../src/core/EventBus';
import type { DamageContext } from '../src/core/contracts';

const hit:DamageContext={attackerId:1,victimId:2,sourceId:'pistol',attackId:'right',baseDamage:12,finalDamage:12,crit:false,procCoefficient:1,procChainDepth:0,damageTags:['bullet'],hitPosition:{x:0,y:0,z:0},hitNormal:{x:0,y:1,z:0},forceDirection:{x:0,y:0,z:1},forceMagnitude:1};
function setup(){const run=new RunProgression(new EventBus());run.addItem('fire');run.addItem('bomb');const rng=new RunRNG('procs').stream('procs'),roll=vi.spyOn(rng,'next').mockReturnValue(.05),hooks={burn:vi.fn(),blast:vi.fn()};return {run,roll,hooks,procs:new ItemProcs(run,rng)};}
it('secondary explosions and zero-coefficient hits cannot trigger or consume proc rolls',()=>{const {procs,hooks,roll}=setup();procs.onHit({...hit,procChainDepth:1},hooks);procs.onHit({...hit,procCoefficient:0},hooks);expect(roll).not.toHaveBeenCalled();expect(hooks.blast).not.toHaveBeenCalled();expect(hooks.burn).not.toHaveBeenCalled();});
it('applies the attack coefficient to both item hooks and clamps it above one',()=>{const {procs,hooks,roll}=setup();procs.onHit({...hit,procCoefficient:.1},hooks);expect(hooks.blast).not.toHaveBeenCalled();expect(hooks.burn).not.toHaveBeenCalled();procs.onHit(hit,hooks);expect(hooks.blast).toHaveBeenCalledTimes(1);expect(hooks.burn).toHaveBeenCalledTimes(1);roll.mockReturnValue(.5);procs.onHit({...hit,procCoefficient:20},hooks);expect(hooks.blast).toHaveBeenCalledTimes(1);expect(hooks.burn).toHaveBeenCalledTimes(1);});
it('heals per harvest stack only when the kill hook is invoked',()=>{const {run,procs}=setup();expect(procs.onKill()).toBe(0);run.addItem('harvest');run.addItem('harvest');expect(procs.onKill()).toBe(8);});

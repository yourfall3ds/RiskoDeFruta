import {it,expect} from 'vitest';
import {BurningStatus} from '../src/combat/BurningStatus';
import {MeteorArrival} from '../src/player/MeteorArrival';
import {StaticRayIndex} from '../src/physics/StaticRayIndex';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Ray} from '@babylonjs/core/Culling/ray';
it('burn deals bounded ticks and refreshed flames never stack tick frequency',()=>{const b=new BurningStatus(),hits:number[]=[];b.ignite(2);for(let i=0;i<120;i++){if(i===20)b.ignite(2);b.update(1/60,(_,n)=>hits.push(n));}expect(hits.length).toBe(3);b.update(10,(_,n)=>hits.push(n));expect(hits.length).toBe(5);expect(b.remaining).toBe(0);b.update(5,()=>{throw Error('late burn');});b.ignite(3);b.clear();b.update(2,()=>{throw Error('burn after stage reset');});});
it('meteor loops no gameplay clock, impacts once and completes landing recovery',()=>{const m=new MeteorArrival();let impacts=0;m.start();expect(m.height).toBe(900);m.update(0,()=>impacts++);expect(m.height).toBe(900);m.update(4.1,()=>impacts++);expect(impacts).toBe(1);expect(m.height).toBe(0);expect(m.active).toBe(true);m.update(10,()=>impacts++);expect(m.active).toBe(false);expect(m.recovery).toBe(1);expect(impacts).toBe(1);});
it('worker BVH snapshot preserves ray and capsule collisions',()=>{const p=[-4,0,0,4,0,0,0,5,0],i=[0,1,2],original=new StaticRayIndex(p,i),copy=new StaticRayIndex(p,i,structuredClone(original.snapshot())),ray=new Ray(new Vector3(0,1,-4),Vector3.Forward(),10);expect(copy.cast(ray)).toEqual(original.cast(ray));const args=[new Vector3(0,.1,-4),new Vector3(0,0,8),.3,1.7] as const;expect(copy.sweepCapsule(...args)).toEqual(original.sweepCapsule(...args));});

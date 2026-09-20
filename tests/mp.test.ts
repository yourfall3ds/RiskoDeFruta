import { describe,it,expect,vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { EventBus } from '../src/core/EventBus';
import { RunRNG } from '../src/core/RunRNG';
import type { GameEvents } from '../src/core/contracts';
import { MPCharge,MP_HIT_GAIN } from '../src/combat/MPCharge';
import { DualPistols } from '../src/combat/DualPistols';
import type { CharacterVisual } from '../src/animation/CharacterVisual';
import type { ThirdPersonCamera } from '../src/camera/ThirdPersonCamera';
import type { TrainingYard } from '../src/world/TrainingYard';
import type { WeaponAudio } from '../src/audio/RecordedAudio';

describe('MP charge',()=>{
  it('reaches each threshold exactly at fixed ticks and resets immediately on release',()=>{
    const events=new EventBus<GameEvents>();const levels:number[]=[];events.on('MPCharged',({tier})=>levels.push(tier));
    const charge=new MPCharge(events);
    for(let i=0;i<36;i++)charge.update(1/60,true);expect(charge.tier).toBe(1);
    for(let i=36;i<84;i++)charge.update(1/60,true);expect(charge.tier).toBe(2);
    for(let i=84;i<156;i++)charge.update(1/60,true);expect(charge.tier).toBe(3);
    expect(levels).toEqual([1,2,3]);expect(charge.update(1/60,false)).toBe(3);expect(charge.seconds).toBe(0);
    expect(charge.current).toBe(0);charge.gain(25);for(let i=0;i<36;i++)charge.update(1/60,true);expect(charge.update(1/60,false)).toBe(1);
  });
  it('cancels short charges and explicit focus/pause cancellation without attacking',()=>{
    const charge=new MPCharge(new EventBus<GameEvents>());charge.update(.59,true);expect(charge.update(.01,false)).toBe(0);
    charge.update(3,true);charge.cancel();expect(charge.update(.01,false)).toBe(0);expect(charge.releases).toBe(0);
  });
});

function setup(blocked=false,separated=false) {
  const engine=new NullEngine();const scene=new Scene(engine);const events=new EventBus<GameEvents>();
  const camera=new FreeCamera('test-camera',new Vector3(0,1.7,-3),scene);
  const targets=[8,12].map((z,index)=>{
    const mesh=CreateSphere(`target-${index}`,{diameter:1.6,segments:8},scene);mesh.position.set(separated?(index===0?-2:2):0,1.7,z);mesh.computeWorldMatrix(true);
    const ring=CreateSphere(`ring-${index}`,{diameter:1},scene);ring.isPickable=false;
    return {id:10+index,mesh,ring,hits:0};
  });
  if(blocked){const wall=CreateBox('wall',{width:8,height:5,depth:.2},scene);wall.position.set(0,2,4);wall.computeWorldMatrix(true);}
  const visual={ready:true,position:Vector3.Zero(),hands:[],fire:vi.fn(),release:vi.fn(),stormAim:vi.fn()} as unknown as CharacterVisual;
  const view={camera,forward:Vector3.Forward(),impulse:vi.fn()} as unknown as ThirdPersonCamera;
  const audio={shot:vi.fn()} as unknown as WeaponAudio;
  const weapons=new DualPistols(scene,view,visual,{targets} as TrainingYard,new RunRNG('skills').stream('run'),events,audio);weapons.updatePose(0);
  return {weapons,targets,scene,engine,events,dispose:()=>{weapons.dispose();scene.dispose();engine.dispose();}};
}
describe('MP rays on real Babylon geometry',()=>{
  it('fan emits ten traveling shots and damages enemies in its swept area',()=>{
    const run=setup();try{run.weapons.releaseSkill(1);for(let i=0;i<120;i++){run.weapons.fixedUpdate(1/60,false);run.weapons.updatePose(1/60);}expect(run.targets.reduce((sum,t)=>sum+t.hits,0)).toBeGreaterThan(0);expect(run.weapons.skillShots).toBe(10);}finally{run.dispose();}
  });
  it('fan and storm cannot damage targets behind a solid wall',()=>{
    const run=setup(true);try{run.weapons.releaseSkill(1);run.weapons.releaseSkill(3);for(let i=0;i<181;i++){run.weapons.fixedUpdate(1/60,false);run.weapons.updatePose(1/60);}expect(run.targets.map(t=>t.hits)).toEqual([0,0]);expect(run.weapons.stormRemaining).toBe(0);expect(run.weapons.effects.pool.stats.misses).toBe(0);}finally{run.dispose();}
  });
  it('storm distributes hits and ends after three seconds',()=>{
    const run=setup(false,true);try{run.weapons.releaseSkill(3);for(let i=0;i<181;i++){run.weapons.fixedUpdate(1/60,false);run.weapons.updatePose(1/60);}for(const target of run.targets)expect(target.hits).toBeGreaterThan(0);expect(run.weapons.skillShots).toBeGreaterThanOrEqual(59);expect(run.weapons.skillShots).toBeLessThanOrEqual(61);expect(run.weapons.effects.pool.stats.misses).toBe(0);}finally{run.dispose();}
  });
});

it.each([1,2,3] as const)('skill %i follows the supplied voice action duration',tier=>{const r=setup(false,true);let clock=0;try{r.weapons.releaseSkill(tier,true,4.8,()=>clock);for(let i=0;i<144;i++){clock=i/60;r.weapons.fixedUpdate(1/60,false);r.weapons.updatePose(1/60);}const middle=r.weapons.skillShots;expect(middle).toBeGreaterThan(0);for(let i=144;i<=290;i++){clock=i/60;r.weapons.fixedUpdate(1/60,false);r.weapons.updatePose(1/60);}expect(r.weapons.skillShots).toBeGreaterThan(middle);const end=r.weapons.skillShots;for(let i=0;i<60;i++){clock+=1/60;r.weapons.fixedUpdate(1/60,false);}expect(r.weapons.skillShots).toBe(end);if(tier<3)expect(end).toBe(48);expect(r.weapons.magazine.ammo).toBe(50);}finally{r.dispose();}});

it.each([1,2,3] as const)('skill %i discards queued emissions after a frame stall beyond the voice end',tier=>{const r=setup(false,true);let clock=0;try{r.weapons.releaseSkill(tier,true,2.2,()=>clock);r.weapons.fixedUpdate(1/60,false);const before=r.weapons.skillShots;clock=3.5;for(let i=0;i<90;i++)r.weapons.fixedUpdate(1/60,false);expect(r.weapons.skillShots).toBe(before);expect(r.weapons.stormRemaining).toBe(0);}finally{r.dispose();}});


it('MP não regenera sozinho, só premia acerto confirmado e nunca passa da reserva',()=>{
 const events=new EventBus<GameEvents>(),mp=new MPCharge(events);mp.current=0;
 for(let i=0;i<600;i++)mp.update(1/60,false);expect(mp.current).toBe(0);
 const hit:GameEvents['EnemyHit']={attackerId:1,victimId:200,sourceId:'dual_pistols',attackId:'right',baseDamage:12,finalDamage:12,crit:false,procCoefficient:1,procChainDepth:0,damageTags:['bullet'],hitPosition:{x:0,y:1,z:0},hitNormal:{x:0,y:0,z:-1},forceDirection:{x:0,y:0,z:1},forceMagnitude:2};
 events.emit('DamageDealt',hit);expect(mp.current).toBe(0);           // intenção de dano não é confirmação
 events.emit('EnemyHit',hit);expect(mp.current).toBe(MP_HIT_GAIN);    // dano aplicado de verdade
 events.emit('EnemyHit',{...hit,attackerId:200,victimId:1});expect(mp.current).toBe(MP_HIT_GAIN);
 events.emit('EnemyHit',{...hit,finalDamage:0});expect(mp.current).toBe(MP_HIT_GAIN);
 events.emit('EnemyHit',{...hit,damageTags:['bullet','skill']});expect(mp.current).toBe(MP_HIT_GAIN);
 mp.gain(200);expect(mp.current).toBe(100);mp.gain(NaN);expect(mp.current).toBe(100);
});
it('an unaffordable skill stays locked and release deducts only the affordable tier',()=>{
 const mp=new MPCharge(new EventBus<GameEvents>());mp.current=0;mp.update(2.6,true);expect(mp.update(0,false)).toBe(0);
 // Sem regeneração passiva, segurar a carga por 2,6 s não adiciona nada: 30 − 25 = 5.
 mp.current=30;mp.update(2.6,true);expect(mp.tier).toBe(1);expect(mp.update(0,false)).toBe(1);expect(mp.current).toBeCloseTo(5);
});

it('barrage tolerance cannot reach an enemy immediately behind thin cover',()=>{const r=setup(true);try{for(const target of r.targets){target.mesh.position.z=5;target.mesh.computeWorldMatrix(true);}r.weapons.releaseSkill(2);for(let i=0;i<150;i++){r.weapons.fixedUpdate(1/60,false);r.weapons.updatePose(1/60);}expect(r.targets.map(t=>t.hits)).toEqual([0,0]);}finally{r.dispose();}});

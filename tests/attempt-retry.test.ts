import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {RunProgression} from '../src/run/RunProgression';
import {attemptSummary} from '../src/run/AttemptSummary';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents} from '../src/core/contracts';
import {RunRNG} from '../src/core/RunRNG';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {ThirdPersonCamera} from '../src/camera/ThirdPersonCamera';
import {CharacterVisual} from '../src/animation/CharacterVisual';
import {DualPistols} from '../src/combat/DualPistols';
import {WeaponAudio} from '../src/audio/RecordedAudio';

it('keeps an immutable death inventory and statistics while resetting the same run object for retry',()=>{
 const run=new RunProgression(new EventBus<GameEvents>()),inventory=run.inventory;run.addItem('feather');run.addItem('feather');run.addItem('fire');run.reward();run.time=125;run.stage=3;run.level=7;
 const summary=attemptSummary(run,8,7);run.reset();
 expect(summary).toMatchObject({time:125,stage:3,level:7,kills:1,wave:8,completedWaves:7});expect(summary.items.find(i=>i.id==='feather')?.count).toBe(2);
 expect(run.inventory).toBe(inventory);expect(run.inventory.size).toBe(0);expect(run.stats.extraJumps).toBe(0);expect(run.stats.maxHP).toBe(130);expect(run.time).toBe(0);expect(run.stage).toBe(1);expect(run.level).toBe(1);expect(run.totalKills).toBe(0);expect(run.credits).toBe(0);
 run.addItem('feather');expect(summary.items.find(i=>i.id==='feather')?.count).toBe(2);
});
it('reuses weapon presentation pools while clearing bullets, reload, skills and counters over repeated retries',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),world=new CollisionWorld(),events=new EventBus<GameEvents>(),camera=new ThirdPersonCamera(scene,world),visual=new CharacterVisual(scene,()=>{}),audio=new WeaponAudio(),weapons=new DualPistols(scene,camera,visual,{targets:[],collision:world},new RunRNG('retry').stream('run'),events,audio);
 try{const meshes=scene.meshes.length,pool=weapons.effects.pool;
  for(let cycle=0;cycle<5;cycle++){
   weapons.magazine.consume();weapons.magazine.request();weapons.cadence.update(1/60,true,()=>{});weapons.hits=12;weapons.skillShots=20;weapons.stormRemaining=3;
   weapons.effects.impact(Vector3.Zero(),Vector3.Up());expect(pool.stats.active).toBeGreaterThan(0);
   weapons.resetAttempt();expect(weapons.magazine.ammo).toBe(50);expect(weapons.magazine.reloading).toBe(false);expect(weapons.stormRemaining).toBe(0);expect(weapons.hits).toBe(0);expect(weapons.skillShots).toBe(0);expect(weapons.cadence.shots).toBe(0);expect(pool.stats.active).toBe(0);expect(weapons.effects.pool).toBe(pool);expect(scene.meshes.length).toBe(meshes);
   const sides:number[]=[];weapons.cadence.update(1/60,true,s=>sides.push(s));expect(sides).toEqual([0]);
  }
 }finally{weapons.dispose();visual.dispose();audio.dispose();scene.dispose();engine.dispose();}
});

import { describe,it,expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { EMPTY_INPUT } from '../src/input/GameInput';
import { EventBus } from '../src/core/EventBus';
import type { DamageContext,GameEvents } from '../src/core/contracts';
import { RunRNG } from '../src/core/RunRNG';
import { RunProgression } from '../src/run/RunProgression';
import { TacticalNavigation } from '../src/ai/TacticalNavigation';
import { EnemySwarm } from '../src/game/EnemySwarm';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { PlayerMotor } from '../src/player/PlayerMotor';
import type { TrainingTarget } from '../src/world/TrainingYard';
async function setup(){const engine=new NullEngine(),scene=new Scene(engine),events=new EventBus<GameEvents>(),collision=new CollisionWorld();collision.surfaces.push({id:'field',x:0,z:0,width:100,depth:100,height:0});const player=new PlayerMotor(collision,events,{x:0,y:0,z:0}),run=new RunProgression(events),world={targets:[] as TrainingTarget[],collision};const light=new DirectionalLight('sun',new Vector3(0,-1,0),scene),shadows=new ShadowGenerator(128,light);const swarm=new EnemySwarm(scene,world,events,shadows,player,run,new RunRNG('combat-test'));await swarm.load(async model=>{const c=new AssetContainer(scene),mesh=CreateBox(model,{size:1},scene);c.meshes.push(mesh);c.populateRootNodes();c.removeAllFromScene();return c;});swarm.initialize();swarm.populationCap=50;swarm.benchmark=true;swarm.director.stopped=true;return{engine,scene,events,player,run,swarm,collision,close:()=>{swarm.dispose();scene.dispose();engine.dispose();}};}
function damage(id:number,amount:number):DamageContext{return{attackerId:1,victimId:id,sourceId:'dual_pistols',attackId:'right',baseDamage:amount,finalDamage:amount,crit:false,procCoefficient:1,procChainDepth:0,damageTags:['bullet'],hitPosition:{x:0,y:1,z:0},hitNormal:{x:0,y:0,z:1},forceDirection:{x:0,y:0,z:1},forceMagnitude:2};}
describe('live enemy combat',()=>{
  it('admits the boss even when the ordinary population is full without awarding a fake kill',async()=>{const t=await setup();try{for(let i=0;i<50;i++)t.swarm.spawn('eggplant',{x:i%10*3-15,y:0,z:15+Math.floor(i/10)*3});expect(t.swarm.spawn('boss',{x:0,y:0,z:35})).toBe(true);expect(t.swarm.count).toBe(50);expect(t.swarm.boss?.health.dead).toBe(false);expect(t.run.totalKills).toBe(0);expect(t.swarm.scheduler.size).toBe(50);}finally{t.close();}});
  it('copies Babylon vector coordinates into warnings and resolves delayed roots',async()=>{const t=await setup();try{const warning=t.swarm.effects.warning(new Vector3(0,0,0),2,.1,12,7,'root')!;expect(warning.position).toEqual({x:0,y:0,z:0});for(let i=0;i<5;i++)t.swarm.fixedUpdate(1/60);expect(t.player.hp).toBe(130);for(let i=0;i<4;i++)t.swarm.fixedUpdate(1/60);expect(t.player.hp).toBe(118);}finally{t.close();}});
  it('keeps acid damaging for a finite duration and clears it at stage transition',async()=>{const t=await setup();try{t.swarm.effects.warning({x:0,y:0,z:0},2,.1,20,7,'acid');for(let i=0;i<190;i++){t.player.invulnerable=0;t.swarm.fixedUpdate(1/60);}expect(t.player.hp).toBeLessThan(105);expect(t.swarm.effects.warnings.some(w=>w.active&&w.kind==='acid-pool')).toBe(true);t.swarm.nextStage();expect(t.swarm.effects.active).toBe(0);expect(t.swarm.scheduler.size).toBe(0);}finally{t.close();}});
  it('telegraphs ranged shots before firing and keeps projectile counts bounded',async()=>{const t=await setup();try{expect(t.swarm.spawn('corn',{x:0,y:0,z:10})).toBe(true);for(let i=0;i<180;i++)t.swarm.fixedUpdate(1/60);expect(t.swarm.effects.warnings.some(w=>w.active)).toBe(true);expect(t.swarm.effects.projectiles.every(p=>!p.active)).toBe(true);for(let i=0;i<70;i++)t.swarm.fixedUpdate(1/60);expect(t.swarm.effects.projectiles.some(p=>p.active)).toBe(true);expect(t.swarm.effects.projectiles).toHaveLength(128);}finally{t.close();}});
  it('awards one kill and recycles a dead body without duplicating its target',async()=>{const t=await setup();try{t.swarm.spawn('eggplant',{x:0,y:0,z:10});const a=t.swarm.actors[0]!;a.target.onHit!(damage(a.id,1000));a.target.onHit!(damage(a.id,1000));expect(t.run.totalKills).toBe(1);expect(a.body.isPickable).toBe(false);for(let i=0;i<450;i++)t.swarm.fixedUpdate(1/60);expect(a.active).toBe(false);t.swarm.spawn('eggplant',{x:4,y:0,z:10});expect(t.swarm.actors).toHaveLength(1);expect(a.body.isPickable).toBe(true);expect(a.health.dead).toBe(false);}finally{t.close();}});
  it('stops the director and opens the rift delay after the boss dies',async()=>{const t=await setup();try{t.swarm.spawn('boss',{x:0,y:0,z:18});const a=t.swarm.boss!;a.target.onHit!(damage(a.id,99999));expect(t.swarm.director.state).toBe(5);for(let i=0;i<301;i++)t.swarm.fixedUpdate(1/60);expect(t.swarm.bossDeadTime).toBeGreaterThanOrEqual(5);t.run.advanceStage();t.swarm.nextStage();expect(t.swarm.director.stage).toBe(2);expect(t.swarm.count).toBe(0);expect(t.swarm.boss).toBeUndefined();}finally{t.close();}});
  it('keeps the population at fifty with real Babylon actor instances',async()=>{const t=await setup();try{for(let i=0;i<55;i++)t.swarm.spawn('eggplant',{x:i%10*3-15,y:0,z:Math.floor(i/10)*3+15});expect(t.swarm.count).toBe(50);for(let i=0;i<120;i++)t.swarm.fixedUpdate(1/60);expect(t.swarm.scheduler.size).toBe(50);expect(t.swarm.actors.every(a=>Number.isFinite(a.root.position.x))).toBe(true);}finally{t.close();}});
});



describe('species attack contracts',()=>{
 it('eggplant winds up, rushes into the player and hits once with knockback',async()=>{const t=await setup();try{
  t.swarm.spawn('eggplant',{x:0,y:0,z:8},'normal');const a=t.swarm.actors[0]!;a.state='windup';a.time=0;a.locked={...t.player.position};a.direction={x:0,z:0};
  for(let i=0;i<50;i++)t.swarm.fixedUpdate(1/60);expect(t.player.hp).toBe(130);expect(a.root.position.z).toBe(8);
  for(let i=0;i<65;i++)t.swarm.fixedUpdate(1/60);expect(t.player.hp).toBe(106);t.player.fixedUpdate(1/60,EMPTY_INPUT,0);expect(t.player.position.z).toBeLessThan(-.1);expect(a.root.position.z).toBeLessThan(2);
  t.player.invulnerable=0;for(let i=0;i<5;i++)t.swarm.fixedUpdate(1/60);expect(t.player.hp).toBe(106);
 }finally{t.close();}});
 it('eggplant keeps its committed direction so a sidestep avoids the rush',async()=>{const t=await setup();try{
  t.swarm.spawn('eggplant',{x:0,y:0,z:8},'normal');const a=t.swarm.actors[0]!;a.state='windup';a.locked={x:0,y:0,z:0};t.player.position.x=4;
  for(let i=0;i<112;i++)t.swarm.fixedUpdate(1/60);expect(t.player.hp).toBe(130);expect(Math.abs(a.root.position.x)).toBeLessThan(.01);expect(a.root.position.z).toBeLessThan(2);
 }finally{t.close();}});
 it.each(['clear','wall','sidestep'] as const)('carrot laser handles %s without a floating projectile',async mode=>{const t=await setup();try{
  t.swarm.spawn('carrot',{x:0,y:0,z:8},'normal');const a=t.swarm.actors[0]!;a.state='windup';a.locked={...t.player.position};a.time=0;
  if(mode==='wall')t.collision.boxes.push({id:'laser-cover',min:{x:-2,y:0,z:3},max:{x:2,y:4,z:3.1}});
  if(mode==='sidestep')t.player.position.x=2;
  for(let i=0;i<65;i++)t.swarm.fixedUpdate(1/60);expect(t.player.hp).toBe(130);
  for(let i=0;i<7;i++)t.swarm.fixedUpdate(1/60);expect(t.player.hp).toBe(mode==='clear'?106:130);expect(t.swarm.effects.projectiles.some(p=>p.active)).toBe(false);
 }finally{t.close();}});
});

it.each([false,true])('the Detour rush respects wall=%s while committing to player contact',async wall=>{const t=await setup();try{
 if(wall)t.collision.boxes.push({id:'rush-wall',min:{x:-20,y:0,z:3},max:{x:20,y:4,z:3.2}});
 t.swarm.tactical=await TacticalNavigation.create(t.collision);t.swarm.spawn('eggplant',{x:0,y:0,z:6},'normal');const a=t.swarm.actors[0]!;a.state='windup';a.locked={...t.player.position};a.time=0;
 for(let i=0;i<116;i++)t.swarm.fixedUpdate(1/60);if(wall){expect(t.player.hp).toBe(130);expect(a.root.position.z).toBeGreaterThan(3.2);}else{expect(t.player.hp).toBeLessThan(130);expect(a.root.position.z).toBeLessThan(2);}
}finally{t.close();}});

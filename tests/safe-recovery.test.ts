import {describe,it,expect} from 'vitest';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {findSafeRecovery,safeRecoverySupport} from '../src/player/SafeRecovery';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/InputFrame';

function island(){
 const world=new CollisionWorld();
 world.surfaces.push({id:'island',x:0,z:0,width:30,depth:30,height:5,ellipse:true});
 world.boxes.push({id:'island-core',min:{x:-8,y:-20,z:-8},max:{x:8,y:4.98,z:8}});
 return world;
}
describe('safe island recovery',()=>{
 it('uses the new biome after travel when a checkpoint has lost its floor',()=>{
  const world=island();world.surfaces.push({id:'next-biome',x:300,z:200,width:30,depth:30,height:18,ellipse:true});
  const player=new PlayerMotor(world,new EventBus(),{x:0,y:5,z:0});player.arriveAt({x:300,y:18,z:200});
  Object.assign(player.safe,{x:2000,y:-10,z:2000});Object.assign(player.position,{x:2000,y:-80,z:2000});player.grounded=false;
  player.fixedUpdate(1/60,EMPTY_INPUT,0);
  expect(player.position).toEqual({x:300,y:18,z:200});expect(player.respawns).toBe(1);
 });
 it('lifts a poisoned checkpoint out of rubble to the island top and clears residual movement',()=>{
  const world=island(),player=new PlayerMotor(world,new EventBus(),{x:0,y:5,z:0});
  Object.assign(player.safe,{x:2,y:-5,z:2});Object.assign(player.position,{x:40,y:-30,z:0});
  player.grounded=false;player.velocity.y=-50;player.knockback({x:1,y:0,z:0},14);player.barrageRetreat();
  player.fixedUpdate(1/60,EMPTY_INPUT,0);
  expect(player.respawns).toBe(1);expect(player.position.y).toBe(5);
  expect(world.insideSolid(player.position)).toBe(false);expect(safeRecoverySupport(world,player.position)).toBe(true);
  const returned={...player.position};
  for(let i=0;i<60;i++)player.fixedUpdate(1/60,EMPTY_INPUT,0);
  expect(player.position).toEqual(returned);expect(player.solidRecoveries).toBe(0);
 });
 it('recovers an already buried character without looping into the same rock',()=>{
  const world=island(),player=new PlayerMotor(world,new EventBus(),{x:0,y:-5,z:0});
  for(let i=0;i<10;i++)player.fixedUpdate(1/60,EMPTY_INPUT,0);
  expect(player.position.y).toBe(5);expect(player.solidRecoveries).toBe(1);
 });
 it('rejects rims, narrow debris and points without capsule clearance',()=>{
  const world=island();
  world.boxes.push({id:'debris',min:{x:-.15,y:5,z:-.15},max:{x:.15,y:7,z:.15}});
  expect(safeRecoverySupport(world,{x:0,y:7,z:0})).toBe(false);
  expect(safeRecoverySupport(world,{x:0,y:5,z:0})).toBe(false);
  expect(safeRecoverySupport(world,{x:14.8,y:5,z:0})).toBe(false);
  const p=findSafeRecovery(world,{x:0,y:5,z:0},{x:0,y:5,z:0})!;
  expect(p.y).toBe(5);expect(Math.hypot(p.x,p.z)).toBeGreaterThan(1);
  expect(safeRecoverySupport(world,p)).toBe(true);
 });
 it('does not save a low ledge under an island as a new checkpoint',()=>{
  const world=island();world.surfaces.push({id:'debris-ledge',x:12,z:0,width:2,depth:2,height:-8});
  const player=new PlayerMotor(world,new EventBus(),{x:0,y:5,z:0});
  Object.assign(player.position,{x:12,y:-8,z:0});
  for(let i=0;i<60;i++)player.fixedUpdate(1/60,EMPTY_INPUT,0);
  expect(player.safe).toEqual({x:0,y:5,z:0});
 });
});

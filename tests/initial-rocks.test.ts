import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {applyInitialRockFix,type InitialRockFix} from '../src/world/terrain/InitialRocks';
import {type OutcropShape} from '../src/world/terrain/RockOutcrops';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {mergeCollision} from '../server/FarmSimulation';
import {sculptRegion} from '../src/world/terrain/WorldTerrain';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/InputFrame';
const read=(name:string)=>JSON.parse(readFileSync('public/models/'+name,'utf8'));
const plan:InitialRockFix=read('initial-rock-fix.json');
const shape:OutcropShape=read('outcrop-rocks.json');
const bake=JSON.parse(readFileSync('docs/collision-bake.json','utf8'));

describe('initial bridge rocks',()=>{
 it('walks across the east bridge onto the outpost without falling or recovering inside a rock',()=>{
  const mesh=read('world-collision-mesh.json'),solid=read('solid-island-collision.json'),authored=read('farm-collision.json');
  const merged=mergeCollision(mesh,solid,undefined,[],authored.boxes,shape,plan);
  const world=new CollisionWorld();world.boxes.push(...authored.boxes,...merged.mesh.boxes);
  world.surfaces.push(...authored.surfaces);world.setGeometry(merged.mesh.positions,merged.mesh.indices);
  world.setRecoveryVolumes(solid.positions,solid.indices);
  const player=new PlayerMotor(world,new EventBus(),{x:18,y:1,z:8});
  for(let frame=0;frame<360;frame++){
   player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},Math.PI/2);
   expect(player.position.y).toBeGreaterThan(-1);
  }
  expect(player.position.x).toBeGreaterThan(39);
  expect(player.position.y).toBeGreaterThan(1.9);
  expect(player.solidRecoveries).toBe(0);
 });
 it('removes only exact authored rock ranges, preserving every other collision triangle and all boxes',()=>{
  const original=read('world-collision-mesh.json'),data=structuredClone(original);
  const result=applyInitialRockFix(data,plan,shape);
  expect(result.removedInstances).toBe(125);
  expect(result.hidden).toHaveLength(204);
  const retired=new Set(result.hidden);
  let sourceOffset=0,keptOffset=0,removed=0;
  for(const [name,count] of Object.entries(bake.sources) as [string,number][]){
   if(retired.has(name)){expect(name).toMatch(/coast_land/);removed+=count;}
   else{
    expect(data.indices.slice(keptOffset,keptOffset+count*3)).toEqual(original.indices.slice(sourceOffset,sourceOffset+count*3));
    keptOffset+=count*3;
   }
   sourceOffset+=count*3;
  }
  expect(removed).toBe(result.removedTriangles);
  expect(data.boxes).toEqual(original.boxes);
  expect(result.geometry).toBeUndefined();
  expect(data.positions).toEqual(original.positions);
  expect(data.indices).toHaveLength(keptOffset);
 });

 it('rejects stale or overlapping plans before altering collision',()=>{
  const data=read('world-collision-mesh.json');
  data.indices[0]++;
  const before=structuredClone(data);
  expect(()=>applyInitialRockFix(data,plan,shape)).toThrow(/stale/);
  expect(data).toEqual(before);
  expect(()=>applyInitialRockFix(read('world-collision-mesh.json'),{...plan,offenders:[plan.offenders[0]!,plan.offenders[0]!]},shape)).toThrow(/Invalid/);
 });

 it('uses identical base geometry for client and server',()=>{
  const mesh=read('world-collision-mesh.json'),solid=read('solid-island-collision.json'),authored=read('farm-collision.json');
  const server=mergeCollision(mesh,solid,undefined,[],authored.boxes,shape,plan);
  const client=structuredClone(mesh);
  applyInitialRockFix(client,plan,shape);
  const offset=client.positions.length/3;
  for(const value of solid.positions)client.positions.push(value);
  for(const index of solid.indices)client.indices.push(index+offset);
  sculptRegion('base',{positions:client.positions,indices:client.indices,boxes:[...authored.boxes,...mesh.boxes,...solid.boxes]});
  expect(client.positions).toEqual(server.mesh.positions);
  expect(client.indices).toEqual(server.mesh.indices);
 });

 it('retains the closed island tops while retiring the entire open coastal dressing',()=>{
  const data=read('world-collision-mesh.json');
  const result=applyInitialRockFix(data,plan,shape);
  const world=new CollisionWorld();
  const solid=read('solid-island-collision.json');world.setGeometry(solid.positions,solid.indices);
  world.setRecoveryVolumes(solid.positions,solid.indices);
  expect(result.placements).toEqual([]);
  expect(result.hidden).toContain('coast_land_rocks_02.040'); // barn side in the reported screenshot
  expect(result.hidden).not.toContain('Wormhole stone arch');
  for(const [x,z,y] of [[0,0,0],[0,34,5],[-45,0,0],[44,8,2]]){
   expect(world.groundAt(x!,z!,Infinity)).toBeCloseTo(y!-.035,2);
   expect(world.insideSolid({x:x!,y:y!-3,z:z!})).toBe(true);
  }
 });
});

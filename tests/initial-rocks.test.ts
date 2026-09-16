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
  expect(result.removedInstances).toBe(39);
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
  expect(data.positions.slice(original.positions.length)).toEqual(result.geometry!.positions);
  expect(data.indices.slice(keptOffset).map((index:number)=>index-original.positions.length/3)).toEqual(result.geometry!.indices);
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

 it('keeps the replacement rock surface below the walking corridor of every initial bridge',()=>{
  const data=read('world-collision-mesh.json');
  const result=applyInitialRockFix(data,plan,shape);
  const world=new CollisionWorld();
  world.setGeometry(result.geometry!.positions,result.geometry!.indices);
  const bridges=read('farm-collision.json').surfaces.filter((s:{id:string})=>s.id.startsWith('bridge-'));
  let samples=0;
  for(const bridge of bridges){
   for(let x=bridge.x-bridge.width/2;x<=bridge.x+bridge.width/2;x+=.5){
    for(let z=bridge.z-bridge.depth/2+.3;z<=bridge.z+bridge.depth/2-.3;z+=.3){
     const deck=bridge.height+(x-bridge.x)*(bridge.slopeX??0)+(z-bridge.z)*(bridge.slopeZ??0);
     expect(world.groundAt(x,z,deck+4,60),`bridge ${bridge.id} at ${x},${z}`).toBeLessThan(deck-.05);
     samples++;
    }
   }
  }
  expect(samples).toBeGreaterThan(100);
 });
});

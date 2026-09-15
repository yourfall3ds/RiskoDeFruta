import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {init,importNavMesh,NavMeshQuery} from '@recast-navigation/core';
import {TacticalNavigation} from '../src/ai/TacticalNavigation';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {TriangleGround} from '../src/physics/TriangleGround';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/GameInput';

describe('navigation and solid traversal',()=>{
  it('finds complete baked routes to the barn and both outposts',async()=>{await init();const {navMesh}=importNavMesh(readFileSync('public/models/farm-navmesh.bin')),query=new NavMeshQuery(navMesh);try{for(const goal of [{x:0,y:5,z:30},{x:-44,y:0,z:0},{x:43,y:2,z:8}]){const path=query.computePath({x:0,y:0,z:-10},goal);expect(path.success).toBe(true);expect(path.path.length).toBeGreaterThan(1);const end=path.path.at(-1)!;expect(Math.hypot(end.x-goal.x,end.z-goal.z)).toBeLessThan(1.5);}}finally{query.destroy();navMesh.destroy();}});
  it('steers agents around a wall and keeps the crowd separated',async()=>{const world=new CollisionWorld();world.surfaces.push({id:'floor',x:0,z:0,width:50,depth:50,height:0});world.boxes.push({id:'wall',min:{x:-4,y:0,z:-1},max:{x:4,y:3,z:1}});const nav=await TacticalNavigation.create(world);try{for(let i=0;i<8;i++)expect(nav.add(i,{x:i*1.4-5,y:0,z:-10},.55,3)).toBe(true);const player={x:0,y:0,z:10};for(let t=0;t<900;t++){for(let i=0;i<8;i++)nav.target(i,player,i,false,3);nav.step(1/60,player);for(let i=0;i<8;i++){const p=nav.position(i)!;expect(p.x< -4.4||p.x>4.4||p.z< -1.4||p.z>1.4).toBe(true);}}const points=Array.from({length:8},(_,i)=>nav.position(i)!);expect(points.every(p=>p.z>2)).toBe(true);for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)expect(Math.hypot(points[i]!.x-points[j]!.x,points[i]!.z-points[j]!.z)).toBeGreaterThan(.8);}finally{nav.dispose();}},20000);
  it('grounds on real sloping triangles without inventing a floor outside their edges',()=>{const ground=new TriangleGround([0,0,0,2,1,0,0,0,2],[0,2,1]);expect(ground.height(.5,.5,2,50)).toBeCloseTo(.25);expect(ground.height(1.9,1.9,2,50)).toBe(-Infinity);expect(ground.height(.5,.5,.1,50)).toBe(-Infinity);});
  it('kicks away from walls and disallows infinite jumps on the same wall',()=>{const world=new CollisionWorld();world.surfaces.push({id:'floor',x:0,z:0,width:30,depth:30,height:0});world.boxes.push({id:'wall',min:{x:-3,y:0,z:1},max:{x:3,y:8,z:1.2}});const player=new PlayerMotor(world,new EventBus(),{x:0,y:2,z:.65});player.grounded=false;player.velocity.y=-1;for(let i=0;i<12;i++)player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},0);player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1,jump:true},0);expect(player.wallJumps).toBe(1);expect(player.velocity.z).toBeLessThan(-5);expect(player.velocity.y).toBeGreaterThan(7);player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1,jump:true},0);expect(player.wallJumps).toBe(1);});
});

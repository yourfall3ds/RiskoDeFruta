import {it,expect} from 'vitest';
import {WALK_SPEED} from '../src/player/PlayerTuning';
import {readFileSync} from 'node:fs';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/GameInput';
import {capsuleTriangle,sweepCapsuleTriangle} from '../src/physics/CapsuleTriangle';
import {SolidInteriors} from '../src/physics/SolidInteriors';
it('sweeps the full capsule against a triangle face and a narrow edge at high velocity',()=>{
 const a=new Vector3(-4,-20,0),b=new Vector3(4,-20,0),c=new Vector3(0,20,0),hit=sweepCapsuleTriangle(new Vector3(0,-10,-5),new Vector3(0,0,20),.32,1.8,a,b,c);expect(hit).toBeDefined();expect(hit!.time).toBeCloseTo((5-.32)/20,3);expect(hit!.normal.z).toBeLessThan(-.99);
 expect(capsuleTriangle(new Vector3(0,0,-.32),.32,1.8,a,b,c).distance).toBeCloseTo(.32,5);
 expect(sweepCapsuleTriangle(new Vector3(8,0,-5),new Vector3(0,0,20),.32,1.8,a,b,c)).toBeUndefined();
});
it('blocks player and camera against the actual deep island mesh where old boxes did not exist',()=>{
 const solid=JSON.parse(readFileSync('public/models/solid-island-collision.json','utf8')),world=new CollisionWorld();world.setGeometry(solid.positions,solid.indices);world.prepareRaycasts();const shape=new SolidInteriors(solid.positions,solid.indices);
 for(const y of [-4,-8,-12,-16]){const p={x:35,y,z:0};world.moveAirborne(p,{x:-40,y:-1,z:0},.32,1.8);expect(p.x).toBeGreaterThan(6);expect(shape.contains({x:p.x,y:p.y+.9,z:p.z})).toBe(false);expect(p.x).toBeLessThan(26);const camera=world.sweepSphere({x:35,y:y+1,z:0},{x:-40,y:0,z:0},.25,true);expect(camera).toBeDefined();expect(camera!.collider.id).toMatch(/^mesh-/);}
 const interiors=new SolidInteriors(solid.positions,solid.indices);expect(interiors.contains({x:0,y:-10,z:0})).toBe(true);expect(interiors.contains({x:35,y:-10,z:0})).toBe(false);
 world.setRecoveryVolumes(solid.positions,solid.indices);world.surfaces.push({id:'safe',x:0,z:0,width:45,depth:48,height:0});const player=new PlayerMotor(world,new EventBus(),{x:0,y:0,z:0});player.hp=80;player.position.y=-10;player.fixedUpdate(1/60,EMPTY_INPUT,0);expect(player.solidRecoveries).toBe(1);expect(player.position.y).toBeCloseTo(0);expect(player.hp).toBeLessThan(81);
});
it('walks on the real island top without treating its ground as an interior',()=>{
 const g=JSON.parse(readFileSync('public/models/solid-island-collision.json','utf8')),world=new CollisionWorld();world.setGeometry(g.positions,g.indices);world.prepareRaycasts();world.setRecoveryVolumes(g.positions,g.indices);world.surfaces.push({id:'field',x:0,z:0,width:48,depth:52,height:0,ellipse:true});const player=new PlayerMotor(world,new EventBus(),{x:0,y:0,z:0});for(let i=0;i<Math.ceil(9/WALK_SPEED*60)+30;i++)player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},0);expect(player.position.z).toBeGreaterThan(8);expect(player.solidRecoveries).toBe(0);
});

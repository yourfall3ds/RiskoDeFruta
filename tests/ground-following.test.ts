import {it,expect} from 'vitest';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/InputFrame';

it('stays grounded while descending walkable stair treads instead of falling on each step',()=>{
 const world=new CollisionWorld();world.surfaces.push({id:'floor',x:0,z:5,width:20,depth:30,height:0});
 for(let i=0;i<8;i++)world.boxes.push({id:'step-'+i,min:{x:-2,y:0,z:i*.8},max:{x:2,y:(8-i)*.25,z:(i+1)*.8}});
 const player=new PlayerMotor(world,new EventBus(),{x:0,y:2,z:.4});let airborne=0;
 for(let i=0;i<100;i++){player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},0);if(!player.grounded)airborne++;}
 expect(player.position.z).toBeGreaterThan(7);expect(player.position.y).toBeCloseTo(0);expect(airborne).toBe(0);expect(player.solidRecoveries).toBe(0);
});
it('settles and remains controllable on a triangle slope after landing',()=>{
 const world=new CollisionWorld();world.setGeometry([-5,0,-5,5,0,-5,-5,4,5,5,4,5],[0,2,1,1,2,3]);world.prepareRaycasts();
 const player=new PlayerMotor(world,new EventBus(),{x:0,y:4,z:0});player.grounded=false;
 for(let i=0;i<120;i++)player.fixedUpdate(1/60,EMPTY_INPUT,0);
 expect(player.grounded).toBe(true);expect(player.position.y).toBeCloseTo(world.groundAt(player.position.x,player.position.z,10),2);
 let airborne=0;for(let i=0;i<35;i++){player.fixedUpdate(1/60,{...EMPTY_INPUT,z:-1},0);if(!player.grounded)airborne++;}
 expect(player.position.z).toBeLessThan(-2);expect(airborne).toBe(0);expect(player.position.y).toBeCloseTo(world.groundAt(player.position.x,player.position.z,10),2);
});

it('does not snap down a cliff or cancel an intentional jump',()=>{
 const world=new CollisionWorld();world.surfaces.push({id:'lower',x:0,z:0,width:50,depth:50,height:0});world.boxes.push({id:'ledge',min:{x:-3,y:0,z:-3},max:{x:3,y:3,z:1}});
 const player=new PlayerMotor(world,new EventBus(),{x:0,y:3,z:.9});player.velocity.z=5.4;
 for(let i=0;i<3;i++)player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},0);
 expect(player.grounded).toBe(false);expect(player.position.y).toBeGreaterThan(2.9);
 player.resetAt({x:0,y:3,z:0});player.fixedUpdate(1/60,{...EMPTY_INPUT,jump:true},0);expect(player.grounded).toBe(false);expect(player.position.y).toBeGreaterThan(3);
});

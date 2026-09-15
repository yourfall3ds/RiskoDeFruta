import {it,expect} from 'vitest';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/InputFrame';
it.each([[1.25,0],[1.25,1.25]])('does not hang beside the unsupported edge of a prop at %s,%s',(x,z)=>{
 const world=new CollisionWorld();world.surfaces.push({id:'floor',x:0,z:0,width:20,depth:20,height:0});
 world.boxes.push({id:'rock',min:{x:-1,y:0,z:-1},max:{x:1,y:2,z:1}});
 const player=new PlayerMotor(world,new EventBus(),{x,y:3,z});player.grounded=false;
 for(let n=0;n<240;n++)player.fixedUpdate(1/60,EMPTY_INPUT,0);
 expect(player.position.y).toBeCloseTo(0,2);expect(player.grounded).toBe(true);expect(player.solidRecoveries).toBe(0);
});
it('still lands on a prop and cannot pass through its sides at high speed',()=>{
 const world=new CollisionWorld();world.boxes.push({id:'rock',min:{x:-1,y:0,z:-1},max:{x:1,y:2,z:1}});
 const p={x:0,y:6,z:0};world.moveAirborne(p,{x:0,y:-20,z:0},.32,1.8);expect(p.y).toBeCloseTo(2,2);
 const side={x:5,y:0,z:0};world.moveAirborne(side,{x:-20,y:0,z:0},.32,1.8);expect(side.x).toBeGreaterThanOrEqual(1.319);expect(side.x).toBeLessThan(1.33);
});

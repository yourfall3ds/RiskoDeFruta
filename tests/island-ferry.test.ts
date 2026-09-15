import {it,expect} from 'vitest';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {IslandFerry,ferryPose} from '../src/world/IslandFerry';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/GameInput';
it('waits at each aligned dock and follows a continuous periodic route',()=>{expect(ferryPose(0).x).toBe(-26);expect(ferryPose(2.99).x).toBe(-26);expect(ferryPose(9).x).toBe(-34);expect(ferryPose(11.99).x).toBe(-34);expect(ferryPose(18).x).toBe(-26);for(let i=0;i<1080;i++)expect(ferryPose((i+1)/60).subtract(ferryPose(i/60)).length()).toBeLessThan(.04);});
it('carries a grounded rider without recording a respawn in midair, and keeps the island footprint circular',()=>{
 const world=new CollisionWorld(),ferry=new IslandFerry(world),player=new PlayerMotor(world,new EventBus(),{x:-21,y:0,z:-8});player.position.x=-26;player.previous.x=-26;
 for(let i=0;i<600;i++){ferry.update(1/60,player);player.fixedUpdate(1/60,EMPTY_INPUT,0);}expect(player.position.x).toBeCloseTo(-34,3);expect(player.position.y).toBeCloseTo(0,3);expect(player.grounded).toBe(true);expect(player.respawns).toBe(0);expect(player.safe.x).toBe(-21);expect(world.groundAt(-30.7,-4.7)).toBe(-Infinity);ferry.dispose();expect(world.surfaces).toHaveLength(0);expect(world.movingBoxes).toHaveLength(0);
});

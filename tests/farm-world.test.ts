import { describe,it,expect } from 'vitest';
import {WALK_SPEED} from '../src/player/PlayerTuning';
import { readFileSync } from 'node:fs';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { PlayerMotor } from '../src/player/PlayerMotor';
import { EventBus } from '../src/core/EventBus';
import { EMPTY_INPUT } from '../src/input/GameInput';

describe('farm traversal',()=>{
  it('crosses both suspension bridges without falling through their sagging decks',()=>{
    const data=JSON.parse(readFileSync('public/models/farm-collision.json','utf8'));const world=new CollisionWorld();world.boxes.push(...data.boxes);world.surfaces.push(...data.surfaces);const actual=JSON.parse(readFileSync('public/models/world-collision-mesh.json','utf8'));world.boxes.push(...actual.boxes);world.setGeometry(actual.positions,actual.indices);
    for(const side of [-1,1]){const player=new PlayerMotor(world,new EventBus(),{x:side*18,y:0,z:side<0?0:8});for(let tick=0;tick<310;tick++)player.fixedUpdate(1/60,{...EMPTY_INPUT,x:side},0);expect(Math.abs(player.position.x)).toBeGreaterThan(38);expect(player.position.y).toBeCloseTo(side<0?0:2,1);expect(player.respawns).toBe(0);}
  });
  it('walks from spawn up the rising path into the open barn doorway',()=>{
    const data=JSON.parse(readFileSync('public/models/farm-collision.json','utf8'));const world=new CollisionWorld();world.boxes.push(...data.boxes);world.surfaces.push(...data.surfaces);const actual=JSON.parse(readFileSync('public/models/world-collision-mesh.json','utf8'));world.boxes.push(...actual.boxes);world.setGeometry(actual.positions,actual.indices);
    const player=new PlayerMotor(world,new EventBus(),{x:0,y:0,z:-10});
    for(let tick=0;tick<Math.ceil(43.6/WALK_SPEED*60)+90;tick++)player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},0);
    expect(player.position.z).toBeGreaterThan(29);expect(player.position.y).toBeCloseTo(5,1);expect(player.respawns).toBe(0);
  });
  it('has real island edges instead of an invisible rectangular floor',()=>{
    const world=new CollisionWorld();world.surfaces.push({id:'island',x:0,z:0,width:48,depth:52,height:0,ellipse:true});
    expect(world.groundAt(0,0)).toBe(0);expect(world.groundAt(23,25)).toBe(-Infinity);
  });
  it('meets the upper plateau at its front edge without a ramp below the floor',()=>{
    const data=JSON.parse(readFileSync('public/models/farm-collision.json','utf8'));const world=new CollisionWorld();world.surfaces.push(...data.surfaces);
    expect(world.groundAt(0,19.98)).toBeCloseTo(4.99);expect(world.groundAt(0,20)).toBe(5);expect(world.groundAt(0,20.02)).toBe(5);
  });
});



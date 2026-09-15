import {it,expect} from 'vitest';
import {DeathFlight} from '../src/player/DeathFlight';
import {CollisionWorld} from '../src/physics/CollisionWorld';
function floor(){const world=new CollisionWorld();world.surfaces.push({id:'floor',x:0,z:0,width:50,depth:50,height:0});return world;}
it('launches backward and upward, lands and remains still until the defeat screen',()=>{
 const flight=new DeathFlight(floor());flight.start({x:0,y:0,z:0},0);let peak=0;
 for(let i=0;i<168;i++){flight.update(1/60);peak=Math.max(peak,flight.position.y);}
 expect(peak).toBeGreaterThan(1.8);expect(flight.position.z).toBeLessThan(-3);expect(flight.position.z).toBeGreaterThan(-6);expect(flight.position.y).toBe(0);expect(flight.landed).toBe(true);
 const end={...flight.position};flight.update(1);expect(flight.position).toEqual(end);
 flight.start({x:2,y:0,z:4},Math.PI/2);flight.update(.1);expect(flight.position.x).toBeLessThan(2);expect(flight.position.z).toBeCloseTo(4);
});
it('cannot launch through a wall behind the victim',()=>{
 const world=floor();world.boxes.push({id:'wall',min:{x:-10,y:-2,z:-2},max:{x:10,y:20,z:-1.7}});const flight=new DeathFlight(world);flight.start({x:0,y:0,z:0},0);
 for(let i=0;i<168;i++){flight.update(1/60);expect(flight.position.z).toBeGreaterThan(-1.301);}
 expect(flight.landed).toBe(true);expect(flight.position.y).toBe(0);
});
it('ignores paused or invalid time and bounds the descent beyond a cliff',()=>{
 const flight=new DeathFlight(new CollisionWorld());flight.start({x:0,y:1,z:0},0);
 for(const dt of [0,-1,NaN,Infinity])flight.update(dt);expect(flight.position).toEqual({x:0,y:1,z:0});
 for(let i=0;i<600;i++)flight.update(1/60);expect(flight.position.y).toBeGreaterThan(-18);expect(flight.landed).toBe(true);
});

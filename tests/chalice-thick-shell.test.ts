import {describe,it,expect} from 'vitest';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {PlanetFrame} from '../src/planet/PlanetFrame';
import {SphereSurface} from '../src/physics/SphereSurface';
import {isOuterDeck} from '../src/run/ExpeditionObjectives';

function shell(heights:number[]) {
  const positions:number[]=[],indices:number[]=[];
  for(const y of heights){
    const i=positions.length/3;
    positions.push(-25,y,-25,25,y,-25,25,y,25,-25,y,25);
    indices.push(i,i+2,i+1,i,i+3,i+2);
  }
  const collision=new PlanetCollision();collision.setGeometry(positions,indices);
  const frame=new PlanetFrame({centre:{x:0,y:0,z:0},surfaceRadius:180,voidRadius:150,ceilingRadius:288,islandRadius:72});
  return new SphereSurface(frame,collision);
}

describe('chalice cannot sit inside a thick island shell',()=>{
  it('rejects an underside even when the collision capsule is wholly inside and touches no triangles',()=>{
    const surface=shell([179,191]),underside={x:0,y:179,z:0};
    // Collision contact alone cannot classify the interior of a closed shell.
    expect(surface.insideSolid({x:0,y:179.9,z:0},1.6)).toBe(false);
    expect(isOuterDeck(surface,underside)).toBe(false);
    expect(isOuterDeck(surface,{x:0,y:191,z:0})).toBe(true);
  });
  it('rejects a floating anchor but accepts the exposed top',()=>{
    const surface=shell([180]);
    expect(isOuterDeck(surface,{x:0,y:180,z:0})).toBe(true);
    expect(isOuterDeck(surface,{x:0,y:182,z:0})).toBe(false);
  });
});

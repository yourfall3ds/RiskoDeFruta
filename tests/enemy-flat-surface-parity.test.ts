import {expect,it} from 'vitest';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {enemySpace} from '../src/enemies/EnemySpace';

it('keeps the original enemy movement path when GameWorld exposes a flat surface',()=>{
  const world=new CollisionWorld();
  world.surfaces.push({id:'floor',x:0,z:0,width:100,depth:100,height:0});
  const legacy=enemySpace(world);
  const wrapped=enemySpace(world,world.surface);
  expect(wrapped.radial).toBe(false);
  for(const p of [{x:0,y:0,z:0},{x:5,y:2,z:4},{x:-2,y:8,z:-6}]){
    const expected=new Vector3(),actual=new Vector3();
    expect(wrapped.groundUnder(p,1,actual)).toBe(legacy.groundUnder(p,1,expected));
    expect(actual.asArray()).toEqual(expected.asArray());
    expect(wrapped.bucketKey(p)).toBe(legacy.bucketKey(p));
  }
});

import {describe,it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {RocketExplosion} from '../src/combat/RocketExplosion';
describe('rocket explosion lifetime',()=>{
 it('caps overlapping blasts and removes their meshes and materials',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),fx=new RocketExplosion(scene);
  const initial=scene.materials.length;
  for(let i=0;i<24;i++)fx.emit(Vector3.Zero(),Vector3.Right(),3);
  expect(scene.meshes.length).toBe(8);
  expect(scene.materials.length).toBe(initial+8);
  const before=scene.meshes[0]!.position.clone();fx.update(.5);
  expect(scene.meshes[0]!.position.x).toBeGreaterThan(before.x);
  expect(scene.meshes[0]!.position.y).toBe(before.y);
  fx.update(2);expect(scene.meshes.length).toBe(0);expect(scene.materials.length).toBe(initial);
  fx.dispose();scene.dispose();engine.dispose();
 });
});

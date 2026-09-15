import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {FarCanopies} from '../src/world/streaming/FarCanopies';
it('batches only distant-tier trees and refreshes bounds after the viewer moves',()=>{
 const engine=new NullEngine();engine.getCaps().instancedArrays=true;const scene=new Scene(engine);
 const batch=new FarCanopies(scene,300,new Texture(null,scene));
 const trees=Array.from({length:300},(_,i)=>({center:{x:i,y:8,z:0},size:16,visible:i>=23}));
 try{
  batch.update(trees,{x:0,y:2,z:30});expect(batch.mesh.thinInstanceCount).toBe(277);expect(scene.meshes).toHaveLength(1);
  expect(batch.mesh.getTotalVertices()).toBe(4);expect(batch.mesh.isPickable).toBe(false);
  const matrices=batch.mesh.thinInstanceGetWorldMatrices();expect(matrices[0]!.getTranslation().x).toBe(23);expect(matrices.at(-1)!.getTranslation().x).toBe(299);
  expect(batch.mesh.getBoundingInfo().boundingBox.maximum.x).toBeGreaterThan(299);
  batch.update(trees,{x:10000,y:2,z:0});expect(batch.mesh.thinInstanceCount).toBe(0);expect(batch.mesh.isVisible).toBe(false);
  trees[0]!.visible=true;batch.update(trees,{x:0,y:2,z:30});expect(batch.mesh.thinInstanceCount).toBe(278);
  batch.dispose();batch.dispose();batch.update(trees,{x:0,y:0,z:0});expect(scene.meshes).toHaveLength(0);
 }finally{scene.dispose();engine.dispose();}
});

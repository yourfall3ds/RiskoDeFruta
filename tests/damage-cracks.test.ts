import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {DamageCracks,crackPixels,CRACK_STAGES} from '../src/destruction/DamageCracks';
it('grows the same fracture network without erasing earlier cracks',()=>{
 let previous=crackPixels(0),area=0;
 for(let stage=1;stage<=CRACK_STAGES;stage++){
  const pixels=crackPixels(stage);let nextArea=0;
  for(let i=3;i<pixels.length;i+=4){expect(pixels[i]).toBeGreaterThanOrEqual(previous[i]!);if(pixels[i])nextArea++;}
  expect(nextArea).toBeGreaterThan(area);expect(nextArea).toBeLessThan(128*128*.55);
  previous=pixels;area=nextArea;
 }
});
it('follows the original surface, preserves its material and frees overlays on reset',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),cracks=new DamageCracks(scene,2);
 try{
 const box=CreateBox('crate',{},scene),material=new StandardMaterial('wood',scene);box.material=material;
 cracks.apply('crate',[box],.9);
 const overlay=box.getChildMeshes()[0]!;expect(overlay.getTotalVertices()).toBe(box.getTotalVertices());expect(overlay.isPickable).toBe(false);
 const first=overlay.material;cracks.apply('crate',[box],.15);expect(overlay.material).not.toBe(first);expect(box.material).toBe(material);expect(box.getChildMeshes()).toHaveLength(1);
 cracks.apply('b',[CreateBox('b',{},scene)],.5);cracks.apply('c',[CreateBox('c',{},scene)],.5);
 expect(cracks.count).toBe(2);expect(box.getChildMeshes()).toHaveLength(0);
 cracks.reset();expect(cracks.count).toBe(0);expect(box.isEnabled()).toBe(true);
 }finally{cracks.dispose();scene.dispose();engine.dispose();}
});

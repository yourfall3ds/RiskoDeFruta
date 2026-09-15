import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {FreeCamera} from '@babylonjs/core/Cameras/freeCamera';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {createSeamlessSky} from '../src/rendering/SeamlessSky';
it('keeps the sky centered on the actual camera throughout an expanded world',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),camera=new FreeCamera('view',Vector3.Zero(),scene);scene.activeCamera=camera;
 const sky=createSeamlessSky(scene);
 try{for(const position of [new Vector3(0,2,0),new Vector3(285,17,245),new Vector3(-1500,80,2000)]){
  camera.position.copyFrom(position);scene.incrementRenderId();camera.computeWorldMatrix();sky.computeWorldMatrix();
  expect(Vector3.Distance(sky.getWorldMatrix().getTranslation(),camera.globalPosition)).toBeLessThan(.001);
  expect(sky.isWorldMatrixFrozen).toBe(false);
 }expect(sky.isPickable).toBe(false);expect(sky.applyFog).toBe(false);}finally{scene.dispose();engine.dispose();}
});

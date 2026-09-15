import { describe,it,expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3,Matrix } from '@babylonjs/core/Maths/math.vector';
import { ThirdPersonCamera } from '../src/camera/ThirdPersonCamera';
import { CollisionWorld } from '../src/physics/CollisionWorld';

describe('reference shoulder camera',()=>{
  it.each([[1672,941],[718,696]])('keeps the player in the left third at %i × %i',(width,height)=>{
    const engine=new NullEngine({renderWidth:width,renderHeight:height,textureSize:512,deterministicLockstep:false,lockstepMaxSteps:4});
    const scene=new Scene(engine);try {
      const rig=new ThirdPersonCamera(scene,new CollisionWorld());rig.update({x:0,y:0,z:0},0,.02,1/60);
      const projection=rig.camera.getViewMatrix().multiply(rig.camera.getProjectionMatrix(true));
      const head=Vector3.Project(new Vector3(0,1.8,0),Matrix.Identity(),projection,rig.camera.viewport.toGlobal(width,height));
      expect(head.x/width).toBeGreaterThan(.32);expect(head.x/width).toBeLessThan(.37);
      expect(head.y/height).toBeGreaterThan(.35);expect(head.y/height).toBeLessThan(.45);
      expect(rig.forward.z).toBeGreaterThan(.99);
    }finally{scene.dispose();engine.dispose();}
  });
  it('retracts before a wall and smoothly returns after the obstruction disappears',()=>{
    const engine=new NullEngine();const scene=new Scene(engine);try {
      const world=new CollisionWorld();world.boxes.push({id:'wall',min:{x:-5,y:0,z:-1},max:{x:5,y:4,z:-.9}});
      const rig=new ThirdPersonCamera(scene,world);rig.update({x:0,y:0,z:0},0,0,1/60);
      expect(rig.camera.position.z).toBeGreaterThan(-.65);
      world.boxes.length=0;rig.update({x:0,y:0,z:0},0,0,1/60);
      expect(rig.camera.position.z).toBeGreaterThan(-2.25);
      for(let i=0;i<60;i++)rig.update({x:0,y:0,z:0},0,0,1/60);
      expect(rig.camera.position.z).toBeCloseTo(-2.25,3);
    }finally{scene.dispose();engine.dispose();}
  });
});
it('keeps a blocked skill close out of the player and inside available world space',()=>{const engine=new NullEngine(),scene=new Scene(engine);try{const world=new CollisionWorld();world.boxes.push({id:'front',min:{x:-.8,y:0,z:.45},max:{x:.8,y:3,z:.7}});const rig=new ThirdPersonCamera(scene,world);rig.update({x:0,y:0,z:0},0,0,1/60);rig.skillClose({x:0,y:0,z:0},0,2,1);expect(Vector3.Distance(rig.camera.position,new Vector3(0,1.05,0))).toBeGreaterThan(1.35);expect(world.insideSolid(rig.camera.position,.1)).toBe(false);}finally{scene.dispose();engine.dispose();}});

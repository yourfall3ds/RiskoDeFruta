import { expect,it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { Bone } from '@babylonjs/core/Bones/bone';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Matrix,Quaternion } from '@babylonjs/core/Maths/math.vector';
import { PosePalette } from '../src/animation/PosePalette';
it('matches linked-node skinning and reuses unchanged bone matrices between pose samples',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),node=new TransformNode('joint',scene);
  const reference=new Skeleton('reference','r',scene),cached=new Skeleton('cached','c',scene);
  const original=new Bone('joint',reference,null,Matrix.Identity()),bone=new Bone('joint',cached,null,Matrix.Identity());
  original.linkTransformNode(node);bone.linkTransformNode(node);const palette=new PosePalette([cached]);let computations=0;cached.onBeforeComputeObservable.add(()=>computations++);
  node.position.set(.2,1,.3);node.rotationQuaternion=Quaternion.RotationYawPitchRoll(.3,.6,.2);node.scaling.set(1,.9,1.1);palette.sync();reference.prepare(true);cached.prepare(true);
  expect([...cached.getTransformMatrices(null)]).toEqual([...reference.getTransformMatrices(null)]);
  for(let i=0;i<60;i++){palette.sync();cached.prepare(true);}expect(computations).toBe(1);
  node.rotationQuaternion=Quaternion.RotationYawPitchRoll(.8,.2,.1);palette.sync();cached.prepare(true);reference.prepare(true);expect(computations).toBe(2);expect([...cached.getTransformMatrices(null)]).toEqual([...reference.getTransformMatrices(null)]);
  scene.dispose();engine.dispose();
});

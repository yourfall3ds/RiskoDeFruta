import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import HavokPhysics from '@babylonjs/havok';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {HavokPlugin} from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import {PhysicsAggregate} from '@babylonjs/core/Physics/v2/physicsAggregate';
import {PhysicsShapeType} from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import {CreateSphere} from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import {addRagdollTerrain,ensureRagdollPhysics} from '../src/physics/RagdollWorld';
it('real Havok bodies land on regional terrain and fall after that region is released',async()=>{
 const hk=await HavokPhysics({wasmBinary:new Uint8Array(readFileSync('node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm')).buffer}),engine=new NullEngine(),scene=new Scene(engine);scene.enablePhysics(new Vector3(0,-18,0),new HavokPlugin(true,hk));
 try{
  const physics=scene.getPhysicsEngine()!;await ensureRagdollPhysics(scene);expect(scene.getPhysicsEngine()).toBe(physics);
  const floor=(x:number)=>({positions:[x-4,0,-4,x+4,0,-4,x+4,0,4,x-4,0,4],indices:[0,2,1,0,3,2]});
  const releaseA=addRagdollTerrain(scene,'a',floor(0)),releaseB=addRagdollTerrain(scene,'b',floor(20));
  const ballA=CreateSphere('a',{diameter:1},scene),ballB=CreateSphere('b',{diameter:1},scene);ballA.position.set(0,4,0);ballB.position.set(20,4,0);
  const a=new PhysicsAggregate(ballA,PhysicsShapeType.SPHERE,{mass:1,restitution:0},scene),b=new PhysicsAggregate(ballB,PhysicsShapeType.SPHERE,{mass:1,restitution:0},scene);
  for(let i=0;i<180;i++)physics._step(1/60);expect(ballA.position.y).toBeCloseTo(.5,1);expect(ballB.position.y).toBeCloseTo(.5,1);
  releaseA();releaseA();a.body.setLinearVelocity(new Vector3(0,-1,0));for(let i=0;i<90;i++)physics._step(1/60);
  expect(ballA.position.y).toBeLessThan(-3);expect(ballB.position.y).toBeCloseTo(.5,1);expect(scene.getMeshByName('terrain-physics-a')).toBeNull();expect(scene.getMeshByName('terrain-physics-b')).not.toBeNull();
  a.dispose();b.dispose();releaseB();
 }finally{scene.dispose();engine.dispose();}
},20000);
it('terrain cannot activate before its physics scene is ready',()=>{const engine=new NullEngine(),scene=new Scene(engine);try{expect(()=>addRagdollTerrain(scene,'invalid',{positions:[0,0,0],indices:[0,0,0]})).toThrow();expect(scene.meshes).toHaveLength(0);}finally{scene.dispose();engine.dispose();}});

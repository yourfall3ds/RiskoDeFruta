import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import HavokPhysics from '@babylonjs/havok';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {HavokPlugin} from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {PhysicsAggregate} from '@babylonjs/core/Physics/v2/physicsAggregate';
import {PhysicsShapeType} from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import {RagdollWorld} from '../src/physics/RagdollWorld';
import {PosePalette} from '../src/animation/PosePalette';
import {AnimationStateMachine} from '../src/animation/AnimationStateMachine';

describe('original enemy physics integrity',()=>{
 it.each(['eggplant','corn','carrot','tomato','watermelon'])('keeps %s bones at their original scale through a physical death',async name=>{
  const engine=new NullEngine(),scene=new Scene(engine),manager=new RagdollWorld();
  try{
   const hk=await HavokPhysics({wasmBinary:new Uint8Array(readFileSync('node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm')).buffer});scene.enablePhysics(new Vector3(0,-18,0),new HavokPlugin(true,hk));
   const floor=CreateBox('floor',{width:40,depth:40,height:.2},scene);floor.position.y=-.1;new PhysicsAggregate(floor,PhysicsShapeType.BOX,{mass:0},scene);
   const container=await LoadAssetContainerAsync(new Uint8Array(readFileSync(`public/models/original-${name}.glb`)),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
   const instance=container.instantiateModelsToScene(n=>`test-${n}`,false,{doNotInstantiate:true});const root=new TransformNode('actor',scene);root.position.set(3,0,2);root.rotation.y=.6;root.scaling.setAll(1.2);for(const n of instance.rootNodes)n.parent=root;
   const body=root.getChildMeshes().find(m=>m.getTotalVertices()>0) as Mesh,skeleton=instance.skeletons[0]!,palette=new PosePalette(instance.skeletons);
   const clips=new Map(instance.animationGroups.map(c=>{c.stop();return[c.name.endsWith('Run')?'Run':c.name,c] as const;}));new AnimationStateMachine(clips).sample('Run',.3,1);palette.sync();root.computeWorldMatrix(true);body.computeWorldMatrix(true);skeleton.computeAbsoluteMatrices(true);
   const scales=skeleton.bones.map(b=>b.scaling.clone()),handle=manager.create(skeleton,body,{attackerId:1,victimId:2,sourceId:'test',attackId:'test',baseDamage:999,finalDamage:999,crit:false,procCoefficient:0,procChainDepth:1,damageTags:['test'],hitPosition:{x:3,y:1,z:2},hitNormal:{x:0,y:0,z:-1},forceDirection:{x:0,y:0,z:1},forceMagnitude:3},1.2);
   expect(handle).toBeDefined();expect(handle!.rig.getConstraints().length).toBeGreaterThan(2);
   for(let i=0;i<240;i++){scene.getPhysicsEngine()!._step(1/60);scene.onBeforeRenderObservable.notifyObservers(scene);for(const [j,b] of skeleton.bones.entries()){expect(Vector3.Distance(b.scaling,scales[j]!)).toBeLessThan(.01);expect(b.getAbsolutePosition(body).length()).toBeLessThan(30);}}
   manager.clear();expect(manager.count).toBe(0);palette.sync();for(const [j,b] of skeleton.bones.entries())expect(Vector3.Distance(b.scaling,scales[j]!)).toBeLessThan(.01);
  }finally{manager.clear();scene.dispose();engine.dispose();}
 },20000);
});


import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Ray} from '@babylonjs/core/Culling/ray';
import {DualPistols} from '../src/combat/DualPistols';
import {StaticRayIndex} from '../src/physics/StaticRayIndex';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';
import {RunRNG} from '../src/core/RunRNG';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {AnimationStateMachine} from '../src/animation/AnimationStateMachine';
import {poseAkimbo} from '../src/animation/StylishAim';
import type {CharacterVisual} from '../src/animation/CharacterVisual';
import type {ThirdPersonCamera} from '../src/camera/ThirdPersonCamera';
import type {WeaponAudio} from '../src/audio/WeaponAudio';
it('distributes all 14 barrage rays over the flip, never 14 on the release frame',()=>{
 const engine=new NullEngine(),scene=new Scene(engine);try{const visual={ready:true,release:vi.fn()} as unknown as CharacterVisual,camera={forward:Vector3.Forward()} as ThirdPersonCamera,w=new DualPistols(scene,camera,visual,{targets:[]},new RunRNG('skills').stream('run'),new EventBus(),{} as WeaponAudio),spy=vi.spyOn(w as any,'skillRay').mockImplementation(()=>{});
 w.releaseSkill(2);expect(spy).toHaveBeenCalledTimes(0);for(let i=0;i<60;i++){const before=spy.mock.calls.length;w.fixedUpdate(1/60,false);expect(spy.mock.calls.length-before).toBeLessThanOrEqual(1);}expect(spy).toHaveBeenCalledTimes(14);w.dispose();}finally{scene.dispose();engine.dispose();}
});
it('matches exact nearest triangle rays through the real world using the static index',()=>{
 const g=JSON.parse(readFileSync('public/models/solid-island-collision.json','utf8')),bvh=new StaticRayIndex(g.positions,g.indices);
 for(const [origin,dir] of [[new Vector3(0,12,34),Vector3.Down()],[new Vector3(8,2,0),Vector3.Forward()],[new Vector3(70,-5,8),new Vector3(-1,0,0)]]){
  const ray=new Ray(origin!,dir!,120);let expected=Infinity;for(let i=0;i<g.indices.length;i+=3){const p=(k:number)=>Vector3.FromArray(g.positions,g.indices[i+k]*3);const hit=ray.intersectsTriangle(p(0),p(1),p(2));if(hit&&hit.distance>.002&&hit.distance<ray.length)expected=Math.min(expected,hit.distance);}expect(bvh.cast(ray)?.distance).toBeCloseTo(expected,4);
 }
});
it('closes each island shell and blocks entering below the barn while leaving the stair approach open',()=>{
 const audit=JSON.parse(readFileSync('docs/solid-geology.json','utf8'));expect(audit).toHaveLength(10);for(const island of audit){expect(island.nonManifoldEdges).toBe(0);expect(island.depth).toBeGreaterThanOrEqual(20);}
 const g=JSON.parse(readFileSync('public/models/solid-island-collision.json','utf8')),world=new CollisionWorld();world.boxes.push(...g.boxes);const p={x:8,y:0,z:15};world.move(p,0,20,.4,1.8,.35);expect(p.z).toBeLessThan(24);const stair={x:0,y:0,z:10};world.move(stair,0,9,.4,1.8,.35);expect(stair.z).toBeCloseTo(19);
});
it('keeps the anatomical front along the gameplay forward for the original walk clips',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);try{for(const species of ['eggplant','corn','carrot']){const model=await ImportMeshAsync(new Uint8Array(readFileSync('public/models/original-'+species+'.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});const clips=new Map(model.animationGroups.map(c=>{c.stop();return[c.name,c] as const;}));new AnimationStateMachine(clips).sample('Walk',.12,1);for(const mesh of model.meshes)mesh.computeWorldMatrix(true);const foot=model.transformNodes.find(n=>n.name==='LeftFoot')!,toe=model.transformNodes.find(n=>n.name==='LeftToeBase')!;foot.computeWorldMatrix(true);toe.computeWorldMatrix(true);expect(toe.getAbsolutePosition().z-foot.getAbsolutePosition().z,species).toBeGreaterThan(0);for(const m of model.meshes)if(!m.parent)m.dispose();}}finally{scene.dispose();engine.dispose();}
});
it('crosses the wrists while keeping arm lengths and independent barrel aim',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);try{const model=await ImportMeshAsync(new Uint8Array(readFileSync('public/models/gunslinger.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});const clips=new Map(model.animationGroups.map(c=>{c.stop();return[c.name,c] as const;})),machine=new AnimationStateMachine(clips);
 for(const sign of [-1,1]){machine.sample('Aim',0,1);const side=sign===1?'Right':'Left',arm=model.transformNodes.find(n=>n.name===side+'Arm')!,fore=model.transformNodes.find(n=>n.name===side+'ForeArm')!,hand=model.transformNodes.find(n=>n.name===side+'Hand')!,grip=model.transformNodes.find(n=>n.name===side+'WeaponGrip')!,wrist=new Vector3(-sign*.10,1.30+sign*.025,.18),aim=new Vector3(sign*3,2,15);poseAkimbo(arm,fore,hand,grip,wrist,new Vector3(sign*.65,.78,0),aim);expect(Vector3.Distance(hand.getAbsolutePosition(),wrist)).toBeLessThan(.06);expect(Vector3.Dot(Vector3.TransformNormal(Vector3.Forward(),grip.computeWorldMatrix(true)).normalize(),aim.subtract(hand.getAbsolutePosition()).normalize())).toBeGreaterThan(.999);}
 }finally{scene.dispose();engine.dispose();}
});

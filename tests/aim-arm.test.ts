import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {AnimationStateMachine} from '../src/animation/AnimationStateMachine';
import {aimArmAt} from '../src/animation/AimArm';

it('keeps both grips inside their gloves and aligns the complete arms at every aim elevation',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{const imported=await ImportMeshAsync(new Uint8Array(readFileSync('public/models/gunslinger.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
 const clips=new Map(imported.animationGroups.map(c=>{c.stop();return[c.name,c] as const;})),machine=new AnimationStateMachine(clips);
 for(const yaw of [-1,0,1])for(const pitch of [-1.1,-.5,0,.5,1.1]){
  machine.sample('Aim',0,1);const direction=new Vector3(Math.sin(yaw)*Math.cos(pitch),-Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));
  for(const side of ['Right','Left']){const arm=imported.transformNodes.find(n=>n.name===side+'Arm')!,hand=imported.transformNodes.find(n=>n.name===side+'Hand')!,grip=imported.transformNodes.find(n=>n.name===side+'WeaponGrip')!;aimArmAt(arm,grip,direction);const forward=Vector3.TransformNormal(Vector3.Forward(),grip.computeWorldMatrix(true)).normalize();expect(Vector3.Dot(forward,direction)).toBeGreaterThan(.999);expect(Vector3.Distance(hand.getAbsolutePosition(),grip.getAbsolutePosition())).toBeLessThan(.2);const scale=Vector3.Zero();grip.getWorldMatrix().decompose(scale);expect(Math.abs(scale.x)).toBeCloseTo(1,3);}
 }
 }finally{scene.dispose();engine.dispose();}
});

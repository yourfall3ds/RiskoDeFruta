import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {CharacterVisual} from '../src/animation/CharacterVisual';
import {RadialAvatar} from '../src/animation/RadialAvatar';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
it('keeps authored arms during arrival even when the camera points elsewhere',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine),world=new CollisionWorld();
 const visual=new CharacterVisual(scene,()=>{}),avatar=new RadialAvatar(scene,visual,()=>world.surface);
 try{
 const imported=await ImportMeshAsync(new Uint8Array(readFileSync('public/models/gunslinger.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
 const rig=visual as unknown as {clips:Map<string,AnimationGroup>;bones:Map<string,TransformNode>};
 for(const clip of imported.animationGroups){clip.stop();rig.clips.set(clip.name,clip);}
 for(const mesh of imported.meshes)if(!mesh.parent)mesh.parent=visual.root;
 for(const node of imported.transformNodes)rig.bones.set(node.name,node);
 for(const side of ['Right','Left'])visual.grips.push(rig.bones.get(side+'WeaponGrip'));
 visual.ready=true;const motor=new PlayerMotor(world,new EventBus(),{x:0,y:0,z:0});
 visual.arrivalPose={height:0,recovery:0,stride:{clip:'Idle',progress:.3,yaw:0,pitch:0,roll:0}};
 for(let i=0;i<30;i++)visual.update(motor,1,1/60,true);
 const arms=['LeftArm','RightArm'].map(name=>rig.bones.get(name)!);
 const expected=arms.map(arm=>arm.rotationQuaternion!.clone());
 for(let i=0;i<120;i++)avatar.update(motor,1,1/60,true,false,0,0,{x:1,y:0,z:0});
 arms.forEach((arm,i)=>expect(Math.abs(arm.rotationQuaternion!.x-expected[i]!.x)+Math.abs(arm.rotationQuaternion!.y-expected[i]!.y)+Math.abs(arm.rotationQuaternion!.z-expected[i]!.z)+Math.abs(arm.rotationQuaternion!.w-expected[i]!.w)).toBeLessThan(.0001));
 }finally{avatar.dispose();visual.dispose();scene.dispose();engine.dispose();}
});

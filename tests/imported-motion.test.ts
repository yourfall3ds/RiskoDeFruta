import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import {CharacterVisual} from '../src/animation/CharacterVisual';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';

it('uses the recorded fall only for prolonged falls, preserves bone lengths and exits on landing',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine),visual=new CharacterVisual(scene,()=>{});
 try{
  const asset=await ImportMeshAsync(new Uint8Array(readFileSync('public/models/gunslinger.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
  const internals=visual as unknown as {clips:Map<string,AnimationGroup>;machine:{state:string}};
  for(const group of asset.animationGroups){group.stop();internals.clips.set(group.name,group);}
  for(const mesh of asset.meshes)if(!mesh.parent)mesh.parent=visual.root;
  visual.ready=true;
  for(const name of ['RecordedFall','RecordedHit']){
   const clip=internals.clips.get(name)!;expect(clip).toBeDefined();
   expect(clip.targetedAnimations.filter(t=>t.animation.targetProperty==='rotationQuaternion')).toHaveLength(24);
   expect(clip.targetedAnimations.some(t=>t.animation.targetProperty==='scaling')).toBe(false);
   expect(clip.targetedAnimations.filter(t=>t.animation.targetProperty==='position').every(t=>t.target.name==='Hips')).toBe(true);
  }
  const player=new PlayerMotor(new CollisionWorld(),new EventBus(),{x:0,y:20,z:0});
  player.grounded=false;player.velocity.y=-10;
  for(let i=0;i<30;i++)visual.update(player,1,1/60,false);
  expect(internals.machine.state).toBe('JumpFall');
  const baseline=new Map(asset.transformNodes.map(n=>[n.name,{scale:n.scaling.clone(),position:n.position.clone()}]));
  for(let i=0;i<120;i++)visual.update(player,1,1/60,false);
  expect(internals.machine.state).toBe('RecordedFall');
  for(const n of asset.transformNodes){
   expect(n.scaling.equalsWithEpsilon(baseline.get(n.name)!.scale,.0001)).toBe(true);
   if(n.name!=='Hips')expect(n.position.equalsWithEpsilon(baseline.get(n.name)!.position,.0001)).toBe(true);
   if(n.rotationQuaternion)expect(n.rotationQuaternion.asArray().every(Number.isFinite)).toBe(true);
  }
  player.grounded=true;player.velocity.y=0;
  for(let i=0;i<40;i++)visual.update(player,1,1/60,false);
  expect(internals.machine.state).toBe('Idle');
  visual.reactToHit();for(let i=0;i<60;i++)visual.update(player,1,1/60,false);
  expect(internals.machine.state).toBe('Idle');
  visual.resetAttempt();player.grounded=false;player.velocity.y=-10;visual.update(player,1,1/60,false);
  expect(internals.machine.state).toBe('JumpFall');
 }finally{visual.dispose();scene.dispose();engine.dispose();}
});

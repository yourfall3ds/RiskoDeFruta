import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {CharacterVisual} from '../src/animation/CharacterVisual';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {MeteorArrival} from '../src/player/MeteorArrival';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
it('plays authored recovery on the real rig with hands supporting the inverted body',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine),visual=new CharacterVisual(scene,()=>{});
 try{
  const imported=await ImportMeshAsync(new Uint8Array(readFileSync('public/models/gunslinger.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
  const clips=(visual as unknown as {clips:Map<string,AnimationGroup>}).clips;
  for(const group of imported.animationGroups){group.stop();clips.set(group.name,group);}
  for(const mesh of imported.meshes)if(!mesh.parent)mesh.parent=visual.root;
  const weaponMeshes=[];
  for(const side of ['Left','Right']){const gun=await ImportMeshAsync(new Uint8Array(readFileSync('public/models/pistol.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});const grip=imported.transformNodes.find(n=>n.name===side+'WeaponGrip')!;for(const mesh of gun.meshes)if(!mesh.parent)mesh.parent=grip;weaponMeshes.push(...gun.meshes);}
  visual.ready=true;const player=new PlayerMotor(new CollisionWorld(),new EventBus(),{x:0,y:0,z:0});
  const arrival=new MeteorArrival();arrival.start();arrival.elapsed=4.8;
  visual.arrivalPose={height:arrival.height,recovery:arrival.recovery,dive:arrival.dive,rootLift:arrival.rootLift};
  visual.update(player,1,.2,false);
  for(const side of ['Left','Right']){const hand=imported.transformNodes.find(n=>n.name===side+'Hand')!;hand.computeWorldMatrix(true);expect(hand.getAbsolutePosition().y).toBeGreaterThan(.045);expect(hand.getAbsolutePosition().y).toBeLessThan(.25);}
  const head=imported.transformNodes.find(n=>n.name==='Head')!;head.computeWorldMatrix(true);expect(head.getAbsolutePosition().y).toBeLessThan(.55);
  // Sample between the 60 Hz authored keys, using the fully deformed surface.
  const point=new Vector3();
  for(let frame=0;frame<=240;frame++){
   arrival.elapsed=4+frame/120;visual.arrivalPose={height:0,recovery:arrival.recovery,dive:arrival.dive,rootLift:arrival.rootLift};visual.update(player,1,.2,false);
   for(const node of imported.transformNodes)node.computeWorldMatrix(true);
   for(const skeleton of imported.skeletons)skeleton.prepare(true);
   let minimum=Infinity;
   for(const mesh of [...imported.meshes,...weaponMeshes]){const vertices=mesh.getPositionData(true,true);if(!vertices)continue;const matrix=mesh.computeWorldMatrix(true);for(let i=0;i<vertices.length;i+=3){Vector3.TransformCoordinatesFromFloatsToRef(vertices[i]!,vertices[i+1]!,vertices[i+2]!,matrix,point);minimum=Math.min(minimum,point.y);}}
   expect(minimum,`surface at recovery ${frame/240}`).toBeGreaterThan(-.008);
  }
  arrival.elapsed=6;visual.arrivalPose={height:0,recovery:1,dive:arrival.dive,rootLift:arrival.rootLift};visual.update(player,1,.2,false);head.computeWorldMatrix(true);expect(head.getAbsolutePosition().y).toBeGreaterThan(1.3);
  visual.arrivalPose=undefined;visual.update(player,1,.2,false);expect(visual.root.rotation.x).toBe(0);
 }finally{visual.dispose();scene.dispose();engine.dispose();}
});

import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import {CharacterVisual,type CharacterPose} from '../src/animation/CharacterVisual';

vi.mock('@babylonjs/core/Loading/sceneLoader',async importOriginal=>{
  const original=await importOriginal<typeof import('@babylonjs/core/Loading/sceneLoader')>();
  return {...original,ImportMeshAsync:(_source:unknown,scene:Scene)=>original.ImportMeshAsync(
    new Uint8Array(readFileSync('public/models/gunslinger.glb')),scene,
    {pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}})};
});

describe('rifle firing overrides the running carry pose',()=>{
  it('points the real hand socket at the aim on the first shot and throughout sprinting, also on the planet',async()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    const visual=new CharacterVisual(scene,()=>{});
    const player:CharacterPose={position:{x:0,y:0,z:0},previous:{x:0,y:0,z:0},velocity:{x:0,y:0,z:8},yaw:0,
      grounded:true,sprinting:true,bumpRemaining:0,wallSliding:false,dodgeRemaining:0,dodgeYaw:0,backflipProgress:-1,jumpMultiplier:1};
    try{
      await visual.load();expect(visual.ready).toBe(true);visual.rifleEquipped=true;
      const frame=new TransformNode('planet-frame',scene);visual.root.parent=frame;
      for(const rotation of [Quaternion.Identity(),Quaternion.RotationAxis(Vector3.Forward(),Math.PI/2)]){
        frame.rotationQuaternion=rotation;frame.computeWorldMatrix(true);
        visual.rifleFiring=false;
        for(let i=0;i<45;i++){visual.update(player,1,1/60,false);visual.poseRifleGrip();}
        for(const local of [new Vector3(0,0,1),new Vector3(.6,.3,.8).normalize(),new Vector3(-.4,-.3,.8).normalize()]){
          const target=Vector3.TransformNormal(local,frame.getWorldMatrix()).normalize();
          visual.rifleFiring=true;visual.fireRifle();
          for(let tick=0;tick<18;tick++){
            visual.update(player,1,1/60,false,false,0,0,target);visual.poseRifleGrip();
            const barrel=Vector3.TransformNormal(Vector3.Forward(),visual.grips[0]!.computeWorldMatrix(true)).normalize();
            expect(Vector3.Dot(barrel,target),`running aim frame ${tick}`).toBeGreaterThan(.995);
          }
        }
      }
    }finally{visual.dispose();scene.dispose();engine.dispose();}
  });
});

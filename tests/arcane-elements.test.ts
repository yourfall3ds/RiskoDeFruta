import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {SkillAura,ritualPhase} from '../src/vfx/SkillAura';
import {SkillTimeline,SKILL_CUES} from '../src/combat/SkillTimeline';
import {ElementalEffects,ELEMENTS} from '../src/vfx/ElementalEffects';
import type {DualPistols} from '../src/combat/DualPistols';
it('samples Blender ritual on the ground, keeps anchors fixed and clears everything at vocal end',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine),aura=new SkillAura(scene);try{
  await aura.load(()=>LoadAssetContainerAsync(new Uint8Array(readFileSync('public/models/arcane-skill-ritual.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}}));expect(aura.error).toBe('');expect(aura.ready).toBe(true);
  const weapons={muzzlePose:(side:number)=>({position:new Vector3(side?1:-1,2,0),direction:Vector3.Forward()})} as DualPistols,t=new SkillTimeline();t.start(2);const origin=new Vector3(0,4,0);
  t.elapsed=.3;aura.update(t,origin,weapons);const ground=scene.getTransformNodeByName('GroundSigilRoot')!;const runes=scene.getMeshByName('Ground_Runewheel')!;runes.computeWorldMatrix(true);const early=runes.getBoundingInfo().boundingBox.extendSizeWorld.length();
  t.elapsed=1.15;aura.update(t,origin,weapons);runes.computeWorldMatrix(true);const bounds=runes.getBoundingInfo().boundingBox;expect(bounds.extendSizeWorld.length()).toBeGreaterThan(early);expect(bounds.maximumWorld.y-bounds.minimumWorld.y).toBeLessThan(.01);expect(bounds.centerWorld.y).toBeCloseTo(4.07,1);expect(bounds.extendSizeWorld.length()).toBeLessThan(2.5);
  t.update(1.4,()=>{});aura.update(t,new Vector3(4,8,2),weapons);expect(ground.position.x).toBe(0);expect(ground.position.y).toBeCloseTo(4.035);
  t.update(SKILL_CUES[2].voiceEnd,()=>{});aura.update(t,origin,weapons);expect(ground.isEnabled()).toBe(false);expect(scene.lights.every(l=>l.intensity===0)).toBe(true);
 }finally{aura.dispose();scene.dispose();engine.dispose();}
});
it('maps exactly between the authored preparation and release phases',()=>{expect(ritualPhase({preparing:true,progress:1,actionProgress:0})).toBe(.5);expect(ritualPhase({preparing:false,progress:1,actionProgress:0})).toBe(.5);expect(ritualPhase({preparing:false,progress:1,actionProgress:1})).toBe(1);});
it('six elemental bursts stay within a fixed pool and release all particles',()=>{const engine=new NullEngine(),scene=new Scene(engine),effects=new ElementalEffects(scene);try{const before=scene.meshes.length;for(let i=0;i<80;i++)effects.emit(ELEMENTS[i%6]!,Vector3.Zero());expect(effects.activeCount).toBe(8);expect(scene.meshes.length).toBe(before);effects.update(3);expect(effects.activeCount).toBe(0);effects.emit('water',Vector3.Zero());effects.clear();expect(effects.activeCount).toBe(0);expect(scene.lights.every(l=>l.intensity===0)).toBe(true);}finally{effects.dispose();scene.dispose();engine.dispose();}});

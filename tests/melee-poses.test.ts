import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {MELEE_CLIPS,meleeClipProgress} from '../src/animation/MeleeClips';
import {MELEE_TUNING} from '../src/player/PlayerTuning';
import {UnarmedCombat} from '../src/combat/UnarmedCombat';
const manifest=JSON.parse(readFileSync('docs/combo-clip-manifest.json','utf8'));
const bytes=readFileSync('public/models/gunslinger.glb');
const gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
describe('Blender unarmed combo',()=>{
 it('ships all six full-body clips and keeps damage timing aligned with authored contacts',()=>{
  expect(MELEE_TUNING.steps).toHaveLength(6);
  for(const step of MELEE_TUNING.steps){
   const spec=MELEE_CLIPS[step.id]!,authored=manifest.clips.find((c:{id:string})=>c.id===step.id);
   expect(authored).toMatchObject({clip:spec.clip,frames:spec.frames,contactFrame:spec.contactFrame,windup:step.windup,active:step.active,recover:step.recover});
   const clip=gltf.animations.find((a:{name:string})=>a.name===spec.clip);
   const bones=new Set(clip.channels.map((c:{target:{node:number}})=>gltf.nodes[c.target.node].name));
   for(const bone of ['Hips','Spine','RightArm','LeftArm','RightUpLeg','LeftUpLeg'])expect(bones.has(bone)).toBe(true);
   expect(meleeClipProgress(step.id,'active',0)).toBeCloseTo((spec.contactFrame-1)/(spec.frames-1));
   expect(meleeClipProgress(step.id,'recover',1)).toBe(1);
  }
 });
 it.each([1,2,4])('keeps the same contact frame at attack speed %s and hits each target only once',rate=>{
  const combat=new UnarmedCombat();combat.armed=false;combat.rateMultiplier=rate;
  for(let index=0;index<6;index++){
   combat.strike();
   while(combat.phase==='windup')combat.update(1/600);
   expect(combat.phase).toBe('active');
   const spec=MELEE_CLIPS[combat.step.id]!;
   const contact=meleeClipProgress(combat.step.id,combat.phase,combat.phaseProgress)*(spec.frames-1)+1;
   expect(Math.abs(contact-spec.contactFrame)).toBeLessThan(1);
   expect(combat.canHit(42)).toBe(true);combat.registerHit(42);expect(combat.canHit(42)).toBe(false);
   while(combat.busy)combat.update(1/600);
  }
  expect(combat.strikes).toBe(6);expect(combat.toggle()).toBe(true);expect(combat.armed).toBe(true);
 });
});

import {readGlb,values} from './glb-tools.mjs';
import {deepStrictEqual,ok} from 'node:assert';
import {writeFileSync} from 'node:fs';
const before=readGlb('art/processed/gunslinger-before-arrival.glb'),after=readGlb('art/processed/gunslinger-arrival-candidate.glb');
for(const key of ['meshes','materials','textures','images','skins','nodes'])deepStrictEqual(after.json[key],before.json[key],key);
for(const clip of before.json.animations)deepStrictEqual(after.json.animations.find(a=>a.name===clip.name),clip,clip.name);
ok(after.binary.subarray(0,before.binary.length).equals(before.binary));
for(const [name,duration]of [['ArrivalDive',1],['ArrivalRecovery',2]]){const clip=after.json.animations.find(a=>a.name===name);ok(clip);for(const s of clip.samplers){ok(Math.abs(values(after,s.input).at(-1)[0]-duration)<1e-5);for(const row of values(after,s.output))ok(row.every(Number.isFinite));}}
writeFileSync('docs/arrival-animation-audit.json',JSON.stringify({status:'candidate-only',preservedGeometryMaterialsRig:true,preservedExistingClips:before.json.animations.length,clips:['ArrivalDive','ArrivalRecovery'],finiteKeys:true},null,2));console.log('Candidate preserves original mesh, texture, rig and existing clips; finite animation keys verified.');

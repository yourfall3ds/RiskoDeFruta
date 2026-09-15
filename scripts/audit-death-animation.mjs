import {readGlb,values} from './glb-tools.mjs';
import {deepStrictEqual,ok} from 'node:assert';
import {writeFileSync,readFileSync} from 'node:fs';
const before=readGlb('art/processed/gunslinger-before-death.glb'),after=readGlb('public/models/gunslinger.glb');
for(const field of ['meshes','materials','textures','images','skins','nodes'])deepStrictEqual(after.json[field],before.json[field],field);
for(const animation of before.json.animations)deepStrictEqual(after.json.animations.find(a=>a.name===animation.name),animation,animation.name);
ok(after.binary.subarray(0,before.binary.length).equals(before.binary));
const death=after.json.animations.find(a=>a.name==='FinalDeath');ok(death);
for(const sampler of death.samplers){const times=values(after,sampler.input).flat();ok(Math.abs(times.at(-1)-2.8)<.0001);for(const row of values(after,sampler.output))ok(row.every(Number.isFinite));}
writeFileSync('docs/death-animation-audit.json',JSON.stringify({preservedGeometryMaterialsRig:true,preservedExistingClips:before.json.animations.length,clip:death.name,seconds:2.8,finiteKeys:true},null,2));
console.log('Death clip audited; original geometry, materials, rig and existing clips preserved.');

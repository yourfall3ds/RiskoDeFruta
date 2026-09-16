/** Retire stretched open coastal scans; closed solid-island-geology.glb already supplies the cliffs.
 * Run: npx tsx scripts/plan-initial-rocks.mjs
 */
import fs from 'node:fs';
import {readGlb} from './glb-tools.mjs';
import {collisionFingerprint} from '../src/world/terrain/InitialRocks.ts';
const source='public/models/farm-world.glb';
const glb=readGlb(source).json;
const mesh=JSON.parse(fs.readFileSync('public/models/world-collision-mesh.json','utf8'));
const bake=JSON.parse(fs.readFileSync('docs/collision-bake.json','utf8'));
const solid=JSON.parse(fs.readFileSync('docs/solid-geology.json','utf8'));
if(solid.length!==10||solid.some(s=>s.nonManifoldEdges!==0))throw Error('Missing closed replacement geology');
let offset=0;const ranges=new Map();
for(const [name,triangles] of Object.entries(bake.sources)){ranges.set(name,{firstTriangle:offset,triangles});offset+=triangles;}
if(offset!==mesh.indices.length/3)throw Error('Stale collision bake');
const offenders=[],visualOnly=[];
for(const node of glb.nodes){
 if(node.mesh===undefined||!/^coast_land(?: dressed|_rocks_02)/.test(node.name??''))continue;
 const range=ranges.get(node.name);
 if(range)offenders.push({name:node.name,box:{x:0,y:0,z:0,hx:0,hy:0,hz:0,rotation:0},...range});
 else visualOnly.push(node.name);
}
const plan={source:{vertices:mesh.positions.length/3,triangles:offset,checksum:collisionFingerprint(mesh.positions,mesh.indices)},
 provenance:{source,script:'scripts/plan-initial-rocks.mjs',replacement:'public/models/solid-island-geology.glb',
 cause:'Open, shallow coastal ground scans were stretched vertically and overlapped around island rims. Their exposed boundaries became spikes and sheets.',
 note:'Remove exact named render nodes and baked triangle ranges. Keep the existing closed island geology and its matching collision; do not rebuild skirts from the same open scan.'},
 offenders,visualOnly,replacements:[]};
fs.writeFileSync('public/models/initial-rock-fix.json',JSON.stringify(plan));
console.log('Retired',offenders.length,'collision instances and',visualOnly.length,'visual-only instances; keeping',solid.length,'closed island bodies.');

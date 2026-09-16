/** Transfer selected Meshy 24-joint recordings by bone name, preserving the player's bone lengths.
 * Source scales, meshes, materials and root translation are never copied.
 * Run without --apply to produce an offline visual review candidate first.
 */
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {readGlb,writeGlb,values,append} from './glb-tools.mjs';
const root='C:/Users/darck/transformice/assets/animations';
const targetPath='public/models/gunslinger.glb',backup='art/processed/gunslinger-before-transformice.glb';
const selections=[['RecordedFall','extras/falling.glb'],['RecordedHit','extras/hit_face.glb']];
mkdirSync('art/processed',{recursive:true});
if(!existsSync(backup))copyFileSync(targetPath,backup);
const target=readGlb(backup),joints=new Map(target.json.skins[0].joints.map(i=>[target.json.nodes[i].name,i]));
target.json.animations=target.json.animations.filter(a=>!selections.some(([name])=>name===a.name));
const parentNames=g=>{const p=new Map();g.json.nodes.forEach(n=>n.children?.forEach(c=>p.set(g.json.nodes[c].name,n.name)));return p;};
const targetParents=parentNames(target),report=[];
// Inventory every animation GLB; no meshes from the source game enter the runtime.
const inventory=[];
function scan(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory())scan(p);else if(entry.name.endsWith('.glb')){
 const g=readGlb(p),names=g.json.skins?.[0]?.joints.map(i=>g.json.nodes[i].name)??[];
 inventory.push({file:relative(root,p).replaceAll('\\','/'),joints:names.length,matchingNames:[...joints.keys()].every(n=>names.includes(n)),clips:g.json.animations?.map(a=>a.name)??[]});
}}}scan(root);
for(const [name,file] of selections){
 const source=readGlb(join(root,file)),sourceParents=parentNames(source),a=source.json.animations[0];
 for(const bone of joints.keys())if(bone!=='Hips'&&sourceParents.get(bone)!==targetParents.get(bone))throw Error(`Different parent for ${bone}`);
 const out={name,channels:[],samplers:[]};let channels=0;
 for(const c of a.channels){
  const bone=source.json.nodes[c.target.node].name,node=joints.get(bone);
  if(node===undefined||c.target.path!=='rotation')continue;
  const s=a.samplers[c.sampler];if(s.interpolation&&s.interpolation!=='LINEAR')throw Error('Unsupported interpolation');
  const times=values(source,s.input),rows=values(source,s.output);let previous;
  for(const row of rows){const length=Math.hypot(...row);if(!Number.isFinite(length)||length<.5)throw Error('Invalid rotation');for(let i=0;i<4;i++)row[i]/=length;
   if(previous&&row.reduce((v,x,i)=>v+x*previous[i],0)<0)for(let i=0;i<4;i++)row[i]*=-1;previous=row;}
  out.channels.push({target:{node,path:'rotation'},sampler:out.samplers.length});
  out.samplers.push({input:append(target,times,'SCALAR'),output:append(target,rows,'VEC4'),interpolation:'LINEAR'});channels++;
 }
 if(channels!==joints.size)throw Error(`Incomplete clip ${name}: ${channels}`);
 // Fix the target hip at its own origin; the character controller owns all falling motion.
 const node=joints.get('Hips');out.channels.push({target:{node,path:'translation'},sampler:out.samplers.length});
 const seconds=Math.max(...out.samplers.map(s=>values(target,s.input).at(-1)[0]));
 out.samplers.push({input:append(target,[[0],[seconds]],'SCALAR'),output:append(target,[target.json.nodes[node].translation,target.json.nodes[node].translation],'VEC3'),interpolation:'LINEAR'});
 target.json.animations.push(out);report.push({clip:name,source:file,seconds,rotationChannels:channels,rootMotion:false,scaleTracks:false});
}
const output=process.argv.includes('--apply')?targetPath:'art/processed/gunslinger-motion-review.glb';writeGlb(output,target);
writeFileSync('docs/transformice-animation-inventory.json',JSON.stringify({source:root,inventory,selected:report},null,2)+'\n');
console.log(JSON.stringify({inventoried:inventory.length,matching:inventory.filter(i=>i.matchingNames).length,output,selected:report}));

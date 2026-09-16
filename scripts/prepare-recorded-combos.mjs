/** Offline retarget candidate. Bone names, never joint indices, define the mapping. */
import {readGlb,writeGlb,values,append} from './glb-tools.mjs';
import {mkdirSync,writeFileSync,readdirSync} from 'node:fs';
const root='C:/Users/darck/transformice/assets/animations/';
const choices=[['SourcePunch','luta_sem_arma/punch_01.glb'],['SourceHook','luta_sem_arma/punch_02.glb'],['SourceUppercut','luta_sem_arma/punch_03.glb'],['SourceHighKick','luta_sem_arma/kick_01.glb'],['SourceRoundhouse','luta_sem_arma/kick_02.glb']];
choices.push(['SourceSpartan','Chutes-glb/'+readdirSync(root+'Chutes-glb').find(n=>n.includes('Spartan_Kick'))]);
const g=readGlb('public/models/gunslinger.glb'),joints=new Map(g.json.skins[0].joints.map(i=>[g.json.nodes[i].name,i]));
g.json.animations=g.json.animations.filter(a=>!a.name.startsWith('Source'));
const report=[];
for(const [name,file] of choices){
 const s=readGlb(root+file),a=s.json.animations[0],out={name,channels:[],samplers:[]};
 for(const c of a.channels){const bone=s.json.nodes[c.target.node].name,node=joints.get(bone);if(node===undefined||c.target.path!=='rotation')continue;
  const track=a.samplers[c.sampler],rows=values(s,track.output);let prev;
  for(const row of rows){const len=Math.hypot(...row);for(let i=0;i<4;i++)row[i]/=len;if(prev&&row.reduce((v,x,i)=>v+x*prev[i],0)<0)for(let i=0;i<4;i++)row[i]*=-1;prev=row;}
  out.channels.push({target:{node,path:'rotation'},sampler:out.samplers.length});out.samplers.push({input:append(g,values(s,track.input),'SCALAR'),output:append(g,rows,'VEC4'),interpolation:'LINEAR'});
 }
 const seconds=Math.max(...a.samplers.map(t=>values(s,t.input).at(-1)[0])),hip=joints.get('Hips'),p=g.json.nodes[hip].translation;
 out.channels.push({target:{node:hip,path:'translation'},sampler:out.samplers.length});out.samplers.push({input:append(g,[[0],[seconds]],'SCALAR'),output:append(g,[p,p],'VEC3'),interpolation:'LINEAR'});
 g.json.animations.push(out);report.push({name,file,seconds});
}
mkdirSync('art/processed',{recursive:true});writeGlb('art/processed/recorded-combos-candidate.glb',g);
writeFileSync('art/processed/recorded-combos-candidate.json',JSON.stringify(report,null,2));
console.log(report);

import {readGlb,writeGlb,append,values} from './glb-tools.mjs';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {bipedCombatClips} from './biped-combat-clips.mjs';
import {creatureClips} from './creature-clips.mjs';
const audit=[];
for(const species of ['eggplant','corn','carrot','tomato','watermelon']){
 const prefix=`assets/Meshy_AI_enemy_${species}_rigged_biped/Meshy_AI_enemy_${species}_rigged_biped/Meshy_AI_enemy_${species}_rigged_biped_`;
 const file=species==='tomato'?'assets/Tomatevoador-Meshy_AI_Character_output.glb':species==='watermelon'?'assets/melancia-Meshy_AI_Character_output (1).glb':prefix+'Character_output.glb';
 const base=readGlb(file),original=Buffer.from(base.binary),geometry=JSON.stringify(base.json.meshes),materials=JSON.stringify(base.json.materials);base.json.animations=[];
 const names=new Map(base.json.nodes.map((n,i)=>[n.name,i]));
 if(['eggplant','corn','carrot'].includes(species)){
  for(const [name,source] of Object.entries({Walk:'Walking',Run:'Running',Hit:'Hit_Reaction',Death:'Knock_Down_1'})){
   const input=readGlb(prefix+`Animation_${source}_withSkin.glb`),anim={name,channels:[],samplers:[]};
   for(const channel of input.json.animations[0].channels){const sampler=input.json.animations[0].samplers[channel.sampler],bone=input.json.nodes[channel.target.node].name,node=names.get(bone);if(node===undefined)continue;
    const output=values(input,sampler.output);if(channel.target.path==='translation'&&bone==='Hips')for(const row of output){row[0]=output[0][0];row[2]=output[0][2];}
    const index=anim.samplers.length;anim.samplers.push({input:append(base,values(input,sampler.input),'SCALAR'),output:append(base,output,input.json.accessors[sampler.output].type),interpolation:sampler.interpolation??'LINEAR'});anim.channels.push({sampler:index,target:{node,path:channel.target.path}});
   }base.json.animations.push(anim);
  }
  bipedCombatClips(base,species);
 }else{
  creatureClips(base,species);
 }
 if(JSON.stringify(base.json.meshes)!==geometry||JSON.stringify(base.json.materials)!==materials||!base.binary.subarray(0,original.length).equals(original))throw Error('Original data changed');
 writeGlb(`public/models/original-${species}.glb`,base);
 audit.push({species,source:file,output:`original-${species}.glb`,originalBinarySHA256:createHash('sha256').update(original).digest('hex'),originalBinaryBytes:original.length,geometryUnchanged:true,materialsUnchanged:true,embeddedTexturesUnchanged:true,animations:base.json.animations.map(a=>a.name)});
 console.log('PRESERVED',species,original.length);
}
writeFileSync('docs/original-enemy-integrity.json',JSON.stringify(audit,null,2));



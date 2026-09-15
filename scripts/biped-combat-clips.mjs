import {append,values} from './glb-tools.mjs';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector.js';
/** Species-specific combat channels, authored on the supplied skeleton, never on mesh data. */
export function bipedCombatClips(g,species){
 const j=g.json,walk=j.animations.find(a=>a.name==='Walk'),rest=j.nodes.map(n=>({rotation:n.rotation??[0,0,0,1],translation:n.translation??[0,0,0],scale:n.scale??[1,1,1]})),parents=new Map();j.nodes.forEach((n,i)=>n.children?.forEach(c=>parents.set(c,i)));
 for(const c of walk.channels)rest[c.target.node][c.target.path]=values(g,walk.samplers[c.sampler].output)[0];
 const world=i=>{const n=rest[i],m=Matrix.Compose(Vector3.FromArray(n.scale),Quaternion.FromArray(n.rotation),Vector3.FromArray(n.translation));return parents.has(i)?m.multiply(world(parents.get(i))):m;};
 const boneNodes=new Set(walk.channels.map(c=>c.target.node));
 for(const [name,seconds] of [['Idle',2.4],['Spawn',1.6],['Cast',.85],['Attack',.7]]){
  const times=Array.from({length:61},(_,i)=>[i/60*seconds]),time=append(g,times,'SCALAR'),anim={name,channels:[],samplers:[]};
  for(const node of boneNodes){const bone=j.nodes[node].name,base=Quaternion.FromArray(rest[node].rotation),inverse=Matrix.Invert(world(node));let aim=base;
   if(/^(Left|Right)Arm$/.test(bone)){
    const child=j.nodes[node].children?.find(i=>j.nodes[i].name?.endsWith('ForeArm'));
    if(child!==undefined){const parent=parents.has(node)?world(parents.get(node)):Matrix.Identity(),invParent=Matrix.Invert(parent),from=Vector3.TransformNormal(world(child).getTranslation().subtract(world(node).getTranslation()),invParent).normalize(),to=Vector3.TransformNormal(new Vector3(bone.startsWith('Left')?-.18:.18,species==='carrot'?-.22:-.04,1),invParent).normalize();aim=Quaternion.FromUnitVectorsToRef(from,to,Quaternion.Identity()).multiply(base).normalize();}
   }
   const output=times.map(([s])=>{const t=s/seconds,pulse=Math.sin(t*Math.PI),snap=Math.exp(-Math.pow((t-.22)*8,2)),spawn=name==='Spawn',cast=name==='Cast',attack=name==='Attack';let q=base.clone(),angle=0;
    if(/^(Left|Right)Arm$/.test(bone)){const weight=spawn?Math.sin(t*Math.PI)*.7:species==='corn'?(cast?.75+.25*t:attack?1:.55):cast?.35+.35*t:attack?.35+.65*snap:0;q=Quaternion.Slerp(base,aim,weight);}
    if(bone==='Spine'||bone==='Spine1')angle=spawn?-.26*(1-t):species==='corn'?(attack?-.075*snap:0):cast?-.12*pulse:attack?.18*snap:Math.sin(t*Math.PI*2)*.012;
    if(bone==='Head')angle=spawn?.14*pulse:cast?-.06*pulse:attack?-.08*snap:.01*Math.sin(t*Math.PI*2);
    if(/ForeArm$/.test(bone)){const sign=bone.startsWith('Left')?-1:1;angle=spawn?sign*.38*Math.sin(t*Math.PI*2)*(1-t):species==='corn'?(attack?sign*.075*snap:0):cast?sign*.16*pulse:attack?sign*.34*Math.sin(t*Math.PI*2):0;}
    if(species==='carrot'&&/Arm$/.test(bone)&&!bone.includes('Fore'))angle+=cast?-.22*pulse:attack?.24*snap:spawn?-.18*pulse:0;
    const axis=Vector3.TransformNormal(Vector3.Right(),inverse).normalize();return q.multiply(Quaternion.RotationAxis(axis,angle)).normalize().asArray();
   });
   anim.channels.push({sampler:anim.samplers.length,target:{node,path:'rotation'}});anim.samplers.push({input:time,output:append(g,output,'VEC4'),interpolation:'LINEAR'});
   if(bone==='Hips'){anim.channels.push({sampler:anim.samplers.length,target:{node,path:'translation'}});anim.samplers.push({input:time,output:append(g,times.map(()=>rest[node].translation),'VEC3'),interpolation:'LINEAR'});}
  }j.animations.push(anim);
 }
}

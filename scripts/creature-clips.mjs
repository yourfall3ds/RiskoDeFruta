import {append} from './glb-tools.mjs';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector.js';

/** Animate only existing joint channels. Vertex data, weights, UVs and materials remain original. */
export function creatureClips(g,species){
 const j=g.json,names=new Map(j.nodes.map((n,i)=>[n.name,i])),parents=new Map();j.nodes.forEach((n,i)=>n.children?.forEach(c=>parents.set(c,i)));
 const world=i=>{const n=j.nodes[i],m=Matrix.Compose(Vector3.FromArray(n.scale??[1,1,1]),Quaternion.FromArray(n.rotation??[0,0,0,1]),Vector3.FromArray(n.translation??[0,0,0]));return parents.has(i)?m.multiply(world(parents.get(i))):m;};
 const tomato=species==='tomato',bones=tomato?['Bone_000','Bone_001','Bone_003','Bone_025','Bone_027','Bone_029','Bone_031','Bone_033','Bone_035','Bone_037','Bone_039','Bone_042','Bone_041','Bone_040','Bone_045','Bone_044','Bone_043']:['Bone_000','Bone_001','Bone_003','Bone_016','Bone_015','Bone_019','Bone_018','Bone_022','Bone_021','Bone_025','Bone_024'];
 for(const [name,seconds] of [['Spawn',1.6],['Idle',2.4],['Walk',1.1],['Run',.8],['Fly',.75],['Cast',1.1],['Attack',.7],['Spit',.7],['Bite',.65],['Roll',.85],['Hit',.4],['Death',1.2]]){
  const anim={name,channels:[],samplers:[]},times=Array.from({length:49},(_,i)=>[i/48*seconds]),time=append(g,times,'SCALAR');
  for(const bone of bones){const node=names.get(bone);if(node===undefined)continue;const rest=Quaternion.FromArray(j.nodes[node].rotation??[0,0,0,1]),inverse=Matrix.Invert(world(node));
   const wing=/Bone_04[012345]/.test(bone),axis=Vector3.TransformNormal(wing?Vector3.Forward():Vector3.Right(),inverse).normalize();
   const rotations=times.map(([s])=>{
    const t=s/seconds,wave=Math.sin(t*2*Math.PI),pulse=Math.sin(t*Math.PI),attack=['Attack','Spit','Bite'].includes(name);let angle=0;
    if(tomato){
     if(wing){const left=['Bone_042','Bone_041','Bone_040'].includes(bone),root=bone==='Bone_042'||bone==='Bone_045';angle=(left?1:-1)*(root?.34:.15)*Math.sin(t*Math.PI*2+(root?0:-.65));if(name==='Death')angle*=1-t;}
     else if(bone==='Bone_000')angle=.025*wave;
     else if(bone==='Bone_001')angle=name==='Cast'?-.12*pulse:attack?.14*pulse:.025*wave;
     else if(bone==='Bone_003'||/Bone_0(25|27|29|31|33|35|37|39)/.test(bone))angle=name==='Cast'?.22*pulse:attack?.38*pulse:0;
    }else{
     const upper=['Bone_016','Bone_019','Bone_022','Bone_025'].includes(bone),lower=['Bone_015','Bone_018','Bone_021','Bone_024'].includes(bone),diagonal=['Bone_016','Bone_025','Bone_015','Bone_024'].includes(bone)?0:Math.PI;
     if(name==='Walk'||name==='Run'){if(upper)angle=.42*Math.sin(t*Math.PI*2+diagonal);if(lower)angle=.32*Math.max(0,Math.sin(t*Math.PI*2+diagonal-.4));if(bone==='Bone_001')angle=.035*Math.sin(t*Math.PI*4);}
     else if(name==='Roll'&&(upper||lower))angle=upper?.55:-.35;
     else if(name==='Idle'&&bone==='Bone_001')angle=.014*wave;
     if(bone==='Bone_003')angle=name==='Cast'?.3*pulse:name==='Bite'?.62*pulse:attack?.42*pulse:0;
     if(bone==='Bone_001'&&attack)angle=-.1*pulse;
    }
    if(name==='Spawn'&&!wing)angle+=(bone==='Bone_001'?-.2:bone==='Bone_003'?.12:.18)*Math.sin(t*Math.PI)*(1-t);
    if(name==='Hit'&&!wing)angle=-.12*pulse;if(name==='Death'&&!wing)angle=0;
    return rest.multiply(Quaternion.RotationAxis(axis,angle)).normalize().asArray();
   });
   anim.channels.push({sampler:anim.samplers.length,target:{node,path:'rotation'}});anim.samplers.push({input:time,output:append(g,rotations,'VEC4'),interpolation:'LINEAR'});
  }j.animations.push(anim);
 }
}

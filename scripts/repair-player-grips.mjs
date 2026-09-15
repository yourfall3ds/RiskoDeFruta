import {readGlb,writeGlb,values,append} from './glb-tools.mjs';
import {existsSync,copyFileSync,writeFileSync} from 'node:fs';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector.js';
const backup='art/processed/gunslinger-before-grip-repair.glb';if(!existsSync(backup))copyFileSync('public/models/gunslinger.glb',backup);
const g=readGlb(backup),j=g.json,parents=new Map();j.nodes.forEach((n,i)=>n.children?.forEach(c=>parents.set(c,i)));
// Correct the authored combat forearm pronation; retain the source locomotion poses.
for(const anim of j.animations)if(['Aim','Charge','Release','Fire_R','Fire_L','JumpRise','JumpFall','Backflip'].includes(anim.name)){
 for(const c of anim.channels)if(j.nodes[c.target.node].name==='RightForeArm'&&c.target.path==='rotation'){
  const sampler=anim.samplers[c.sampler];sampler.output=append(g,values(g,sampler.output).map(q=>Quaternion.FromArray(q).multiply(Quaternion.RotationAxis(Vector3.Up(),Math.PI)).asArray()),'VEC4');
 }
}
const pose=structuredClone(j.nodes),aim=j.animations.find(a=>a.name==='Aim');for(const c of aim.channels)pose[c.target.node][c.target.path]=values(g,aim.samplers[c.sampler].output)[0];
function world(i){const n=pose[i],m=Matrix.Compose(Vector3.FromArray(n.scale??[1,1,1]),Quaternion.FromArray(n.rotation??[0,0,0,1]),Vector3.FromArray(n.translation??[0,0,0]));return parents.has(i)?m.multiply(world(parents.get(i))):m;}
const prim=j.meshes[0].primitives[0],positions=values(g,prim.attributes.POSITION),weights=values(g,prim.attributes.WEIGHTS_0),joints=values(g,prim.attributes.JOINTS_0),skin=j.skins[0],bind=values(g,skin.inverseBindMatrices),report=[];
for(const side of ['Right','Left']){
 const hand=j.nodes.findIndex(n=>n.name===side+'Hand'),joint=skin.joints.indexOf(hand),points=[];
 positions.forEach((p,i)=>{let weight=0;for(let k=0;k<4;k++)if(joints[i][k]===joint)weight+=weights[i][k];if(weight>.8)points.push(Vector3.TransformCoordinates(Vector3.FromArray(p),Matrix.FromArray(bind[joint])));});
 const lo=points.reduce((a,p)=>Vector3.Minimize(a,p),new Vector3(Infinity,Infinity,Infinity)),hi=points.reduce((a,p)=>Vector3.Maximize(a,p),new Vector3(-Infinity,-Infinity,-Infinity)),center=lo.add(hi).scale(.5);
 const matrix=world(hand),scale=Vector3.Zero(),rotation=new Quaternion();matrix.decompose(scale,rotation);
 const grip=j.nodes.find(n=>n.name===side+'WeaponGrip');grip.translation=center.asArray();grip.rotation=rotation.conjugate().normalize().asArray();grip.scale=scale.asArray().map(x=>1/x);delete grip.matrix;
 const socket=Vector3.TransformCoordinates(center,matrix),wrist=matrix.getTranslation();if(Vector3.Distance(socket,wrist)>.25)throw Error('Grip outside glove');
 report.push({side,wrist:wrist.asArray(),socket:socket.asArray(),distance:Vector3.Distance(socket,wrist),local:center.asArray(),unitScale:grip.scale});
}
const jumpSource=readGlb('assets/Meshy_AI_gunslinger_v2_rigged_biped/Meshy_AI_gunslinger_v2_rigged_biped/Meshy_AI_gunslinger_v2_rigged_biped_Animation_Regular_Jump_withSkin.glb');
const jump={name:'Jump',channels:[],samplers:[]};
for(const c of jumpSource.json.animations[0].channels){const name=jumpSource.json.nodes[c.target.node].name,node=j.nodes.findIndex(n=>n.name===name);if(node<0)continue;const a=jumpSource.json.animations[0].samplers[c.sampler],rows=values(jumpSource,a.output);if(name==='Hips'&&c.target.path==='translation'){const first=[...rows[0]];for(const row of rows)for(let k=0;k<3;k++)row[k]=first[k];}jump.channels.push({sampler:jump.samplers.length,target:{node,path:c.target.path}});jump.samplers.push({input:append(g,values(jumpSource,a.input),'SCALAR'),output:append(g,rows,jumpSource.json.accessors[a.output].type),interpolation:'LINEAR'});}j.animations.push(jump);
writeGlb('public/models/gunslinger.glb',g);writeFileSync('docs/grip-repair.json',JSON.stringify(report,null,2));console.log(report);

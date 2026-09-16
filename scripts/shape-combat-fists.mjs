/** Curl the existing glove fingers into a combat shape; preserve the original gun grip. */
import {readGlb,writeGlb,values,append} from './glb-tools.mjs';
import {Matrix,Vector3} from '@babylonjs/core/Maths/math.vector.js';
const g=readGlb('public/models/gunslinger.glb'),skin=g.json.skins[0];
const binds=values(g,skin.inverseBindMatrices),hands=skin.joints.map((n,i)=>({i,name:g.json.nodes[n].name})).filter(b=>b.name==='LeftHand'||b.name==='RightHand');
let changed=0;
for(const mesh of g.json.meshes){
 mesh.extras??={};mesh.extras.targetNames??=[];
 let slot=mesh.extras.targetNames.indexOf('CombatFists');
 if(slot<0){slot=mesh.extras.targetNames.length;mesh.extras.targetNames.push('CombatFists');}
 mesh.weights??=[];mesh.weights[slot]=0;
 for(const p of mesh.primitives){
  if(p.attributes.JOINTS_0===undefined)continue;
  const positions=values(g,p.attributes.POSITION),joints=values(g,p.attributes.JOINTS_0),weights=values(g,p.attributes.WEIGHTS_0),rows=positions.map(()=>[0,0,0]);
  const normals=p.attributes.NORMAL===undefined?undefined:values(g,p.attributes.NORMAL),normalRows=positions.map(()=>[0,0,0]);
  for(const hand of hands){
   const inverse=Matrix.FromArray(binds[hand.i]),forward=Matrix.Invert(inverse);
   positions.forEach((v,i)=>{
    const w=joints[i].reduce((sum,j,c)=>sum+(j===hand.i?weights[i][c]:0),0);if(w<.6)return;
    const original=Vector3.FromArray(v),local=Vector3.TransformCoordinates(original,inverse);
    const reach=local.y-8;if(reach<=0)return;
    const bend=Math.min(1,reach/12)*Math.PI*.92,radius=12/(Math.PI*.92);
    const shaped=local.clone();shaped.y=8+Math.sin(bend)*radius;shaped.z+=radius*(1-Math.cos(bend));
    const delta=Vector3.TransformCoordinates(shaped,forward).subtract(original).scale(Math.min(1,(w-.6)/.25));
    rows[i]=delta.asArray();changed++;
    if(normals){const before=Vector3.FromArray(normals[i]),n=Vector3.TransformNormal(before,inverse).normalize(),y=n.y,z=n.z;
     n.y=y*Math.cos(bend)-z*Math.sin(bend);n.z=y*Math.sin(bend)+z*Math.cos(bend);
     normalRows[i]=Vector3.TransformNormal(n,forward).normalize().subtract(before).scale(Math.min(1,(w-.6)/.25)).asArray();}
   });
  }
  p.targets??=[];p.targets[slot]={POSITION:append(g,rows,'VEC3'),...(normals?{NORMAL:append(g,normalRows,'VEC3')}:{})};
 }
}
const output=process.argv.includes('--apply')?'public/models/gunslinger.glb':'art/processed/gunslinger-fists-review.glb';
writeGlb(output,g);console.log({output,changed});

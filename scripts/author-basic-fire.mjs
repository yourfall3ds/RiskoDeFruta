import {readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {readGlb,writeGlb,append} from './glb-tools.mjs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import {Vector3,Quaternion,Matrix} from '@babylonjs/core/Maths/math.vector.js';
const backup='public/models/gunslinger.glb';
const g=readGlb(backup),engine=new NullEngine(),scene=new Scene(engine),model=await ImportMeshAsync(new Uint8Array(readFileSync(backup)),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
const nodes=new Map(model.transformNodes.map(n=>[n.name,n])),clips=new Map(model.animationGroups.map(a=>{a.stop();return[a.name,a];}));
function sample(name,t){const clip=clips.get(name);for(const track of clip.targetedAnimations){const v=track.animation.evaluate(clip.from+(clip.to-clip.from)*t);if(track.animation.targetProperty==='rotationQuaternion')track.target.rotationQuaternion=v.clone();else if(track.animation.targetProperty==='position')track.target.position.copyFrom(v);else if(track.animation.targetProperty==='scaling')track.target.scaling.copyFrom(v);}}
sample('Aim',0);for(const n of model.transformNodes)n.computeWorldMatrix(true);
const rest=new Map(model.transformNodes.map(n=>[n.name,{p:n.position.clone(),q:n.rotationQuaternion?.clone()??Quaternion.Identity(),s:n.scaling.clone()}]));
const feet=Object.fromEntries(['Left','Right'].map(side=>[side,{position:nodes.get(side+'Foot').getAbsolutePosition().clone(),toe:nodes.get(side+'ToeBase').getAbsolutePosition().subtract(nodes.get(side+'Foot').getAbsolutePosition())}]));
function reset(){for(const [name,n] of nodes){const r=rest.get(name);n.position.copyFrom(r.p);n.rotationQuaternion=r.q.clone();n.scaling.copyFrom(r.s);}for(const n of nodes.values())n.computeWorldMatrix(true);}
function rotate(joint,child,worldDirection){joint.computeWorldMatrix(true);child.computeWorldMatrix(true);const inv=Matrix.Invert(joint.parent.computeWorldMatrix(true)),from=Vector3.TransformNormal(child.getAbsolutePosition().subtract(joint.getAbsolutePosition()),inv).normalize(),to=Vector3.TransformNormal(worldDirection,inv).normalize();joint.rotationQuaternion=Quaternion.FromUnitVectorsToRef(from,to,Quaternion.Identity()).multiply(joint.rotationQuaternion).normalize();joint.computeWorldMatrix(true);child.computeWorldMatrix(true);}
function solveLeg(side,target){const upper=nodes.get(side+'UpLeg'),lower=nodes.get(side+'Leg'),foot=nodes.get(side+'Foot'),toe=nodes.get(side+'ToeBase');for(const n of [upper,lower,foot,toe])n.computeWorldMatrix(true);const hip=upper.getAbsolutePosition().clone(),a=Vector3.Distance(hip,lower.getAbsolutePosition()),b=Vector3.Distance(lower.getAbsolutePosition(),foot.getAbsolutePosition()),dir=target.subtract(hip),d=Math.max(Math.abs(a-b)+.001,Math.min(a+b-.002,dir.length()));dir.normalize();const along=(a*a-b*b+d*d)/(2*d),high=Math.sqrt(Math.max(0,a*a-along*along)),pole=new Vector3(0,-.1,1);pole.subtractInPlace(dir.scale(Vector3.Dot(pole,dir))).normalize();const knee=hip.add(dir.scale(along)).addInPlace(pole.scale(high));rotate(upper,lower,knee.subtract(hip));foot.computeWorldMatrix(true);rotate(lower,foot,hip.add(dir.scale(d)).subtract(lower.getAbsolutePosition()));toe.computeWorldMatrix(true);rotate(foot,toe,feet[side].toe);}
function worldShift(node,delta){node.position.addInPlace(Vector3.TransformNormal(delta,Matrix.Invert(node.parent.computeWorldMatrix(true))));node.computeWorldMatrix(true);}
function bend(name,axis,angle){const n=nodes.get(name);if(!n)return;const localAxis=Vector3.TransformNormal(axis,Matrix.Invert(n.computeWorldMatrix(true))).normalize();n.rotationQuaternion=n.rotationQuaternion.multiply(Quaternion.RotationAxis(localAxis,angle)).normalize();n.computeWorldMatrix(true);}
const audit=[];
for(const side of ['Right','Left']){const name=side==='Right'?'Fire_R':'Fire_L',sign=side==='Right'?1:-1,times=[],rotations=new Map();
 for(let f=0;f<=60;f++){const phase=f/60;reset();const kick=phase<.16?Math.sin(phase/.16*Math.PI/2):Math.exp(-(phase-.16)*4.5)*(1-phase)/.84;
  bend('Spine',Vector3.Up(),sign*.07*kick);bend('Spine1',Vector3.Right(),-.085*kick);bend('Head',Vector3.Right(),.045*kick);
  bend(side+'Shoulder',Vector3.Up(),sign*.055*kick);bend(side+'Arm',Vector3.Right(),-.16*kick);bend(side+'ForeArm',Vector3.Right(),-.12*kick);bend(side+'Hand',Vector3.Right(),-.065*kick);
  times.push([phase*.21]);for(const id of g.json.skins[0].joints){const n=nodes.get(g.json.nodes[id].name);if(n){const keys=rotations.get(id)??[];keys.push(n.rotationQuaternion.asArray());rotations.set(id,keys);}}
 }
 g.json.animations=g.json.animations.filter(a=>a.name!==name);const input=append(g,times,'SCALAR'),animation={name,channels:[],samplers:[]};for(const [id,keys]of rotations){animation.channels.push({sampler:animation.samplers.length,target:{node:id,path:'rotation'}});animation.samplers.push({input,output:append(g,keys,'VEC4'),interpolation:'LINEAR'});}g.json.animations.push(animation);audit.push({name,frames:61,duration:.21});
}
writeGlb('public/models/gunslinger.glb',g);writeFileSync('docs/basic-fire-animation-audit.json',JSON.stringify(audit,null,2));console.log(audit);scene.dispose();engine.dispose();

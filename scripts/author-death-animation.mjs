import {readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {readGlb,writeGlb,append} from './glb-tools.mjs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import {Vector3,Quaternion,Matrix} from '@babylonjs/core/Maths/math.vector.js';
const backup='art/processed/gunslinger-before-death.glb';if(!existsSync(backup))copyFileSync('public/models/gunslinger.glb',backup);
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

const name='FinalDeath',seconds=2.8,times=Array.from({length:169},(_,i)=>[i/60]),rotations=new Map(),translations=new Map();
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
for(let f=0;f<times.length;f++){
 const t=f/60;reset();const launch=smooth(t/.28),collapse=smooth((t-1.15)/.65),recoil=Math.exp(-t*4)*Math.sin(Math.min(1,t/.16)*Math.PI/2);
 worldShift(nodes.get('Hips'),new Vector3(0,-.55*collapse,0));
 bend('Hips',Vector3.Right(),.85*launch+.6*collapse);
 bend('Spine',Vector3.Right(),.22*recoil);bend('Head',Vector3.Right(),.24*launch-.12*collapse);
 for(const side of ['Left','Right']){
  const sign=side==='Left'?-1:1;
  rotate(nodes.get(side+'Arm'),nodes.get(side+'ForeArm'),new Vector3(sign*(.6+.2*launch),.25+.2*launch,.1-.25*collapse));
  bend(side+'ForeArm',Vector3.Right(),-.5*launch);
  bend(side+'UpLeg',Vector3.Right(),.35*launch*(1-collapse));
  bend(side+'Leg',Vector3.Right(),-.65*launch*(1-collapse));
 }
 for(const id of g.json.skins[0].joints){const n=nodes.get(g.json.nodes[id].name);if(!n)continue;const q=rotations.get(id)??[],p=translations.get(id)??[];q.push(n.rotationQuaternion.asArray());p.push(n.position.asArray());rotations.set(id,q);translations.set(id,p);}
}
const input=append(g,times,'SCALAR'),animation={name,channels:[],samplers:[]};
for(const [id,keys] of rotations){animation.channels.push({sampler:animation.samplers.length,target:{node:id,path:'rotation'}});animation.samplers.push({input,output:append(g,keys,'VEC4'),interpolation:'LINEAR'});if(g.json.nodes[id].name==='Hips'){animation.channels.push({sampler:animation.samplers.length,target:{node:id,path:'translation'}});animation.samplers.push({input,output:append(g,translations.get(id),'VEC3'),interpolation:'LINEAR'});}}
g.json.animations=g.json.animations.filter(a=>a.name!==name);g.json.animations.push(animation);writeGlb('public/models/gunslinger.glb',g);console.log({name,seconds,frames:times.length,clips:g.json.animations.length});scene.dispose();engine.dispose();

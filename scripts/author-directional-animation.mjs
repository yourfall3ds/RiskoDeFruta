import {readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {readGlb,writeGlb,append} from './glb-tools.mjs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import {Vector3,Quaternion,Matrix} from '@babylonjs/core/Maths/math.vector.js';
const backup='art/processed/gunslinger-before-directional.glb';if(!existsSync(backup))copyFileSync('public/models/gunslinger.glb',backup);
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
const authored=[['WalkBackward',1.1,0,-1],['StrafeLeft',1.1,-1,0],['StrafeRight',1.1,1,0],['RunBackward',.72,0,-1],['RunStrafeLeft',.72,-1,0],['RunStrafeRight',.72,1,0],['FanCast',1.05,0,0],['MortalCast',1.05,0,0],['PrepareFan',1.2,0,0],['PrepareMortal',1.2,0,0],['PrepareStorm',1.2,0,0],['ReloadCast',2.15,0,0]];
const audit=[];
for(const [name,seconds,dx,dz] of authored){
 const times=Array.from({length:61},(_,i)=>[i/60*seconds]),rotations=new Map(),translations=new Map();let maxFootError=0;
 for(let f=0;f<=60;f++){const phase=f/60;reset();const fan=name==='FanCast'||name==='MortalCast'||name==='ReloadCast'||name.startsWith('Prepare'),posePhase=name.startsWith('Prepare')?phase*.48:phase,run=name.startsWith('Run');if(!fan)sample(run?'Run':'Walk',phase);
  const hips=nodes.get('Hips');hips.position.copyFrom(rest.get('Hips').p);hips.rotationQuaternion=rest.get('Hips').q.clone();
  const pulse=fan?Math.sin(Math.PI*posePhase)**2:0;worldShift(hips,new Vector3(0,fan?(name==='ReloadCast'?-.105:-.28)*pulse:-.025*(1-Math.cos(phase*Math.PI*4)),0));
  if(name==='PrepareMortal')worldShift(hips,new Vector3(0,-.12*pulse,-.12*pulse));
  if(fan){bend('Spine',Vector3.Up(),-.38*Math.sin(posePhase*Math.PI*2));bend('Spine1',Vector3.Right(),.24*pulse);bend('Head',Vector3.Right(),-.12*pulse);for(const side of ['Left','Right']){const sign=side==='Left'?-1:1;const arm=nodes.get(side+'Arm'),fore=nodes.get(side+'ForeArm');rotate(arm,fore,new Vector3(sign*(name==='PrepareStorm'?-.32*pulse:.12+.72*Math.sin(Math.PI*posePhase)),name==='ReloadCast'?Math.sin(phase*Math.PI*3)*.9:name==='PrepareMortal'?.45*pulse:(side==='Left'?-.07:.23)*pulse,.9));bend(side+'ForeArm',Vector3.Up(),sign*.35*Math.sin(Math.PI*posePhase));}}
  for(const [side,offset] of [['Left',0],['Right',.5]]){const target=feet[side].position.clone();if(fan&&name!=='ReloadCast'){target.x+=(side==='Left'?-.16:.16)*pulse;target.z+=(side==='Left'?.22:-.25)*pulse;}if(!fan){const t=(phase+offset)%1,stance=.58,stride=run?.66:.4;let travel,lift;if(t<stance){travel=.5-t/stance;lift=0;}else{const s=(t-stance)/(1-stance);travel=-.5+(s*s*(3-2*s));lift=Math.sin(s*Math.PI)*(run?.20:.12);}target.x+=dx*travel*stride;target.z+=dz*travel*stride;if(dx)target.z+=(side==='Left'?-.025:.025)*Math.sin(phase*Math.PI*2);target.y+=lift;}
   solveLeg(side,target);maxFootError=Math.max(maxFootError,Vector3.Distance(nodes.get(side+'Foot').getAbsolutePosition(),target));
  }
  for(const id of g.json.skins[0].joints){const node=g.json.nodes[id],n=nodes.get(node.name);if(!n)continue;const qr=rotations.get(id)??[],pr=translations.get(id)??[];qr.push(n.rotationQuaternion.asArray());pr.push(n.position.asArray());rotations.set(id,qr);translations.set(id,pr);}
 }
 const input=append(g,times,'SCALAR'),animation={name,channels:[],samplers:[]};
 for(const [id,keys] of rotations){animation.channels.push({sampler:animation.samplers.length,target:{node:id,path:'rotation'}});animation.samplers.push({input,output:append(g,keys,'VEC4'),interpolation:'LINEAR'});if(g.json.nodes[id].name==='Hips'){animation.channels.push({sampler:animation.samplers.length,target:{node:id,path:'translation'}});animation.samplers.push({input,output:append(g,translations.get(id),'VEC3'),interpolation:'LINEAR'});}}
 g.json.animations.push(animation);audit.push({name,seconds,frames:61,maxFootError});
}
writeGlb('public/models/gunslinger.glb',g);writeFileSync('docs/directional-animation-audit.json',JSON.stringify(audit,null,2));console.log(audit);scene.dispose();engine.dispose();

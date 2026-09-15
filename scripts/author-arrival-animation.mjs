import {readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {readGlb,writeGlb,append} from './glb-tools.mjs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode.js';
import {Vector3,Quaternion,Matrix} from '@babylonjs/core/Maths/math.vector.js';
const backup='art/processed/gunslinger-before-arrival.glb';if(!existsSync(backup))copyFileSync('public/models/gunslinger.glb',backup);
const g=readGlb(backup),engine=new NullEngine(),scene=new Scene(engine),model=await ImportMeshAsync(new Uint8Array(readFileSync(backup)),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
const nodes=new Map(model.transformNodes.map(n=>[n.name,n])),clips=new Map(model.animationGroups.map(a=>{a.stop();return[a.name,a];}));
function sample(name,t){const clip=clips.get(name);for(const track of clip.targetedAnimations){const v=track.animation.evaluate(clip.from+(clip.to-clip.from)*t);if(track.animation.targetProperty==='rotationQuaternion')track.target.rotationQuaternion=v.clone();else if(track.animation.targetProperty==='position')track.target.position.copyFrom(v);else if(track.animation.targetProperty==='scaling')track.target.scaling.copyFrom(v);}}
sample('Aim',0);for(const n of model.transformNodes)n.computeWorldMatrix(true);
const rest=new Map(model.transformNodes.map(n=>[n.name,{p:n.position.clone(),q:n.rotationQuaternion?.clone()??Quaternion.Identity(),s:n.scaling.clone()}]));
const feet=Object.fromEntries(['Left','Right'].map(side=>[side,{position:nodes.get(side+'Foot').getAbsolutePosition().clone(),toe:nodes.get(side+'ToeBase').getAbsolutePosition().subtract(nodes.get(side+'Foot').getAbsolutePosition())}]));
function reset(){for(const [name,n] of nodes){const r=rest.get(name);n.position.copyFrom(r.p);n.rotationQuaternion=r.q.clone();n.scaling.copyFrom(r.s);}for(const n of nodes.values())n.computeWorldMatrix(true);}
function rotate(joint,child,worldDirection){joint.computeWorldMatrix(true);child.computeWorldMatrix(true);const inv=Matrix.Invert(joint.parent.computeWorldMatrix(true)),from=Vector3.TransformNormal(child.getAbsolutePosition().subtract(joint.getAbsolutePosition()),inv).normalize(),to=Vector3.TransformNormal(worldDirection,inv).normalize();joint.rotationQuaternion=Quaternion.FromUnitVectorsToRef(from,to,Quaternion.Identity()).multiply(joint.rotationQuaternion).normalize();joint.computeWorldMatrix(true);child.computeWorldMatrix(true);}
function solveLeg(side,target){const upper=nodes.get(side+'UpLeg'),lower=nodes.get(side+'Leg'),foot=nodes.get(side+'Foot'),toe=nodes.get(side+'ToeBase');for(const n of [upper,lower,foot,toe])n.computeWorldMatrix(true);const hip=upper.getAbsolutePosition().clone(),a=Vector3.Distance(hip,lower.getAbsolutePosition()),b=Vector3.Distance(lower.getAbsolutePosition(),foot.getAbsolutePosition()),dir=target.subtract(hip),d=Math.max(Math.abs(a-b)+.001,Math.min(a+b-.002,dir.length()));dir.normalize();const along=(a*a-b*b+d*d)/(2*d),high=Math.sqrt(Math.max(0,a*a-along*along)),pole=new Vector3(0,-.1,1);pole.subtractInPlace(dir.scale(Vector3.Dot(pole,dir))).normalize();const knee=hip.add(dir.scale(along)).addInPlace(pole.scale(high));rotate(upper,lower,knee.subtract(hip));foot.computeWorldMatrix(true);rotate(lower,foot,hip.add(dir.scale(d)).subtract(lower.getAbsolutePosition()));toe.computeWorldMatrix(true);rotate(foot,toe,feet[side].toe);}
function solveArm(side,target){
 const upper=nodes.get(side+'Arm'),lower=nodes.get(side+'ForeArm'),hand=nodes.get(side+'Hand');
 for(const n of [upper,lower,hand])n.computeWorldMatrix(true);
 const origin=upper.getAbsolutePosition().clone(),a=Vector3.Distance(origin,lower.getAbsolutePosition()),b=Vector3.Distance(lower.getAbsolutePosition(),hand.getAbsolutePosition()),dir=target.subtract(origin),d=Math.max(Math.abs(a-b)+.001,Math.min(a+b-.001,dir.length()));dir.normalize();
 const along=(a*a-b*b+d*d)/(2*d),height=Math.sqrt(Math.max(0,a*a-along*along)),pole=new Vector3(side==='Left'?-1:1,.1,-.35);pole.subtractInPlace(dir.scale(Vector3.Dot(pole,dir))).normalize();
 rotate(upper,lower,dir.scale(along).add(pole.scale(height)));hand.computeWorldMatrix(true);rotate(lower,hand,origin.add(dir.scale(d)).subtract(lower.getAbsolutePosition()));
}
function worldShift(node,delta){node.position.addInPlace(Vector3.TransformNormal(delta,Matrix.Invert(node.parent.computeWorldMatrix(true))));node.computeWorldMatrix(true);}
function bend(name,axis,angle){const n=nodes.get(name);if(!n)return;const localAxis=Vector3.TransformNormal(axis,Matrix.Invert(n.computeWorldMatrix(true))).normalize();n.rotationQuaternion=n.rotationQuaternion.multiply(Quaternion.RotationAxis(localAxis,angle)).normalize();n.computeWorldMatrix(true);}


const flight=new TransformNode('arrival-preview-root',scene);for(const mesh of model.meshes)if(!mesh.parent)mesh.parent=flight;
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const samplePose=(name,t)=>{reset();sample(name,t);return new Map([...nodes].map(([name,n])=>[name,{p:n.position.clone(),q:n.rotationQuaternion.clone()}]));};
const start=samplePose('Jump',.6),end=samplePose('Idle',0),report=[];
function pose(p){
 reset();const blend=smooth((p-.16)/.82),dive=1-smooth((p-.18)/.67);
 flight.rotation.x=Math.PI*dive;flight.position.y=Math.max(0,-Math.cos(Math.PI*dive))*1.7;flight.computeWorldMatrix(true);
 for(const [name,n]of nodes){const a=start.get(name),b=end.get(name);Vector3.LerpToRef(a.p,b.p,blend,n.position);Quaternion.SlerpToRef(a.q,b.q,blend,n.rotationQuaternion);}
 for(const n of nodes.values())n.computeWorldMatrix(true);
 const tuck=Math.sin(Math.PI*smooth((p-.08)/.78))**2;
 bend('Spine',Vector3.Right(),-.35*tuck);bend('Head',Vector3.Right(),-.18*tuck);
 for(const side of ['Left','Right']){const sign=side==='Left'?-1:1;
  bend(side+'UpLeg',Vector3.Right(),-.8*tuck);bend(side+'Leg',Vector3.Right(),1.1*tuck);
  const support=smooth((p-.18)/.18)*(1-smooth((p-.62)/.25));
  if(support>0){const upper=nodes.get(side+'Arm'),lower=nodes.get(side+'ForeArm');lower.computeWorldMatrix(true);const current=lower.getAbsolutePosition().subtract(upper.getAbsolutePosition()).normalize();rotate(upper,lower,Vector3.Lerp(current,new Vector3(sign*.32,-.9,.28).normalize(),support));bend(side+'ForeArm',Vector3.Right(),-.5*support);}
 }
 for(const n of nodes.values())n.computeWorldMatrix(true);
 // Keep supporting skeleton landmarks above ground while the body unfolds.
 const crouch=Math.sin(Math.PI*smooth((p-.38)/.6))**2;
 worldShift(nodes.get('Hips'),new Vector3(0,-.62*crouch,0));
 const plant=smooth((p-.44)/.26);
 if(plant>0)for(const side of ['Left','Right']){const foot=nodes.get(side+'Foot');foot.computeWorldMatrix(true);solveLeg(side,Vector3.Lerp(foot.getAbsolutePosition(),feet[side].position,plant));}
 const names=['Head','LeftHand','RightHand','LeftFoot','RightFoot','LeftToeBase','RightToeBase'];
 const lowest=Math.min(...names.map(name=>nodes.get(name).getAbsolutePosition().y-(name==='Head'?.23:.07)));
 const correction=-lowest;worldShift(nodes.get('Hips'),new Vector3(0,correction,0));
 for(const n of nodes.values())n.computeWorldMatrix(true);
 const handPlant=smooth((p-.22)/.16)*(1-smooth((p-.58)/.2));
 if(handPlant>0)for(const side of ['Left','Right']){
  const hand=nodes.get(side+'Hand');hand.computeWorldMatrix(true);
  const shoulder=nodes.get(side+'Arm');shoulder.computeWorldMatrix(true);const origin=shoulder.getAbsolutePosition();const target=new Vector3(origin.x+(side==='Left'?-.08:.08),.085,origin.z-.08);
  solveArm(side,Vector3.Lerp(hand.getAbsolutePosition(),target,handPlant));
 }
 for(const n of nodes.values())n.computeWorldMatrix(true);
 // Keep the pistols tangent to the ground while the knuckles support the body.
 const wristWeight=smooth((p-.02)/.1)*(1-smooth((p-.68)/.14));
 if(wristWeight>0)for(const side of ['Left','Right']){
  const hand=nodes.get(side+'Hand'),grip=nodes.get(side+'WeaponGrip');hand.computeWorldMatrix(true);grip.computeWorldMatrix(true);
  const inv=Matrix.Invert(hand.parent.computeWorldMatrix(true));
  const forward=Vector3.TransformNormal(Vector3.Forward(),grip.getWorldMatrix()).normalize();
  const desired=new Vector3(side==='Left'?-.2:.2,.12,1).normalize();
  const from=Vector3.TransformNormal(forward,inv).normalize(),to=Vector3.TransformNormal(Vector3.Lerp(forward,desired,wristWeight).normalize(),inv).normalize();
  hand.rotationQuaternion=Quaternion.FromUnitVectorsToRef(from,to,Quaternion.Identity()).multiply(hand.rotationQuaternion).normalize();hand.computeWorldMatrix(true);grip.computeWorldMatrix(true);
  const axis=Vector3.TransformNormal(Vector3.Forward(),grip.getWorldMatrix()).normalize(),up=Vector3.TransformNormal(Vector3.Up(),grip.getWorldMatrix()).normalize(),worldUp=Vector3.Up();worldUp.subtractInPlace(axis.scale(Vector3.Dot(worldUp,axis))).normalize();up.subtractInPlace(axis.scale(Vector3.Dot(up,axis))).normalize();
  const twist=Math.atan2(Vector3.Dot(axis,Vector3.Cross(up,worldUp)),Vector3.Dot(up,worldUp))*wristWeight;
  const targetUp=up.applyRotationQuaternion(Quaternion.RotationAxis(axis,twist));
  hand.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.TransformNormal(up,inv).normalize(),Vector3.TransformNormal(targetUp,inv).normalize(),Quaternion.Identity()).multiply(hand.rotationQuaternion).normalize();hand.computeWorldMatrix(true);grip.computeWorldMatrix(true);
 }
 // Bake clearance using the deformed surface, not only bone landmarks.
 for(const skeleton of model.skeletons)skeleton.prepare(true);
 let minimumY=Infinity;const vertex=new Vector3();
 for(const mesh of model.meshes){const data=mesh.getPositionData(true,true);if(!data)continue;const world=mesh.computeWorldMatrix(true);for(let i=0;i<data.length;i+=3){Vector3.TransformCoordinatesFromFloatsToRef(data[i],data[i+1],data[i+2],world,vertex);minimumY=Math.min(minimumY,vertex.y);}}
 const surfaceLift=Math.max(0,.005-minimumY);worldShift(nodes.get('Hips'),new Vector3(0,surfaceLift,0));for(const n of nodes.values())n.computeWorldMatrix(true);
 return {p,dive,lift:flight.position.y,correction,surfaceLift,points:Object.fromEntries(names.map(name=>[name,nodes.get(name).getAbsolutePosition().asArray()]))};
}
for(const [name,seconds]of [['ArrivalDive',1],['ArrivalRecovery',2]]){
 const times=Array.from({length:seconds*60+1},(_,i)=>[i/60]),rotations=new Map(),translations=new Map();
 for(let f=0;f<times.length;f++){
  const p=name==='ArrivalDive'?0:f/(times.length-1),r=pose(p);if(name==='ArrivalRecovery'&&f%12===0)report.push(r);
  for(const id of g.json.skins[0].joints){const n=nodes.get(g.json.nodes[id].name);if(!n)continue;const q=rotations.get(id)??[],v=translations.get(id)??[];q.push(n.rotationQuaternion.asArray());v.push(n.position.asArray());rotations.set(id,q);translations.set(id,v);}
 }
 const input=append(g,times,'SCALAR'),animation={name,channels:[],samplers:[]};
 for(const [id,keys]of rotations){animation.channels.push({sampler:animation.samplers.length,target:{node:id,path:'rotation'}});animation.samplers.push({input,output:append(g,keys,'VEC4'),interpolation:'LINEAR'});if(g.json.nodes[id].name==='Hips'){animation.channels.push({sampler:animation.samplers.length,target:{node:id,path:'translation'}});animation.samplers.push({input,output:append(g,translations.get(id),'VEC3'),interpolation:'LINEAR'});}}
 g.json.animations=g.json.animations.filter(a=>a.name!==name);g.json.animations.push(animation);
}
writeGlb('art/processed/gunslinger-arrival-candidate.glb',g);writeFileSync('docs/arrival-pose-candidate.json',JSON.stringify({status:'candidate-awaiting-visual-review',frames:121,seconds:2,report},null,2));console.log('Arrival candidate authored; production unchanged.');scene.dispose();engine.dispose();


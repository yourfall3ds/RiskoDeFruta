import {ok} from 'node:assert';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
const engine=new NullEngine(),scene=new Scene(engine),m=await ImportMeshAsync(new Uint8Array(readFileSync('public/models/gunslinger.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
for(const a of m.animationGroups)a.stop();
for(const name of ['Aim','FinalDeath']){
 const a=m.animationGroups.find(a=>a.name===name);for(const t of a.targetedAnimations){const v=t.animation.evaluate(a.from+(a.to-a.from)*.4);if(t.animation.targetProperty==='rotationQuaternion')t.target.rotationQuaternion=v.clone();else if(t.animation.targetProperty==='position')t.target.position.copyFrom(v);}
 for(const n of m.transformNodes)n.computeWorldMatrix(true);
 const n=k=>m.transformNodes.find(n=>n.name===k).getAbsolutePosition();if(name==='FinalDeath')ok(n('Head').z<n('Hips').z-.25,'Fatal pose must lean backward after GLTF import');console.log(name,'head-hips',n('Head').subtract(n('Hips')).asArray(),'toe-foot',n('LeftToeBase').subtract(n('LeftFoot')).asArray());
}scene.dispose();engine.dispose();

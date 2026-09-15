import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
it('opens the real chest lid upward around a fixed rear hinge',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);try{const model=await ImportMeshAsync(new Uint8Array(readFileSync('public/models/interactive-chest.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});for(const a of model.animationGroups)a.stop();const hinge=model.transformNodes.find(n=>n.name==='ChestLidPivot')!;expect(hinge).toBeDefined();const clip=model.animationGroups.find(a=>a.targetedAnimations.some(t=>t.target===hinge))!;expect(clip).toBeDefined();const pose=(t:number)=>{for(const track of clip.targetedAnimations)track.target.rotationQuaternion=track.animation.evaluate(clip.from+(clip.to-clip.from)*t).clone();hinge.computeWorldMatrix(true);return Vector3.TransformCoordinates(new Vector3(0,0,-.65),hinge.getWorldMatrix());};const closed=pose(0),origin=hinge.getAbsolutePosition().clone(),open=pose(1);expect(Vector3.Distance(origin,hinge.getAbsolutePosition())).toBeLessThan(.0001);expect(open.y-closed.y).toBeGreaterThan(.35);}finally{scene.dispose();engine.dispose();}
});
it('ships a distinct spawn and authored combat animation for each original species',()=>{
 const audit=JSON.parse(readFileSync('docs/original-enemy-integrity.json','utf8'));for(const entry of audit){expect(entry.animations).toContain('Spawn');expect(entry.animations).toContain('Attack');expect(entry.geometryUnchanged).toBe(true);expect(entry.materialsUnchanged).toBe(true);}
 expect(readFileSync('scripts/restore-original-enemies.mjs','utf8')).not.toContain('Right_Hand_Sword_Slash');
});

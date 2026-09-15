import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {OrchardLods} from '../src/world/streaming/OrchardLods';
it('switches entire crowns exclusively with hysteresis and restores ownership on disposal',()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 const near=['leaves','branches','trunk'].map(part=>CreateBox('OrchardLOD_00_near_'+part,{},scene));
 const medium=['leaves','branches','trunk'].map(part=>CreateBox('OrchardLOD_00_medium_'+part,{},scene));
 for(const mesh of [...near,...medium])mesh.position.x=248;
 const lod=new OrchardLods([...near,...medium]);const step=(distance:number)=>lod.update(.3,{x:248+distance,y:0,z:0});
 try{
  step(20);expect(near.every(m=>m.isVisible)).toBe(true);expect(medium.every(m=>!m.isVisible)).toBe(true);
  step(58);expect(lod.counts.near).toBe(1);step(61);expect(lod.counts.medium).toBe(1);expect(near.every(m=>!m.isVisible)).toBe(true);expect(medium.every(m=>m.isVisible)).toBe(true);
  step(55);expect(lod.counts.medium).toBe(1);step(49);expect(lod.counts.near).toBe(1);
  step(195);expect(lod.hidden).toBe(1);expect([...near,...medium].every(m=>!m.isVisible)).toBe(true);
  step(185);expect(lod.hidden).toBe(1);step(179);expect(lod.counts.medium).toBe(1);
  lod.dispose();lod.dispose();step(300);expect([...near,...medium].every(m=>m.isVisible)).toBe(true);
 }finally{scene.dispose();engine.dispose();}
});
it('export contains twelve complete tree pairs sharing six original-material geometries',()=>{
 const file=readFileSync('public/models/solar-frontier.glb');const gltf=JSON.parse(file.subarray(20,20+file.readUInt32LE(12)).toString());
 const nodes=gltf.nodes.filter((n:{name?:string})=>n.name?.startsWith('OrchardLOD_'));
 expect(nodes).toHaveLength(72);expect(new Set(nodes.map((n:{mesh:number})=>n.mesh)).size).toBe(6);
 for(let i=0;i<12;i++)for(const tier of ['near','medium'])for(const part of ['leaves','branches','trunk']){
  const node=nodes.find((n:{name:string})=>n.name===`OrchardLOD_${String(i).padStart(2,'0')}_${tier}_${part}`);expect(node).toBeDefined();
  const mesh=gltf.meshes[node.mesh];expect(mesh.primitives).toHaveLength(1);const material=gltf.materials[mesh.primitives[0].material];expect(material.name).toContain('island_tree_01');expect(material.pbrMetallicRoughness.baseColorTexture).toBeDefined();
 }
});
it('caps dense grove detail and restores exclusive nearest crowns as the viewer moves',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),meshes=[];
 for(let i=0;i<40;i++)for(const tier of ['near','medium']){const m=CreateBox(`OrchardLOD_${i}_${tier}_leaves`,{},scene);m.position.x=i*2;meshes.push(m);}
 const lod=new OrchardLods(meshes,{nearDistance:18,farDistance:85,nearLimit:3,mediumLimit:20});
 try{expect(lod.hidden).toBe(40);for(const x of [0,25,50,75,500,0]){lod.update(.3,{x,y:0,z:0});expect(lod.counts.near).toBeLessThanOrEqual(3);expect(lod.counts.medium).toBeLessThanOrEqual(20);for(let i=0;i<40;i++)expect(meshes.filter(m=>m.name.startsWith(`OrchardLOD_${i}_`)&&m.isVisible).length).toBeLessThanOrEqual(1);}expect(lod.counts.near).toBe(3);lod.dispose();expect(meshes.every(m=>m.isVisible)).toBe(true);}finally{scene.dispose();engine.dispose();}
});

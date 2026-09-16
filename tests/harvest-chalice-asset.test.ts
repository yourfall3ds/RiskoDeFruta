import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {CHALICE_FILL_LEVELS,CHALICE_MORPHS,CHALICE_NODES,CHALICE_RIM_HEIGHT} from '../src/vfx/HarvestChaliceVisual';

const contract=JSON.parse(readFileSync('docs/harvest-chalice-asset.json','utf8'));
const binary=readFileSync('public/models/harvest-chalice.glb');
const gltf=JSON.parse(binary.subarray(20,20+binary.readUInt32LE(12)).toString('utf8').trim());
const body=binary.subarray(20+binary.readUInt32LE(12)+8);

const accessor=(index:number):number[][] => {
 const info=gltf.accessors[index];
 const view=gltf.bufferViews[info.bufferView];
 const size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[info.type as string]!;
 const stride=view.byteStride??size*4;
 const start=(view.byteOffset??0)+(info.byteOffset??0);
 const out:number[][]=[];
 for(let i=0;i<info.count;i++){
  const row:number[]=[];
  for(let c=0;c<size;c++)row.push(body.readFloatLE(start+i*stride+c*4));
  out.push(row);
 }
 return out;
};
const mesh=(name:string)=>gltf.meshes.find((entry:{name:string})=>entry.name===name);
const material=(name:string)=>gltf.materials.find((entry:{name:string})=>entry.name===name);
const triangles=(name:string)=>{
 const primitive=mesh(name).primitives[0];
 return gltf.accessors[primitive.indices].count/3;
};
const radius=(point:number[])=>Math.hypot(point[0]!,point[2]!);
/** Posições do suco no nível `level` (0 = malha base, 1..5 = morph targets). */
const juiceLevel=(level:number):number[][]=>{
 const primitive=mesh(CHALICE_NODES.juice).primitives[0];
 const base=accessor(primitive.attributes.POSITION);
 if(level===0)return base;
 const delta=accessor(primitive.targets[level-1].POSITION);
 return base.map((point,i)=>point.map((value,axis)=>value+delta[i]![axis]!));
};

describe('harvest chalice asset',()=>{
 it('ships vessel, brass frame and liquid as separate authored meshes',()=>{
  for(const name of [CHALICE_NODES.bowl,CHALICE_NODES.frame,CHALICE_NODES.juice,CHALICE_NODES.droplet])
   expect(gltf.nodes.some((node:{name:string})=>node.name===name),name).toBe(true);
  expect(gltf.nodes.some((node:{name:string})=>node.name===CHALICE_NODES.root)).toBe(true);
  // Cada peça é malha própria: o líquido é controlável sem tocar no vidro nem no latão.
  expect(new Set([CHALICE_NODES.bowl,CHALICE_NODES.frame,CHALICE_NODES.juice].map(name=>mesh(name).primitives[0].material)).size).toBe(3);
  expect(gltf.skins??[]).toHaveLength(0);
  expect(gltf.animations??[]).toHaveLength(0);
 });

 it('keeps the glass cheap: one blended material, the rest opaque, no transmission extension',()=>{
  expect(material('Chalice crystal').alphaMode).toBe('BLEND');
  expect(material('Chalice crystal').pbrMetallicRoughness.baseColorFactor[3]).toBeLessThan(.2);
  expect(material('Harvest juice').alphaMode).toBeUndefined();
  expect(material('Chalice aged brass').alphaMode).toBeUndefined();
  // Latão sem fator explícito = metálico 1 no padrão glTF; a pátina vem de COLOR_0.
  expect(material('Chalice aged brass').pbrMetallicRoughness.metallicFactor).toBeUndefined();
  expect(mesh(CHALICE_NODES.frame).primitives[0].attributes.COLOR_0).toBeDefined();
  expect(gltf.extensionsUsed??[]).not.toContain('KHR_materials_transmission');
  expect(gltf.extensionsUsed??[]).not.toContain('KHR_materials_volume');
 });

 it('gives the liquid one morph target per authored level, named for the runtime',()=>{
  const primitive=mesh(CHALICE_NODES.juice).primitives[0];
  expect(primitive.targets).toHaveLength(CHALICE_MORPHS.length);
  expect(mesh(CHALICE_NODES.juice).extras.targetNames).toEqual([...CHALICE_MORPHS]);
  for(const target of primitive.targets)expect(target.NORMAL,'normais morfadas').toBeDefined();
 });

 it('raises the liquid surface level by level and never past the rim',()=>{
  let previous=-Infinity;
  for(let level=0;level<CHALICE_FILL_LEVELS.length;level++){
   const top=Math.max(...juiceLevel(level).map(point=>point[1]!));
   expect(top,`nível ${level}`).toBeGreaterThan(previous);
   expect(top).toBeCloseTo(CHALICE_FILL_LEVELS[level]!,3);
   expect(top).toBeLessThan(CHALICE_RIM_HEIGHT);
   previous=top;
  }
  expect(Math.min(...juiceLevel(0).map(point=>point[1]!))).toBeGreaterThanOrEqual(contract.juiceFloor);
 });

 it('keeps the liquid inside the crystal at every level',()=>{
  // A parede interna abre de baixo para cima, então o menor raio do vidro na faixa imediatamente
  // ACIMA de um ponto do suco é um limite superior válido para ele — e ignora o polo do fundo.
  const SECTORS=24,BAND=.02;
  const sectorOf=(point:number[])=>Math.floor(((Math.atan2(point[2]!,point[0]!)+Math.PI*2)%(Math.PI*2))/(Math.PI*2)*SECTORS);
  const wall=new Map<string,number>();
  for(const point of accessor(mesh(CHALICE_NODES.bowl).primitives[0].attributes.POSITION)){
   const key=`${sectorOf(point)}:${Math.floor(point[1]!/BAND)}`;
   wall.set(key,Math.min(wall.get(key)??Infinity,radius(point)));
  }
  let checked=0;
  for(let level=0;level<CHALICE_FILL_LEVELS.length;level++){
   for(const point of juiceLevel(level)){
    const limit=wall.get(`${sectorOf(point)}:${Math.floor(point[1]!/BAND)+1}`);
    if(limit===undefined)continue;
    // Tolerância cobre o passo angular do setor contra o recorte de 6 lóbulos da borda.
    expect(radius(point),`nível ${level} y=${point[1]!.toFixed(3)}`).toBeLessThan(limit+.01);
    checked++;
   }
  }
  expect(checked).toBeGreaterThan(2000);
 });

 it('ships a real droplet mesh for the incoming juice arcs',()=>{
  expect(triangles(CHALICE_NODES.droplet)).toBeGreaterThan(120);
  expect(mesh(CHALICE_NODES.droplet).primitives[0].material).toBe(mesh(CHALICE_NODES.juice).primitives[0].material);
 });

 it('exposes the anchors the integration needs',()=>{
  const node=(name:string)=>gltf.nodes.find((entry:{name:string})=>entry.name===name);
  expect(node(CHALICE_NODES.rim).translation[1]).toBeCloseTo(CHALICE_RIM_HEIGHT,3);
  expect(node(CHALICE_NODES.floor).translation[1]).toBeCloseTo(contract.juiceFloor,3);
  expect(node(CHALICE_NODES.glow)).toBeDefined();
 });

 it('stays inside the triangle budget recorded in the contract',()=>{
  const total=[CHALICE_NODES.bowl,CHALICE_NODES.frame,CHALICE_NODES.juice,CHALICE_NODES.droplet]
   .reduce((sum,name)=>sum+triangles(name),0);
  expect(total).toBe(contract.totalTriangles);
  expect(total).toBeLessThan(30000);
 });

 it('keeps the runtime constants in step with the authored contract',()=>{
  expect([...CHALICE_FILL_LEVELS]).toEqual(contract.fillLevels);
  expect([...CHALICE_MORPHS]).toEqual(contract.morphTargets);
  expect(CHALICE_RIM_HEIGHT).toBeCloseTo(contract.height,3);
  expect(contract.reference).toBe('public/images/objectives/harvest-chalice-concept.png');
  expect(contract.source).toBe('art/blender/Harvest_Chalice.blend');
  expect(contract.script).toBe('scripts/build-harvest-chalice.py');
 });
});

import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {sculptRegion,type OutcropShape,type SculptedRegion} from '../src/world/terrain/WorldTerrain';
import {TerrainPresentation,FOLLOWS_TERRAIN,TERRAIN_DECAL} from '../src/world/terrain/TerrainPresentation';
import {RegionPresentation,WARM_UP_BUDGET} from '../src/world/streaming/RegionPresentation';

/**
 * Lado Babylon do relevo: malha desenhada, vegetação que acompanha a cota, decalque reconformado,
 * pedra aposentada — e o caminho de volta no `dispose`, que é o que o streaming exige quando a
 * região sai de residência.
 */

const read=(name:string)=>JSON.parse(readFileSync('public/models/'+name,'utf8'));

function baseRelief():SculptedRegion{
 const authored=read('farm-collision.json'),mesh=read('world-collision-mesh.json'),solid=read('solid-island-collision.json');
 const geometry={positions:[...mesh.positions as number[]],indices:[...mesh.indices as number[]]};
 return sculptRegion('base',{...geometry,boxes:[...authored.boxes,...mesh.boxes,...solid.boxes]});
}

/** Um card simples com a base no próprio pivô, como as instâncias de vegetação do mundo. */
function card(scene:Scene,name:string,position:Vector3,parent?:TransformNode):Mesh{
 const mesh=new Mesh(name,scene);
 const data=new VertexData();
 data.positions=[-.5,0,0,.5,0,0,.5,1.4,0,-.5,1.4,0];
 data.normals=[0,0,1,0,0,1,0,0,1,0,0,1];
 data.uvs=[0,0,1,0,1,1,0,1];
 data.indices=[0,1,2,0,2,3];
 data.applyToMesh(mesh);
 mesh.position.copyFrom(position);
 if(parent)mesh.parent=parent;
 mesh.computeWorldMatrix(true);
 return mesh;
}

describe('apresentação do relevo',()=>{
 it('desenha o retalho, levanta a vegetação, reconforma a trilha e devolve tudo no dispose',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
   const relief=baseRelief();
   // Ponto com relevo de verdade e ponto dentro de uma exclusão, escolhidos pelo próprio campo.
   let raised:{x:number;z:number}|undefined,flat:{x:number;z:number}|undefined;
   for(let x=-20;x<=20&&(!raised||!flat);x+=.5)for(let z=-22;z<=22;z+=.5){
    const offset=relief.offsetAt(x,z);
    if(!raised&&offset>.8)raised={x,z};
    if(!flat&&offset===0)flat={x,z};
   }
   expect(raised).toBeDefined();expect(flat).toBeDefined();

   // `__root__` do glTF espelha um eixo; a apresentação precisa funcionar com ele no caminho.
   const root=new TransformNode('__root__',scene);
   root.scaling.set(-1,1,1);
   const soil=new PBRMaterial('Leaf litter soil',scene);
   const anchor=card(scene,'Island cultivated ground',Vector3.Zero(),root);
   anchor.material=soil;

   const fern=card(scene,'fern_02.014',new Vector3(-raised!.x,0,raised!.z),root);
   const grass=card(scene,'grass_medium_01.002',new Vector3(-flat!.x,0,flat!.z),root);
   const post=card(scene,'Split rail post',new Vector3(-raised!.x,0,raised!.z),root);

   const decal=new Mesh('Worn track',scene);
   const data=new VertexData();
   data.positions=[-raised!.x,0,raised!.z,-raised!.x+1,0,raised!.z,-raised!.x,0,raised!.z+1];
   data.normals=[0,1,0,0,1,0,0,1,0];data.uvs=[0,0,1,0,0,1];data.indices=[0,1,2];
   data.applyToMesh(decal);decal.parent=root;decal.computeWorldMatrix(true);
   const decalBefore=Float32Array.from(decal.getVerticesData(VertexBuffer.PositionKind)!);

   const nodes=[anchor,fern,grass,post,decal];
   const presentation=new TerrainPresentation(scene,relief,nodes);

   // Retalho desenhado com o material de chão autorado — herda tom, UV e plugin estocástico.
   expect(presentation.patchMeshes.length).toBeGreaterThan(0);
   expect(presentation.patchMeshes[0]!.material).toBe(soil);
   expect(presentation.patchMeshes[0]!.getTotalVertices()).toBeGreaterThan(100);

   // Vegetação sobe exatamente o que o terreno subiu; o que está em exclusão não se mexe.
   expect(fern.getAbsolutePosition().y).toBeCloseTo(relief.offsetAt(raised!.x,raised!.z),5);
   expect(grass.getAbsolutePosition().y).toBe(0);
   // Estrutura com colisão assada NÃO acompanha: mover só o visual criaria colisor fantasma.
   expect(post.getAbsolutePosition().y).toBe(0);
   expect(presentation.liftedProps).toBe(1);

   // Decalque reconformado vértice a vértice, na mesma cota da malha nova.
   expect(presentation.reprojectedDecals).toBe(1);
   const decalAfter=decal.getVerticesData(VertexBuffer.PositionKind)!;
   expect(decalAfter[1]!).toBeCloseTo(relief.offsetAt(raised!.x,raised!.z),4);

   const patch=presentation.patchMeshes[0]!;
   presentation.dispose();
   expect(patch.isDisposed()).toBe(true);
   expect(fern.getAbsolutePosition().y).toBe(0);
   expect(Array.from(decal.getVerticesData(VertexBuffer.PositionKind)!)).toEqual(Array.from(decalBefore));
   // Dispose é idempotente: o streaming pode chamar duas vezes numa troca de região.
   presentation.dispose();
  }finally{scene.dispose();engine.dispose();}
 });

 it('esconde exatamente as instâncias de pedra cuja colisão foi apagada, e as devolve no dispose',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
   const shape=read('outcrop-rocks.json') as OutcropShape;
   const relief=sculptRegion('highland-farms',read('highland-farms-collision.json'),shape);
   expect(relief.retired.length).toBe(41);
   const rock=new PBRMaterial('coast_land_rocks_02',scene);
   const nodes:Mesh[]=[];
   for(const volume of relief.retired.slice(0,6)){
    // O nó da instância fica na BASE da rocha, 2 m abaixo do centro do volume.
    const mesh=card(scene,'coast_land_rocks_02.00'+nodes.length,new Vector3(volume.x,volume.y-2,volume.z));
    mesh.material=rock;nodes.push(mesh);
   }
   const survivor=card(scene,'coast_land_rocks_02.999',new Vector3(0,0,0));
   survivor.material=rock;nodes.push(survivor);

   const presentation=new TerrainPresentation(scene,relief,nodes);
   expect(presentation.retiredRocks).toBe(6);
   for(const mesh of nodes.slice(0,6))expect(mesh.isVisible).toBe(false);
   expect(survivor.isVisible).toBe(true);
   // Uma malha de afloramento por ilha, com o material de rocha original.
   expect(presentation.patchMeshes.filter(mesh=>/sculpted rock/.test(mesh.name))).toHaveLength(3);
   for(const mesh of presentation.patchMeshes)if(/sculpted rock/.test(mesh.name))expect(mesh.material).toBe(rock);

   presentation.dispose();
   for(const mesh of nodes)expect(mesh.isVisible).toBe(true);
  }finally{scene.dispose();engine.dispose();}
 });

 it('fatia a preparação da região em quadros e não esconde nada enquanto aquece',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  const sun=new DirectionalLight('sun',new Vector3(-.6,-1,.4),scene),shadows=new ShadowGenerator(256,sun);
  const meshes=Array.from({length:WARM_UP_BUDGET*3+40},(_,i)=>CreateBox(i%3?`fern_02.${i}`:`barn wall ${i}`,{size:1},scene));
  const presentation=new RegionPresentation(scene,meshes,shadows);
  try{
   // O primeiro tick prepara um lote, não a região inteira: é isso que tira o pico da ativação.
   expect(presentation.warming).toBe(meshes.length-WARM_UP_BUDGET);
   // Nada sumiu: peça ainda não preparada continua desenhada como veio do glTF.
   expect(meshes.every(mesh=>mesh.isVisible)).toBe(true);
   let ticks=0;
   while(presentation.warming&&ticks<20){presentation.update(1/60,{x:0,y:2,z:0});ticks++;}
   expect(presentation.warming).toBe(0);
   expect(ticks).toBeGreaterThan(1);
   expect(ticks).toBeLessThan(meshes.length);
   // Depois de aquecida, a visibilidade por distância está no ar para todo mundo.
   presentation.update(1/60,{x:0,y:900,z:0});
   expect(presentation.hidden).toBeGreaterThan(0);
  }finally{presentation.dispose();scene.dispose();engine.dispose();}
 });

 it('classifica como seguidor de terreno só o que não tem colisão assada',()=>{
  for(const name of ['fern_02','fern_02 path dressing','grass_medium_01','Harvest tomato.003','Harvest watermelon','Harvest watering-can'])
   expect(FOLLOWS_TERRAIN.test(name),name).toBe(true);
  // Tudo abaixo TEM colisão assada: mover o visual sem a colisão deixaria colisor fantasma.
  for(const name of ['coast_land_rocks_02.057','coast_land dressed','island_tree dressed','Split rail post','Barn side wall','tree-canopy-island_tree_01-0','Island cultivated ground'])
   expect(FOLLOWS_TERRAIN.test(name),name).toBe(false);
  for(const name of ['Worn track','Terrain conforming trail union','Rootwood worn earth trails'])
   expect(TERRAIN_DECAL.test(name),name).toBe(true);
 });
});

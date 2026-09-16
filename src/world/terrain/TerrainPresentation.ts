import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {Material} from '@babylonjs/core/Materials/material';
import type {Scene} from '@babylonjs/core/scene';
import type {SculptedRegion} from './WorldTerrain';
import type {OrientedVolume} from './RockOutcrops';

/**
 * Props que PODEM subir com o terreno.
 *
 * A lista não é estética: é exatamente o conjunto que os scripts de assado de colisão descartam
 * (`bake-world-collision.py` e `build-highland-farms.py` filtram fern/grass e as frutas soltas). Tudo
 * o que TEM colisão assada fica onde está — mover só o visual de uma pedra ou de um tronco criaria
 * colisor fantasma, que é justamente o defeito que esta entrega precisa não introduzir. Pedra de
 * borda e afloramento ficam parcialmente enterrados, nunca flutuando, porque o relevo só sobe.
 */
export const FOLLOWS_TERRAIN=/fern|grass|harvest\s+(tomato|watermelon)|watering.can/i;

/** Decalques de trilha: malhas que já conformam ao chão e precisam reconformar à cota nova. */
export const TERRAIN_DECAL=/trail|track|worn earth/i;

/** Acima disto a malha é um lote batido por material (ilha inteira), não um prop; não se levanta. */
const PROP_FOOTPRINT=12;

interface LiftedNode {mesh:AbstractMesh;y:number}
interface ReprojectedMesh {mesh:AbstractMesh;positions:Float32Array}

/**
 * Lado Babylon do relevo esculpido.
 *
 * Desenha os retalhos com o MESMO material de chão da região (então herdam a amostragem estocástica
 * e o tom já aprovados), levanta a vegetação solta para a cota nova e reconforma os decalques de
 * trilha. A geometria desenhada é literalmente o array que virou colisão — não existe caminho pelo
 * qual o visual e o piso possam divergir.
 */
export class TerrainPresentation {
 private readonly meshes:Mesh[]=[];
 private readonly lifted:LiftedNode[]=[];
 private readonly reprojected:ReprojectedMesh[]=[];
 private readonly retiredNodes:AbstractMesh[]=[];
 private disposed=false;
 constructor(
  scene:Scene,
  private readonly relief:SculptedRegion,
  nodes:readonly AbstractMesh[],
  options:{materialName?:string;rockMaterialName?:string}={},
 ){
  const material=findMaterial(nodes,options.materialName??'Leaf litter soil');
  for(const patch of this.relief.terrain?.patches??[]){
   if(!patch.geometry.indices.length)continue;
   this.meshes.push(this.build(scene,`${patch.plan.id} sculpted relief`,patch.geometry,material));
  }
  const rock=findMaterial(nodes,options.rockMaterialName??'coast_land_rocks_02');
  for(const group of this.relief.outcrops){
   if(!group.geometry.indices.length)continue;
   this.meshes.push(this.build(scene,`${group.id} sculpted rock`,group.geometry,rock));
  }
  this.retire(nodes);
  this.followTerrain(nodes);
 }

 private build(scene:Scene,name:string,geometry:{positions:number[];normals:number[];uvs:number[];indices:number[]},material:Material|null):Mesh {
  const mesh=new Mesh(name,scene);
  const data=new VertexData();
  data.positions=geometry.positions;data.normals=geometry.normals;data.uvs=geometry.uvs;data.indices=geometry.indices;
  data.applyToMesh(mesh);
  mesh.material=material;mesh.receiveShadows=true;mesh.isPickable=true;mesh.checkCollisions=false;
  mesh.freezeWorldMatrix();
  return mesh;
 }

 /**
  * Some com as instâncias de pedra cuja colisão já foi apagada.
  *
  * Esconder sem apagar a colisão deixaria colisor fantasma; apagar a colisão sem esconder deixaria
  * pedra atravessável. As duas coisas andam juntas, a partir da MESMA lista de volumes.
  */
 private retire(nodes:readonly AbstractMesh[]):void {
  if(!this.relief.retired.length)return;
  for(const node of nodes){
   if(!node.getTotalVertices()||!node.isVisible)continue;
   node.computeWorldMatrix(true);
   const position=node.getAbsolutePosition();
   if(!this.relief.retired.some(volume=>within(volume,position.x,position.y,position.z)))continue;
   node.isVisible=false;this.retiredNodes.push(node);
  }
 }

 /** Retalhos desenhados; usado por teste e diagnóstico. */
 get patchMeshes():readonly Mesh[]{return this.meshes;}
 get liftedProps():number{return this.lifted.length;}
 get reprojectedDecals():number{return this.reprojected.length;}
 get retiredRocks():number{return this.retiredNodes.length;}

 private followTerrain(nodes:readonly AbstractMesh[]):void {
  for(const node of nodes){
   if(!node.getTotalVertices())continue;
   const decal=TERRAIN_DECAL.test(node.name)||TERRAIN_DECAL.test(node.material?.name??'');
   if(decal){this.reproject(node);continue;}
   if(!FOLLOWS_TERRAIN.test(node.name))continue;
   node.computeWorldMatrix(true);
   const box=node.getBoundingInfo().boundingBox;
   if(Math.max(box.maximumWorld.x-box.minimumWorld.x,box.maximumWorld.z-box.minimumWorld.z)>PROP_FOOTPRINT)continue;
   const root=node.getAbsolutePosition();
   const offset=this.relief.offsetAt(root.x,root.z);
   if(offset<=0)continue;
   this.lifted.push({mesh:node,y:node.position.y});
   // `setAbsolutePosition` resolve a hierarquia do `__root__` do glTF (que espelha um eixo);
   // somar em `position.y` direto erraria a escala do pai.
   node.setAbsolutePosition(new Vector3(root.x,root.y+offset,root.z));
   node.computeWorldMatrix(true);
  }
 }

 /**
  * Reconforma um decalque vértice a vértice.
  *
  * O decalque já foi assado colado ao terreno antigo; somar o MESMO deslocamento que gerou a malha
  * nova mantém a trilha exatamente sobre o chão, inclusive subindo o terraço. Trabalha em espaço de
  * mundo e volta ao local dividindo pela escala Y do nó, então funciona com o `__root__` do glTF.
  */
 private reproject(node:AbstractMesh):void {
  const positions=node.getVerticesData(VertexBuffer.PositionKind);
  if(!positions)return;
  node.computeWorldMatrix(true);
  const matrix=node.getWorldMatrix(),scaleY=Math.abs(node.absoluteScaling.y)||1;
  const local=new Vector3(),world=new Vector3();
  const updated=new Float32Array(positions);
  let touched=false;
  for(let i=0;i<updated.length;i+=3){
   local.copyFromFloats(updated[i]!,updated[i+1]!,updated[i+2]!);
   Vector3.TransformCoordinatesToRef(local,matrix,world);
   const offset=this.relief.offsetAt(world.x,world.z);
   if(offset<=0)continue;
   updated[i+1]=updated[i+1]!+offset/scaleY;touched=true;
  }
  if(!touched)return;
  this.reprojected.push({mesh:node,positions:new Float32Array(positions)});
  // `setVerticesData` e não `updateVerticesData`: a malha vem do glTF com buffer NÃO atualizável, e
  // `updateVerticesData` é silenciosamente um no-op nesse caso — a trilha ficaria enterrada sem erro.
  node.setVerticesData(VertexBuffer.PositionKind,updated,false);
  node.refreshBoundingInfo({});
 }

 dispose():void {
  if(this.disposed)return;
  this.disposed=true;
  for(const mesh of this.meshes)mesh.dispose();
  this.meshes.length=0;
  for(const node of this.retiredNodes)if(!node.isDisposed())node.isVisible=true;
  this.retiredNodes.length=0;
  for(const {mesh,y} of this.lifted)if(!mesh.isDisposed()){mesh.position.y=y;mesh.computeWorldMatrix(true);}
  this.lifted.length=0;
  for(const {mesh,positions} of this.reprojected)if(!mesh.isDisposed()){mesh.setVerticesData(VertexBuffer.PositionKind,positions,false);mesh.refreshBoundingInfo({});}
  this.reprojected.length=0;
 }
}

/** Material autorado da região. Reutilizar o original é o que mantém tom, UV e plugin estocástico. */
function findMaterial(nodes:readonly AbstractMesh[],name:string):Material|null {
 for(const node of nodes)if(node.material?.name===name)return node.material;
 return null;
}

/** Ponto dentro de um volume orientado — o mesmo teste usado para apagar a colisão da instância. */
function within(volume:OrientedVolume,x:number,y:number,z:number):boolean {
 if(Math.abs(y-volume.y)>volume.hy+1.5)return false;
 const cos=Math.cos(volume.rotation),sin=Math.sin(volume.rotation),dx=x-volume.x,dz=z-volume.z;
 return Math.abs(dx*cos+dz*sin)<=volume.hx&&Math.abs(-dx*sin+dz*cos)<=volume.hz;
}

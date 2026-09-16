import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {DECK_LIP_OFFSET,deckRotationY} from '../src/world/DropshipDeck';
import {IntroSequence,INTRO_RUN_DISTANCE,DECK_TREAD_HEIGHT} from '../src/player/IntroSequence';

/** Carrega o GLB real e devolve os oito cantos ORIENTADOS de cada peça, já no mundo. */
async function deck(scene:Scene,edge:{x:number;y:number;z:number},yaw:number,materials=false){
 const root=new TransformNode('deck-test',scene);
 const imported=await ImportMeshAsync(new Uint8Array(readFileSync('public/models/dropship-deck.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:!materials}}});
 for(const mesh of imported.meshes)if(!mesh.parent)mesh.parent=root;
 root.rotation.y=deckRotationY(yaw);
 root.position.set(edge.x-Math.sin(yaw)*DECK_LIP_OFFSET,edge.y,edge.z-Math.cos(yaw)*DECK_LIP_OFFSET);
 root.computeWorldMatrix(true);
 const pieces=new Map<string,Vector3[]>();const all:Vector3[]=[];
 for(const mesh of imported.meshes){
  if(!mesh.getTotalVertices())continue;
  mesh.computeWorldMatrix(true);
  const corners=mesh.getBoundingInfo().boundingBox.vectorsWorld.map(v=>v.clone());
  pieces.set(mesh.name,corners);all.push(...corners);
 }
 const origin=new Vector3(edge.x,edge.y,edge.z);
 const forward=new Vector3(Math.sin(yaw),0,Math.cos(yaw)),right=new Vector3(Math.cos(yaw),0,-Math.sin(yaw));
 const span=(corners:Vector3[],axis:Vector3)=>{const v=corners.map(c=>Vector3.Dot(c.subtract(origin),axis));return {min:Math.min(...v),max:Math.max(...v)};};
 const height=(corners:Vector3[])=>({min:Math.min(...corners.map(c=>c.y)),max:Math.max(...corners.map(c=>c.y))});
 return {root,pieces,all,forward,right,span,height,meshes:imported.meshes};
}

const clear=(scene:Scene)=>{for(const mesh of scene.meshes.slice())mesh.dispose();for(const node of scene.transformNodes.slice())node.dispose();};

it('exports a real ship: deck, structural volume, railings, hazard marks and an open exit',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const {pieces,all,span,forward,right,height}=await deck(scene,{x:0,y:900,z:0},0);
  const names=[...pieces.keys()];
  // Peças exigidas pela direção: nada de retângulo flutuante solitário.
  for(const piece of ['deck','structure','railings','hazard','reactor','canopy'])
   expect(names.some(n=>n.toLowerCase().includes(piece)),`peça ${piece} em ${names.join(', ')}`).toBe(true);
  // Volume de nave de verdade: casco alto, largo e mais fundo que o próprio deck.
  const body=height(all),depth=span(all,forward),width=span(all,right);
  expect(body.max-body.min).toBeGreaterThan(6);
  expect(width.max-width.min).toBeGreaterThan(12);
  expect(depth.max-depth.min).toBeGreaterThan(30);
 }finally{scene.dispose();engine.dispose();}
});

it('aligns the run axis with the player yaw and keeps the open edge at the leap point',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  for(const yaw of [0,.9,-2.4,Math.PI]){
   const edge={x:12,y:900,z:-7};
   const {pieces,all,span,forward,right,height}=await deck(scene,edge,yaw);
   const plate=pieces.get('Dropship deck')!;
   const along=span(plate,forward),lateral=span(plate,right);
   // A pista corre PARA TRÁS da borda; nada de deck atravessado de lado.
   expect(along.max,`yaw ${yaw}`).toBeLessThan(.35);
   expect(along.min,`yaw ${yaw}`).toBeLessThan(-INTRO_RUN_DISTANCE-2);
   // Simétrica em torno do eixo de corrida e larga o bastante para correr.
   expect(Math.abs(lateral.max+lateral.min),`yaw ${yaw}`).toBeLessThan(.2);
   expect(lateral.max-lateral.min,`yaw ${yaw}`).toBeGreaterThan(5);
   // Piso na altura dos pés; casco acima e estrutura abaixo, nunca por cima da pista.
   expect(height(plate).max,`yaw ${yaw}`).toBeLessThan(edge.y+.45);
   expect(height(all).max,`yaw ${yaw}`).toBeGreaterThan(edge.y+2.5);
   expect(height(all).min,`yaw ${yaw}`).toBeLessThan(edge.y-1.5);
   clear(scene);
  }
 }finally{scene.dispose();engine.dispose();}
});

it('leaves the railings open at the exit so the leap has somewhere to go',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const edge={x:0,y:900,z:0},yaw=.6;
  const {pieces,span,forward,right,height}=await deck(scene,edge,yaw);
  const rails=pieces.get('Dropship railings')!,lateral=span(rails,right),along=span(rails,forward);
  // Corrimão dos DOIS lados, na borda da pista e na altura da cintura.
  expect(lateral.min).toBeLessThan(-2.5);
  expect(lateral.max).toBeGreaterThan(2.5);
  expect(height(rails).max).toBeGreaterThan(edge.y+.9);
  // …e parando antes da boca: a saída continua aberta.
  expect(along.max).toBeLessThan(-1);
 }finally{scene.dispose();engine.dispose();}
});

it('is painted graphite and olive metal, with no wood-brown diffuse anywhere',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  await deck(scene,{x:0,y:0,z:0},0,true);
  const by=(name:string)=>scene.materials.find(m=>m.name===name) as PBRMaterial;
  const hull=by('Dropship hull graphite'),plate=by('Dropship deck olive'),rail=by('Dropship rail steel');
  for(const [label,material] of [['casco',hull],['deck',plate],['corrimão',rail]] as const){
   expect(material,label).toBeDefined();
   // Sem mapa difuso não há como o casco voltar a parecer tábua marrom listrada.
   expect(material.albedoTexture,label).toBeFalsy();
   // O desgaste continua: relevo e rugosidade vêm dos mapas PBR.
   expect(material.bumpTexture,label).toBeTruthy();
   expect(material.metallicTexture,label).toBeTruthy();
   expect(material.metallic,label).toBeGreaterThan(.5);
  }
  const c=(m:PBRMaterial)=>m.albedoColor;
  // Grafite: dessaturado e frio — o azul nunca abaixo do vermelho, que é a assinatura do marrom.
  expect(Math.max(c(hull).r,c(hull).g,c(hull).b)-Math.min(c(hull).r,c(hull).g,c(hull).b)).toBeLessThan(.03);
  expect(c(hull).b).toBeGreaterThanOrEqual(c(hull).r);
  expect(c(hull).g).toBeLessThan(.12);
  // Oliva: verde acima do vermelho e azul no fundo.
  expect(c(plate).g).toBeGreaterThan(c(plate).r);
  expect(c(plate).r).toBeGreaterThan(c(plate).b);
  expect(c(rail).b).toBeGreaterThanOrEqual(c(rail).r*.95);
 }finally{scene.dispose();engine.dispose();}
});

it('marks the exit with matte yellow and black, keeping light only in the small mint guides',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const {pieces,span,forward,height}=await deck(scene,{x:0,y:900,z:0},0,true);
  const by=(name:string)=>scene.materials.find(m=>m.name===name) as PBRMaterial;
  const yellow=by('Dropship hazard yellow'),black=by('Dropship hazard black'),glow=by('Dropship reactor glow');
  // A boca inteira era uma placa branca acesa. Agora é marcação FOSCA.
  for(const [label,material] of [['amarelo',yellow],['preto',black]] as const){
   expect(material.emissiveColor.r+material.emissiveColor.g+material.emissiveColor.b,label).toBe(0);
   expect(material.albedoTexture,label).toBeFalsy();
  }
  expect(yellow.albedoColor.r).toBeGreaterThan(yellow.albedoColor.g);
  expect(yellow.albedoColor.g).toBeGreaterThan(yellow.albedoColor.b*3);
  expect(Math.max(black.albedoColor.r,black.albedoColor.g,black.albedoColor.b)).toBeLessThan(.02);
  // A única luz é a menta, e é verde.
  expect(glow.emissiveColor.g).toBeGreaterThan(.5);
  expect(glow.emissiveColor.g).toBeGreaterThan(glow.emissiveColor.r*3);
  const emissive=scene.materials.filter((m):m is PBRMaterial=>m instanceof PBRMaterial&&m.emissiveColor.r+m.emissiveColor.g+m.emissiveColor.b>.01);
  expect(emissive.map(m=>m.name)).toEqual(['Dropship reactor glow']);
  // …e a marcação fica rente ao piso, dentro da boca.
  const marks=pieces.get('Dropship hazard marks')!,plate=pieces.get('Dropship deck')!;
  expect(height(marks).max-900).toBeLessThanOrEqual(DECK_TREAD_HEIGHT+1e-3);
  expect(span(marks,forward).max).toBeLessThanOrEqual(span(plate,forward).max+1e-3);
 }finally{scene.dispose();engine.dispose();}
});

it('anchors the deck so the standby spot and the leap edge sit on the plating',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const intro=new IntroSequence(),landing={x:31,y:12,z:-8},yaw=1.1;
  const edge=intro.deckEdge(landing,yaw),start=intro.deckStart(landing,yaw);
  const {pieces,span,forward,right,height}=await deck(scene,edge,yaw);
  const plate=pieces.get('Dropship deck')!,along=span(plate,forward),lateral=span(plate,right);
  const origin=new Vector3(edge.x,edge.y,edge.z);
  for(const [label,spot] of [['borda',edge],['espera',start]] as const){
   const offset=new Vector3(spot.x,spot.y,spot.z).subtract(origin);
   const f=Vector3.Dot(offset,new Vector3(forward.x,forward.y,forward.z)),r=Vector3.Dot(offset,new Vector3(right.x,right.y,right.z));
   expect(f,label).toBeGreaterThan(along.min+.5);
   expect(f,label).toBeLessThan(along.max+.1);
   expect(Math.abs(r),label).toBeLessThan((lateral.max-lateral.min)/2-.6);
   expect(Math.abs(spot.y-height(plate).max),label).toBeLessThan(.5);
  }
 }finally{scene.dispose();engine.dispose();}
});

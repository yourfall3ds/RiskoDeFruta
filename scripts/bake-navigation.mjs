import {barnChestColliders,BARN_CHESTS,cityChestColliders,frontierChestColliders,FRONTIER_CHESTS,highlandChestColliders,HIGHLAND_CHESTS,ROOTWOOD_CHESTS,rootwoodChestColliders} from '../src/world/ExplorationSites.ts';
import fs from 'node:fs';
import {TacticalNavigation} from '../src/ai/TacticalNavigation.ts';
import {sculptRegion} from '../src/world/terrain/WorldTerrain.ts';
import {applyInitialRockFix} from '../src/world/terrain/InitialRocks.ts';
import {exportNavMesh,NavMeshQuery} from '@recast-navigation/core';
const authored=JSON.parse(fs.readFileSync('public/models/farm-collision.json'));
const geometry=JSON.parse(fs.readFileSync('public/models/world-collision-mesh.json'));
const solid=JSON.parse(fs.readFileSync('public/models/solid-island-collision.json'));geometry.boxes.push(...solid.boxes);
const city=JSON.parse(fs.readFileSync('public/models/farm-city-collision.json'));authored.surfaces.push(...city.surfaces);geometry.boxes.push(...city.boxes);
const frontier=JSON.parse(fs.readFileSync('public/models/solar-frontier-collision.json'));
const highlands=JSON.parse(fs.readFileSync('public/models/highland-farms-collision.json'));
const rootwood=JSON.parse(fs.readFileSync('public/models/rootwood-collision.json'));
// Relevo esculpido: o navmesh precisa ser assado sobre a MESMA superfície que o jogador pisa, senão
// os agentes andariam na cota antiga, por baixo do terraço. É a mesma chamada que o cliente
// (`FarmWorld`) e o servidor (`mergeCollision`) fazem ao carregar cada região.
const outcrops=fs.existsSync('public/models/outcrop-rocks.json')?JSON.parse(fs.readFileSync('public/models/outcrop-rocks.json')):undefined;
const initialRocks=JSON.parse(fs.readFileSync('public/models/initial-rock-fix.json'));
const rockFix=applyInitialRockFix(geometry,initialRocks,outcrops);
console.log('NAV INITIAL ROCKS',rockFix.removedInstances,'retired');
for(const [id,region] of [['solar-frontier',frontier],['highland-farms',highlands],['rootwood',rootwood]]){
 const sculpted=sculptRegion(id,region,outcrops);
 if(!sculpted.terrain&&!sculpted.outcrops.length)continue;
 const parts=[...(sculpted.terrain?[sculpted.terrain.collisionGeometry()]:[]),...sculpted.outcrops.map(group=>group.geometry)];
 let added=0;
 for(const part of parts){
  const offset=region.navPositions.length/3;
  for(const value of part.positions)region.navPositions.push(value);
  for(const index of part.indices)region.navIndices.push(index+offset);
  added+=part.indices.length/3;
 }
 console.log('NAV RELEVO',id,added,'triângulos');
}
// Campo inicial: o relevo entra na própria malha do cenário, que é o que o recast rasteriza.
const baseRelief=sculptRegion('base',{positions:geometry.positions,indices:geometry.indices,boxes:[...authored.boxes,...geometry.boxes]});
if(baseRelief.terrain)console.log('NAV RELEVO base',baseRelief.terrain.triangles,'triângulos');
const nav=await TacticalNavigation.create({geometry,walkableLinks:[...city.walkableLinks,...frontier.walkableLinks,...highlands.walkableLinks,...rootwood.walkableLinks],navigationPatches:[{positions:rootwood.navPositions,indices:rootwood.navIndices},{positions:frontier.navPositions,indices:frontier.navIndices},{positions:highlands.navPositions,indices:highlands.navIndices}],surfaces:authored.surfaces,boxes:[...authored.boxes,...geometry.boxes,...frontier.boxes,...highlands.boxes,...rootwood.boxes,...cityChestColliders(),...frontierChestColliders(),...highlandChestColliders(),...rootwoodChestColliders(),...barnChestColliders()]});
const cases=[['barn',{x:2,y:0,z:-16},{x:0,y:5,z:30}],['west bridge',{x:0,y:0,z:0},{x:-44,y:0,z:0}],['east bridge',{x:0,y:0,z:8},{x:44,y:2,z:8}]];
cases.push(['city access',{x:44,y:2,z:8},{x:100,y:2,z:8}],['northern farm',{x:100,y:2,z:25},{x:105,y:12,z:57}],['market',{x:119,y:2,z:18},{x:150,y:7,z:40}]);
cases.push(['orchard frontier',{x:175,y:7,z:45},{x:248,y:9,z:45}],['grain port',{x:248,y:9,z:45},{x:285,y:15,z:147}]);
cases.push(['glasshouse district',{x:285,y:15,z:147},{x:285,y:15,z:280}],['west greenhouse aisle',{x:285,y:15,z:245},{x:254,y:15,z:298}],['east greenhouse aisle',{x:285,y:15,z:245},{x:316,y:15,z:298}]);
for(const site of [...FRONTIER_CHESTS,...HIGHLAND_CHESTS,...ROOTWOOD_CHESTS])cases.push(['loot access '+site.id,{x:2,y:0,z:-16},{x:site.x+1.3,y:site.y,z:site.z}]);
// Cada baú de celeiro é uma rota própria: é a prova de que a porta abre, o corredor passa e a
// praga entra atrás do jogador em vez de ficar presa do lado de fora da parede.
for(const site of BARN_CHESTS)cases.push(['barn loot '+site.id,{x:2,y:0,z:-16},{x:site.x,y:site.y,z:site.z-1.4}]);
cases.push(['highland arrival',{x:285,y:15,z:280},{x:421.3,y:18.4,z:280}],['highland windmill route',{x:421.3,y:18.4,z:280},{x:720,y:31,z:320}],['highland seed valley',{x:421.3,y:18.4,z:280},{x:610,y:25,z:520}],['highland eastern loop',{x:720,y:31,z:320},{x:610,y:25,z:520}]);
// A validação atravessa o mundo inteiro a partir do ponto de chegada do jogador, e `nav.query` é a
// consulta de RUNTIME: 8192 nós, dimensionada para a multidão perto do jogador. Um A* de mais de mil
// metros esgota esse orçamento e devolve caminho PARCIAL, que o teste lê como rota incompleta.
// `loot access root-mill-south` vivia nessa borda — passava com folga zero, e os triângulos das
// caixas dos celeiros (em outros distritos) bastaram para derrubá-lo, com o baú intacto, sobre a
// malha e alcançável de todos os lados a 25 m. Offline a busca pode ser larga; o critério de
// proximidade de 1,2 m continua exatamente o mesmo.
const probe=new NavMeshQuery(nav.crowd.navMesh,{maxNodes:32768});
const report=cases.map(([name,from,to])=>{const p=probe.computePath(from,to,{maxPathPolys:4096,maxStraightPathPoints:4096});return{name,success:p.success&&p.path.length>0&&Math.hypot(p.path.at(-1).x-to.x,p.path.at(-1).y-to.y,p.path.at(-1).z-to.z)<1.2,path:p.path};});
fs.writeFileSync('art/navmesh-last-attempt.json',JSON.stringify(report,null,2));
if(!report.every(r=>r.success)){probe.destroy();nav.dispose();throw Error('Incomplete navigation routes: '+report.filter(r=>!r.success).map(r=>r.name).join(', '));}
const tiles=[];
for(let i=0;i<nav.crowd.navMesh.getMaxTiles();i++){
 const header=nav.crowd.navMesh.getTile(i).header();if(!header)continue;
 tiles.push({x:header.x(),z:header.y(),polygons:header.polyCount(),min:[0,1,2].map(axis=>header.bmin(axis)),max:[0,1,2].map(axis=>header.bmax(axis))});
}
if(tiles.length<2){nav.dispose();throw Error('Expected a tiled navigation bake');}
fs.writeFileSync('public/models/farm-navmesh.bin',exportNavMesh(nav.crowd.navMesh));
fs.writeFileSync('docs/navigation-tiles.json',JSON.stringify({tileSizeMeters:25.6,streamed:false,tiles},null,2));
probe.destroy();fs.writeFileSync('docs/navmesh-validation.json',JSON.stringify(report,null,2));console.log(report.map(r=>({name:r.name,success:r.success,points:r.path.length,end:r.path.at(-1)})));nav.dispose();

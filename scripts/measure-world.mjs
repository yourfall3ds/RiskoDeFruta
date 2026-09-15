import fs from 'node:fs';
import crypto from 'node:crypto';
import {init,importNavMesh,NavMeshQuery} from '@recast-navigation/core';
await init();
const bytes=fs.readFileSync('public/models/farm-navmesh.bin'),{navMesh}=importNavMesh(bytes),query=new NavMeshQuery(navMesh,{maxNodes:8192});
let connectedArea=0,totalArea=0,connectedPolygons=0,totalPolygons=0;const spawn={x:2,y:0,z:-16};
for(let tileIndex=0;tileIndex<navMesh.getMaxTiles();tileIndex++){
 const tile=navMesh.getTile(tileIndex),header=tile.header();if(!header)continue;
 for(let index=0;index<header.polyCount();index++){
  const poly=tile.polys(index);if(poly.getType()!==0)continue;const points=[];
  for(let i=0;i<poly.vertCount();i++){const v=poly.verts(i);points.push({x:tile.verts(v*3),y:tile.verts(v*3+1),z:tile.verts(v*3+2)});}
  let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a.x*b.z-b.x*a.z;}area=Math.abs(area)/2;totalArea+=area;totalPolygons++;
  const center=points.reduce((p,v)=>({x:p.x+v.x/points.length,y:p.y+v.y/points.length,z:p.z+v.z/points.length}),{x:0,y:0,z:0});
  const path=query.computePath(spawn,center,{maxPathPolys:2048,maxStraightPathPoints:2048}),end=path.path.at(-1);if(path.success&&end&&Math.hypot(end.x-center.x,end.y-center.y,end.z-center.z)<1){connectedArea+=area;connectedPolygons++;}
 }
}
const report={version:1,method:'Projected XZ area of ground navmesh polygons with a complete path from the player spawn; excludes disconnected roofs and decorative islands.',source:'public/models/farm-navmesh.bin',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),spawn,connectedAreaM2:connectedArea,totalNavmeshAreaM2:totalArea,connectedPolygons,totalPolygons,targetMultiplier:25,targetConnectedAreaM2:connectedArea*25};
if(!fs.existsSync('docs/world-baseline.json'))fs.writeFileSync('docs/world-baseline.json',JSON.stringify(report,null,2));
const baseline=JSON.parse(fs.readFileSync('docs/world-baseline.json','utf8').replace(/^\uFEFF/,''));
if(!(baseline.connectedAreaM2>0)||!(baseline.targetConnectedAreaM2>0))throw Error('Invalid frozen world baseline');
report.targetConnectedAreaM2=baseline.targetConnectedAreaM2;report.targetMultiplier=baseline.targetMultiplier;
report.baselineAreaM2=baseline.connectedAreaM2;report.achievedMultiplier=connectedArea/baseline.connectedAreaM2;report.targetProgress=connectedArea/baseline.targetConnectedAreaM2;
fs.writeFileSync('docs/world-measurement.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));query.destroy();navMesh.destroy();

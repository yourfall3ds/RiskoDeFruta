import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {PlanetFrame,PLANET,add,scale,normalize,sub,distance,dot} from '../src/planet/PlanetFrame';
import {PlanetMotor} from '../src/planet/PlanetMotor';
import {findIslandSpawn} from '../src/planet-game/PlanetSpawn';
import type {PlanetManifest} from '../src/planet-game/PlanetManifest';

const manifest=JSON.parse(gunzipSync(readFileSync('public/models/planet-archipelago.json.gz')).toString('utf8')) as PlanetManifest;
const frame=new PlanetFrame({...PLANET,centre:manifest.centre,surfaceRadius:manifest.radius,voidRadius:manifest.radius-32});
const world=new PlanetCollision();
const started=performance.now();world.setGeometry(manifest.positions,manifest.indices);
console.log('BVH',world.triangleCount,'triangles',Math.round(performance.now()-started),'ms');
const islands=manifest.islands.map(island=>{
  const spawn=findIslandSpawn(world,frame,island);
  if(!spawn)return {id:island.id,valid:false};
  const motor=new PlanetMotor({frame,collision:world,spawn:spawn.position});
  for(let n=0;n<120;n++)motor.fixedUpdate(1/60,{x:0,z:0,jump:false,sprint:false});
  const stable=distance(spawn.position,motor.position)<.25&&motor.grounded;
  motor.fixedUpdate(1/60,{x:0,z:0,jump:true,sprint:false});
  let jumpHeight=0;
  for(let n=0;n<120;n++){
    motor.fixedUpdate(1/60,{x:0,z:0,jump:false,sprint:false});
    jumpHeight=Math.max(jumpHeight,dot(sub(motor.position,spawn.position),spawn.up));
  }
  return {id:island.id,valid:stable&&jumpHeight>1&&motor.grounded,stable,jumpHeight,
    grounded:motor.grounded,position:motor.position,up:motor.up};
});
const bridges=manifest.bridges.map(bridge=>{
  const missing:number[]=[],obstructed:number[]=[];
  for(const [i,point] of bridge.waypoints.entries()){
    const up=frame.up(point),support=world.supportBelow(point,up,1,1);
    if(!support||support.slopeDegrees>48){missing.push(i);continue;}
    const contact=world.deepestContact(add(support.point,scale(up,.035)),up,.35,1.8);
    if(contact&&contact.depth>.04)obstructed.push(i);
  }
  const middle=Math.floor(bridge.waypoints.length/2),p=bridge.waypoints[middle]!,q=bridge.waypoints[middle+1]!;
  const support=world.supportBelow(p,frame.up(p),1,1);
  let advance=0,grounded=false;
  if(support){
    const motor=new PlanetMotor({frame,collision:world,spawn:add(support.point,scale(frame.up(p),.02)),heading:normalize(sub(q,p))});
    for(let n=0;n<120;n++)motor.fixedUpdate(1/60,{x:0,z:1,jump:false,sprint:false});
    advance=distance(motor.position,p);grounded=motor.grounded;
  }
  return {id:bridge.id,missing,obstructed,advance,grounded,valid:!missing.length&&!obstructed.length&&advance>3&&grounded};
});
const report={radius:manifest.radius,triangles:world.triangleCount,islands,bridges};
writeFileSync('docs/planet-asset-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(islands.some(i=>!i.valid)||bridges.some(b=>!b.valid))process.exitCode=1;

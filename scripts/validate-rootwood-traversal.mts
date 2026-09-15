import {ROOTWOOD_CHESTS,rootwoodChestColliders} from '../src/world/ExplorationSites';
import fs from 'node:fs';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/InputFrame';
const world=new CollisionWorld(),data=JSON.parse(fs.readFileSync('public/models/rootwood-collision.json','utf8'));
for(const [id,d] of [['highlands',JSON.parse(fs.readFileSync('public/models/highland-farms-collision.json','utf8'))],['rootwood',data]] as const){const w=new CollisionWorld();w.boxes.push(...d.boxes);w.setGeometry(d.positions,d.indices);w.setRecoveryVolumes(d.solidPositions,d.solidIndices);w.prepareRaycasts();world.attachRegion(id,w);}
const routes:{name:string;points:{x:number;y:number;z:number}[]}[]=[];
for(const [i,link] of data.walkableLinks.entries())routes.push({name:'bridge '+i,points:[link.a,link.b]});
const authored=JSON.parse(fs.readFileSync('docs/rootwood-authoring.json','utf8'));
for(const [i,path] of authored.paths.entries())routes.push({name:'trail '+i,points:path.map(([x,z]:number[])=>({x,y:world.groundAt(x,z,100),z}))});
world.movingBoxes.push(...rootwoodChestColliders());
for(const site of ROOTWOOD_CHESTS){const candidates=authored.paths.flat().map(([x,z]:number[])=>({x,y:world.groundAt(x,z,100),z}));const from=candidates.sort((a:any,b:any)=>Math.hypot(a.x-site.x,a.z-site.z)-Math.hypot(b.x-site.x,b.z-site.z))[0];const angle=Math.atan2(from.x-site.x,from.z-site.z),x=site.x+Math.sin(angle)*1.3,z=site.z+Math.cos(angle)*1.3;routes.push({name:'chest '+site.id,points:[from,{x,y:world.groundAt(x,z,100),z}]});}
const report=[];
for(const route of routes)for(const reverse of [false,true]){
 const points=reverse?[...route.points].reverse():route.points,player=new PlayerMotor(world,new EventBus(),points[0]),checkpoints=[];
 for(const point of points.slice(1)){
  const distance=Math.hypot(player.position.x-point.x,player.position.z-point.z);
  for(let tick=0;tick<distance/3*60+240;tick++){
   if(Math.hypot(player.position.x-point.x,player.position.z-point.z)<.25)break;
   player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},Math.atan2(point.x-player.position.x,point.z-player.position.z));
  }
  checkpoints.push({target:point,actual:{...player.position},distance:Math.hypot(player.position.x-point.x,player.position.z-point.z),heightError:Math.abs(player.position.y-point.y)});
 }
 report.push({name:route.name,reverse,success:checkpoints.every(p=>p.distance<.5&&p.heightError<.5)&&player.respawns===0&&player.solidRecoveries===0,respawns:player.respawns,recoveries:player.solidRecoveries,checkpoints});
}
fs.writeFileSync('art/rootwood-traversal.json',JSON.stringify(report,null,2));console.log(report.map(r=>({name:r.name,reverse:r.reverse,success:r.success,last:r.checkpoints.at(-1)})));
if(report.some(r=>!r.success))process.exitCode=1;

import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/InputFrame';
const trails=JSON.parse(readFileSync('docs/highland-trails.json','utf8')) as {name:string;points:number[][];width:number}[];
const d=JSON.parse(readFileSync('public/models/highland-farms-collision.json','utf8'));
const w=new CollisionWorld();w.boxes.push(...d.boxes);w.setGeometry(d.positions,d.indices);w.setRecoveryVolumes(d.solidPositions,d.solidIndices);w.prepareRaycasts();
it.each(trails)('walks the authored route $name in both directions without jumping or recovery',trail=>{
 for(const points of [trail.points,[...trail.points].reverse()]){
  const first=points[0]!,p=new PlayerMotor(w,new EventBus(),{x:first[0]!,y:w.groundAt(first[0]!,first[1]!,100),z:first[1]!});
  for(const dest of points.slice(1)){
   const distance=Math.hypot(p.position.x-dest[0]!,p.position.z-dest[1]!);
   for(let i=0;i<Math.ceil(distance/3*60)+180;i++){
    if(Math.hypot(p.position.x-dest[0]!,p.position.z-dest[1]!)<.25)break;
    p.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},Math.atan2(dest[0]!-p.position.x,dest[1]!-p.position.z));
   }
   expect(Math.hypot(p.position.x-dest[0]!,p.position.z-dest[1]!),trail.name+JSON.stringify(dest)).toBeLessThan(.5);
   expect(p.respawns).toBe(0);expect(p.solidRecoveries).toBe(0);
  }
 }
});

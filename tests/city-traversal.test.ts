import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/GameInput';
const data=JSON.parse(readFileSync('public/models/farm-city-collision.json','utf8'));
it.each([0,1,2,3,4])('walks across authored city bridge section %i without falling or clipping its landing',index=>{
 const world=new CollisionWorld(),city=new CollisionWorld();city.surfaces.push(...data.surfaces);city.boxes.push(...data.boxes);city.setGeometry(data.positions,data.indices);city.prepareRaycasts();world.attachRegion('farm-city',city);
 const {a,b}=data.walkableLinks[index],distance=Math.hypot(b.x-a.x,b.z-a.z),yaw=Math.atan2(b.x-a.x,b.z-a.z),player=new PlayerMotor(world,new EventBus(),{...a});
 for(let i=0;i<Math.ceil((distance+.4)/5.4*60)+30;i++){if(Math.hypot(player.position.x-b.x,player.position.z-b.z)<.25)break;player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},yaw);}
 expect(Math.hypot(player.position.x-b.x,player.position.z-b.z)).toBeLessThan(.5);expect(player.position.y).toBeCloseTo(b.y,0);expect(player.respawns).toBe(0);
});
it('the baked routes reach their destinations rather than accepting partial paths',()=>{const routes=JSON.parse(readFileSync('docs/navmesh-validation.json','utf8'));expect(routes).toHaveLength(44);expect(routes.map((r:{name:string})=>r.name)).toEqual(expect.arrayContaining(['barn','west bridge','east bridge','city access','northern farm','market','orchard frontier','grain port','glasshouse district','west greenhouse aisle','east greenhouse aisle','loot access root-grove-entry','loot access root-grove-square','loot access root-grove-east','loot access root-mill-entry','loot access root-mill-square','loot access root-mill-south','loot access root-seed-entry','loot access root-seed-square','loot access root-seed-south']));expect(routes.every((r:{success:boolean})=>r.success)).toBe(true);});

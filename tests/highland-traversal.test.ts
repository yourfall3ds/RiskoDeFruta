import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/InputFrame';
import {HIGHLAND_CHESTS} from '../src/world/HighlandSites';
const data=JSON.parse(readFileSync('public/models/highland-farms-collision.json','utf8'));
function world(){const w=new CollisionWorld();for(const file of ['solar-frontier-collision.json','highland-farms-collision.json']){const d=JSON.parse(readFileSync('public/models/'+file,'utf8')),r=new CollisionWorld();r.boxes.push(...d.boxes);r.setGeometry(d.positions,d.indices);r.setRecoveryVolumes(d.solidPositions,d.solidIndices);r.prepareRaycasts();w.attachRegion(file,r);}return w;}
it.each([0,1,2,3,4,5,6,7,8,9,10,11])('physically crosses highland bridge direction %i without falling or clipping',index=>{
 const w=world(),link=data.walkableLinks[Math.floor(index/2)],a=index%2?link.b:link.a,b=index%2?link.a:link.b,player=new PlayerMotor(w,new EventBus(),{...a}),yaw=Math.atan2(b.x-a.x,b.z-a.z),distance=Math.hypot(b.x-a.x,b.z-a.z);
 for(let i=0;i<Math.ceil(distance/5.4*60)+120;i++){if(Math.hypot(player.position.x-b.x,player.position.z-b.z)<.25)break;player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},yaw);}
 expect(Math.hypot(player.position.x-b.x,player.position.z-b.z)).toBeLessThan(.5);expect(Math.abs(player.position.y-b.y)).toBeLessThan(.4);expect(player.respawns).toBe(0);
});
it('highland rewards sit on solid terrain with accessible floor beside every chest',()=>{
 const w=world();expect(HIGHLAND_CHESTS).toHaveLength(9);
 for(const s of HIGHLAND_CHESTS){expect(w.groundAt(s.x,s.z,s.y+.5),s.id).toBeCloseTo(s.y,2);expect(w.insideSolid(s,.7),s.id).toBe(false);expect(Math.abs(w.groundAt(s.x+1.3,s.z,s.y+1)-s.y),s.id).toBeLessThan(.5);}
});

it('all three highland destinations have a complete long route from the original spawn',async()=>{
 const {init,importNavMesh,NavMeshQuery}=await import('@recast-navigation/core');await init();
 const {navMesh}=importNavMesh(new Uint8Array(readFileSync('public/models/farm-navmesh.bin'))),query=new NavMeshQuery(navMesh,{maxNodes:8192});
 try{for(const s of HIGHLAND_CHESTS){const to={x:s.x+1.3,y:s.y,z:s.z},p=query.computePath({x:2,y:0,z:-16},to,{maxPathPolys:2048,maxStraightPathPoints:2048}),end=p.path.at(-1);expect(p.success,s.id).toBe(true);expect(end,s.id).toBeDefined();expect(Math.hypot(end!.x-to.x,end!.y-to.y,end!.z-to.z),s.id).toBeLessThan(1.2);}}
 finally{query.destroy();navMesh.destroy();}
});

it('server loads the highland floors and all nine reward collision volumes by region id',async()=>{
 const {loadCollision}=await import('../server/rooms/FarmRoom');const {FarmSimulation}=await import('../server/FarmSimulation');
 const sim=new FarmSimulation('highland-server',loadCollision());
 expect(sim.collision.movingBoxes.filter(b=>b.id.startsWith('highland-chest-'))).toHaveLength(9);
 for(const s of HIGHLAND_CHESTS)expect(Math.abs(sim.collision.groundAt(s.x+1.3,s.z,s.y+1)-s.y),s.id).toBeLessThan(.5);
});

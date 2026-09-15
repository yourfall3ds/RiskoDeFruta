import {it,expect} from 'vitest';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {Ray} from '@babylonjs/core/Culling/ray';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
function region(x=0,y=0){const w=new CollisionWorld();w.setGeometry([x-5,y,-5,x+5,y,-5,x+5,y,5,x-5,y,5,x+2,y,-3,x+2,y+4,-3,x+2,y+4,3,x+2,y,3],[0,2,1,0,3,2,4,5,6,4,6,7]);w.prepareRaycasts();return w;}
it('unprepared regions do not expose partial ground and stale releases preserve replacements',()=>{
 const root=new CollisionWorld(),bad=new CollisionWorld();bad.setGeometry([0,0,0,1,0,0,0,0,1],[0,1,2]);expect(()=>root.attachRegion('farm',bad)).toThrow();expect(root.groundAt(0,0)).toBe(-Infinity);
 const a=region(),releaseA=root.attachRegion('farm',a);expect(root.groundAt(0,0)).toBe(0);const releaseB=root.attachRegion('farm',region(0,3));releaseA();expect(root.groundAt(0,0)).toBe(3);releaseB();releaseB();expect(root.regionCount).toBe(0);expect(root.groundAt(0,0)).toBe(-Infinity);
});
it('regional walls block walking, airborne parkour and fast projectiles and release cleanly',()=>{
 const root=new CollisionWorld(),release=root.attachRegion('wall',region());
 const foot={x:0,y:0,z:0};root.move(foot,8,0,.32,1.8,.35,true);expect(foot.x).toBeLessThan(1.7);
 const airborne={x:0,y:1,z:0};root.moveAirborne(airborne,{x:8,y:.5,z:0},.32,1.8);expect(airborne.x).toBeLessThan(1.7);
 const ray=new Ray(new Vector3(0,1,0),Vector3.Right(),10);expect(root.raycast(ray)?.distance).toBeCloseTo(2);expect(root.sweepSphere({x:0,y:1,z:0},{x:10,y:0,z:0},.1,true)?.time).toBeLessThan(.21);
 release();expect(root.raycast(ray)).toBeUndefined();const free={x:0,y:1,z:0};root.moveAirborne(free,{x:8,y:0,z:0},.32,1.8);expect(free.x).toBe(8);
});
it('base and regional geometry choose the nearest hit and the valid floor at each elevation',()=>{
 const root=region();root.attachRegion('upper',region(0,6));expect(root.groundAt(0,0,4)).toBe(0);expect(root.groundAt(0,0,8)).toBe(6);
 expect(root.raycast(new Ray(new Vector3(0,12,0),Vector3.Down(),20))?.distance).toBeCloseTo(6);
 const remote=region(100,2);root.attachRegion('remote',remote);expect(root.groundAt(100,0)).toBe(2);expect(root.groundAt(50,0)).toBe(-Infinity);
});
it('mounted regions cannot form cycles or replace their geometry behind the parent index',()=>{
 const root=new CollisionWorld(),child=region(),release=root.attachRegion('child',child);expect(()=>child.attachRegion('root',root)).toThrow();expect(()=>child.attachRegion('nested',region())).toThrow();expect(()=>child.setGeometry([],[])).toThrow();release();expect(()=>child.setGeometry([],[])).not.toThrow();
});
it('regional boxes participate in overlap recovery and capsule sweeps',()=>{
 const root=new CollisionWorld(),child=new CollisionWorld();child.boxes.push({id:'regional-crate',min:{x:10,y:0,z:-1},max:{x:12,y:3,z:1}});const release=root.attachRegion('crate',child);expect(root.insideSolid({x:11,y:0,z:0})).toBe(true);expect(root.sweepSphere({x:8,y:1,z:0},{x:6,y:0,z:0},.3)?.collider.id).toBe('regional-crate');release();expect(root.insideSolid({x:11,y:0,z:0})).toBe(false);
});
import {TacticalNavigation} from '../src/ai/TacticalNavigation';
it('navigation derives bounds from a distant region instead of clipping to the original map',async()=>{
 const world=new CollisionWorld();world.surfaces.push({id:'distant farm',x:5000,z:-3000,height:18,width:30,depth:30});
 const nav=await TacticalNavigation.create(world);
 try{const route=nav.query.computePath({x:4992,y:18,z:-3000},{x:5008,y:18,z:-3000});expect(route.success).toBe(true);expect(route.path.at(-1)?.x).toBeCloseTo(5008,0);expect(route.path.at(-1)?.y).toBeCloseTo(18,0);}finally{nav.dispose();}
});
it('actor footprints retain both sides of a regional boundary and ignore unrelated terrain',()=>{
 const root=new CollisionWorld();root.attachRegion('a',region());root.attachRegion('b',region(10));root.attachRegion('remote',region(100));
 expect(root.regionIdsAt({x:5,y:0,z:0},.4)).toEqual(['a','b']);expect(root.regionIdsAt({x:0,y:50,z:0},.4)).toEqual(['a']);expect(root.regionIdsAt({x:50,y:0,z:0},.4)).toEqual([]);
});

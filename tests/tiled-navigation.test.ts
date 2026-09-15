import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {init,importNavMesh,NavMeshQuery,Crowd} from '@recast-navigation/core';

it('exports multiple bounded tiles with complete routes across district seams in both directions',async()=>{
  await init();const {navMesh}=importNavMesh(new Uint8Array(readFileSync('public/models/farm-navmesh.bin'))),query=new NavMeshQuery(navMesh);
  try{
    let occupied=0;
    for(let i=0;i<navMesh.getMaxTiles();i++){
      const h=navMesh.getTile(i).header();if(!h)continue;occupied++;
      expect(h.bmax(0)-h.bmin(0)).toBeCloseTo(25.6,3);
      expect(h.bmax(2)-h.bmin(2)).toBeCloseTo(25.6,3);
    }
    expect(occupied).toBeGreaterThan(20);
    const spawn={x:2,y:0,z:-16};
    for(const destination of [{x:-44,y:0,z:0},{x:100,y:2,z:8},{x:248,y:9,z:45},{x:286.3,y:15,z:324}]){
      for(const [from,to] of [[spawn,destination],[destination,spawn]]){
        const route=query.computePath(from!,to!),end=route.path.at(-1);
        expect(route.success).toBe(true);expect(end).toBeDefined();
        expect(Math.hypot(end!.x-to!.x,end!.y-to!.y,end!.z-to!.z)).toBeLessThan(.5);
      }
    }
  }finally{query.destroy();navMesh.destroy();}
});

it('a Detour agent crosses the suspended west bridge without stopping at a tile boundary',async()=>{
  await init();const {navMesh}=importNavMesh(new Uint8Array(readFileSync('public/models/farm-navmesh.bin'))),crowd=new Crowd(navMesh,{maxAgents:2,maxAgentRadius:1});
  try{
    const agent=crowd.addAgent({x:0,y:0,z:0},{radius:.6,height:1.8,maxSpeed:4,maxAcceleration:8,collisionQueryRange:6,pathOptimizationRange:12,updateFlags:31});
    agent.requestMoveTarget({x:-44,y:0,z:0});
    for(let i=0;i<1500;i++)crowd.update(1/60);
    const p=agent.position();expect(Math.hypot(p.x+44,p.z)).toBeLessThan(.6);expect(Math.abs(p.y)).toBeLessThan(.3);
  }finally{crowd.destroy();navMesh.destroy();}
});

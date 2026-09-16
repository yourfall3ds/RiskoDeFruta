import {expect,it} from 'vitest';
import {findSpawnPoint} from '../src/stages/StageSpawn';
import {findTotemSite,type ExpeditionTerrain} from '../src/run/ExpeditionObjectives';

/**
 * Dublê de referencial PLANO: o mesmo mundo de antes, agora falando o contrato de superfície.
 * `support` reproduz `groundAt` (sonda que desce e devolve o piso mais alto sob o ponto).
 */
const terrain=(ground:(x:number,z:number)=>number):ExpeditionTerrain=>({
 up:()=>({x:0,y:1,z:0}),
 basis:()=>({up:{x:0,y:1,z:0},forward:{x:0,y:0,z:1},right:{x:1,y:0,z:0}}),
 walk:(p,d)=>({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z}),
 planarDistance:(p,q)=>Math.hypot(p.x-q.x,p.z-q.z),
 heightGap:(p,q)=>p.y-q.y,
 support:(p,above)=>{
  const y=ground(p.x,p.z);
  if(!Number.isFinite(y)||y>p.y+above+1e-5)return undefined;
  return {point:{x:p.x,y,z:p.z},normal:{x:0,y:1,z:0},offset:p.y-y,slopeDegrees:0};
 },
 insideSolid:()=>false,
 sweep:()=>undefined,
});
const island={id:'upper',name:'Upper island',x:0,y:5,z:0,width:24,depth:24};

it('does not turn a failed upper-island landing into a spawn on the lower starting field',()=>{
 const lowerField=terrain(()=>0);
 expect(findSpawnPoint(lowerField,island)).toBeUndefined();
 expect(findTotemSite(lowerField,island,6.5,()=>true)).toBeUndefined();
});

it('does not borrow neighboring ground outside the chosen island footprint',()=>{
 const neighbor=terrain(x=>x>12?5:-Infinity);
 // The unrestricted legacy search can reach that neighboring platform.
 expect(findSpawnPoint(neighbor,{x:0,y:5,z:0})).toBeDefined();
 expect(findTotemSite(neighbor,{id:'legacy',name:'legacy',x:0,y:5,z:0},6.5,()=>true)).toBeDefined();
 expect(findSpawnPoint(neighbor,island)).toBeUndefined();
 expect(findTotemSite(neighbor,island,6.5,()=>true)).toBeUndefined();
});

it('still accepts safe floor belonging to the selected island',()=>{
 const floor=terrain(()=>5);
 expect(findSpawnPoint(floor,island)).toEqual({x:0,y:5,z:0});
 expect(findTotemSite(floor,island,6.5,()=>true)).toEqual({x:0,y:5,z:0});
});

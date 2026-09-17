import {it,expect} from 'vitest';
import {atlasPoint,ExplorationMemory} from '../src/ui/ExplorationMap';
import type {SurfaceFrame} from '../src/physics/SurfaceFrame';
const surface={planarDistance:(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number})=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)} as SurfaceFrame;
const sites=[{id:'a',name:'A',centre:{x:0,y:100,z:0},up:{x:0,y:1,z:0},radius:10},{id:'b',name:'B',centre:{x:70,y:70,z:0},up:{x:.7,y:.7,z:0},radius:10}];
it('revela somente regiões alcançadas e limpa exploração ao trocar estágio',()=>{
 const memory=new ExplorationMemory();
 expect(memory.update('run:1',sites,surface,sites[0]!.centre)?.id).toBe('a');
 expect([...memory.visited]).toEqual(['a']);
 expect(memory.update('run:1',sites,surface,{x:35,y:85,z:0})).toBeUndefined();
 expect([...memory.visited]).toEqual(['a']);
 memory.update('run:1',sites,surface,sites[1]!.centre);
 expect([...memory.visited]).toEqual(['a','b']);
 memory.update('run:2',sites,surface,sites[1]!.centre);
 expect([...memory.visited]).toEqual(['b']);
 memory.update('other:2',sites,surface,sites[0]!.centre);
 expect([...memory.visited]).toEqual(['a']);
});
it('projeta os dois hemisférios sem confundir antípodas',()=>{
 const c={x:0,y:0,z:0};
 expect(atlasPoint({x:0,y:100,z:0},c).y).toBe(0);
 expect(atlasPoint({x:0,y:-100,z:0},c).y).toBe(1);
 expect(atlasPoint({x:100,y:0,z:0},c).x).toBe(.75);
 expect(atlasPoint({x:-100,y:0,z:0},c).x).toBe(.25);
});

import {expect,it} from 'vitest';
import {ViewUpdateGate} from '../src/rendering/ViewUpdateGate';
it('keeps a frozen view throttled but follows cumulative camera movement without aliasing its position',()=>{
 const gate=new ViewUpdateGate(),camera={x:0,y:0,z:0};
 expect(gate.ready(0,camera)).toBe(true);
 for(let i=1;i<12;i++){camera.y=i;expect(gate.ready(0,camera)).toBe(false);}
 camera.y=12;expect(gate.ready(0,camera)).toBe(true);
 expect(gate.ready(.125,camera)).toBe(false);expect(gate.ready(.125,camera)).toBe(true);
 expect(gate.ready(Number.NaN,camera)).toBe(false);
 expect(gate.ready(-1,camera)).toBe(false);
 expect(gate.ready(.25,camera)).toBe(true);
});

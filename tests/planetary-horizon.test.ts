import {it,expect} from 'vitest';
import {PlanetaryHorizon} from '../src/camera/PlanetaryHorizon';
const position={x:1000,y:30,z:0};
function settle(yaw=0,pitch=0,hz=60){const horizon=new PlanetaryHorizon();let roll=0;for(let i=0;i<hz*12;i++)roll=horizon.update(position,yaw,pitch,1/hz);return roll;}
it('curves the horizon by viewing direction with a four degree cap',()=>{
 expect(settle()).toBeLessThan(-.06);expect(Math.abs(settle())).toBeLessThanOrEqual(Math.PI/45);
 expect(settle(Math.PI)).toBeCloseTo(-settle(),5);expect(settle(Math.PI/2)).toBeCloseTo(0,5);
 expect(Math.abs(settle(0,1.1))).toBeLessThan(Math.abs(settle())*.3);
});
it('is frame-rate independent and limits abrupt turns or teleports',()=>{
 expect(settle(0,0,30)).toBeCloseTo(settle(0,0,120),4);
 const horizon=new PlanetaryHorizon();let previous=0;
 for(let i=0;i<300;i++){const roll=horizon.update({...position,x:i%2?1e8:-1e8},i,0,1/60);expect(Math.abs(roll-previous)).toBeLessThanOrEqual(Math.PI/90/60+1e-12);previous=roll;}
 expect(horizon.update(position,0,0,NaN)).toBe(previous);
 expect(horizon.update(position,0,0,-1)).toBe(previous);
});

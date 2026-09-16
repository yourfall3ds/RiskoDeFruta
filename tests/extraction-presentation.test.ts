import {it,expect} from 'vitest';
import {extractionPresentation} from '../src/stages/ExtractionPresentation';
import {deckClearance} from '../src/player/IntroSequence';
it('runs, jumps through the open lip and stays inside the ship through travel',()=>{
 for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
  const origin={x:100,y:12,z:72};
  expect(extractionPresentation('harvest',0,origin,yaw)).toBeUndefined();
  expect(extractionPresentation('board',.8,origin,yaw)!.clip).toBe('Run');
  expect(extractionPresentation('board',1.5,origin,yaw)!.clip).toBe('Jump');
  const end=extractionPresentation('board',2.4,origin,yaw)!,travel=extractionPresentation('travel',0,origin,yaw)!;
  expect(travel.body).toEqual(end.body);
  // Interior lies behind the ship's outward-facing lip, never outside the ramp.
  expect((travel.body.x-travel.edge.x)*Math.sin(travel.shipYaw)+(travel.body.z-travel.edge.z)*Math.cos(travel.shipYaw)).toBeCloseTo(-2.4);
  for(const t of [0,1,4,30]){
   const p=extractionPresentation('travel',t,origin,yaw)!;expect(p.body.y-p.edge.y).toBeCloseTo(deckClearance('Idle'));
   expect(Object.values(p.body).every(Number.isFinite)).toBe(true);
  }
 }
});

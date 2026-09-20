import {describe,it,expect} from 'vitest';
import {objectiveBearing} from '../src/ui/ObjectiveBearing';

describe('objective arrows on spherical terrain',()=>{
  it('uses the local horizon on the side of the planet, where global X/Z bearings collapse',()=>{
    const player={x:180,y:0,z:0},up={x:1,y:0,z:0},forward={x:0,y:1,z:0};
    expect(objectiveBearing(player,{x:170,y:30,z:0},forward,up)).toBe('↑');
    expect(objectiveBearing(player,{x:170,y:0,z:30},forward,up)).toBe('→');
    expect(objectiveBearing(player,{x:170,y:-30,z:0},forward,up)).toBe('↓');
    expect(objectiveBearing(player,{x:170,y:0,z:-30},forward,up)).toBe('←');
  });
  it('keeps the target direction when looking upward or downward',()=>{
    const player={x:0,y:180,z:0},target={x:10,y:173,z:10},up={x:0,y:1,z:0};
    for(const pitch of [-10,0,10])expect(objectiveBearing(player,target,{x:0,y:pitch,z:1},up)).toBe('↗');
  });
  it('turns the arrow with the camera on the underside of the planet',()=>{
    const player={x:0,y:-180,z:0},target={x:20,y:-178,z:0},up={x:0,y:-1,z:0};
    expect(objectiveBearing(player,target,{x:0,y:0,z:1},up)).toBe('←');
    expect(objectiveBearing(player,target,{x:1,y:0,z:0},up)).toBe('↑');
  });
});

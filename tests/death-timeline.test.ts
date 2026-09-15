import {it,expect} from 'vitest';
import {DeathTimeline} from '../src/player/DeathTimeline';
it('allows defeat choices only once after the full reaction, and resets for a new attempt',()=>{
 const timeline=new DeathTimeline();expect(timeline.update(10)).toBe(false);expect(timeline.start()).toBe(true);expect(timeline.start()).toBe(false);
 for(let i=0;i<167;i++)expect(timeline.update(1/60)).toBe(false);
 expect(timeline.active).toBe(true);expect(timeline.update(1/60)).toBe(true);expect(timeline.progress).toBe(1);expect(timeline.update(10)).toBe(false);
 timeline.reset();expect(timeline.progress).toBe(0);expect(timeline.start()).toBe(true);expect(timeline.update(10)).toBe(true);
});
it('pause and invalid clock values cannot skip or corrupt the reaction',()=>{
 const timeline=new DeathTimeline();timeline.start();timeline.update(.8);for(const dt of [0,-1,NaN,Infinity])expect(timeline.update(dt)).toBe(false);expect(timeline.elapsed).toBe(.8);
 expect(timeline.update(1)).toBe(false);expect(timeline.update(1)).toBe(true);
});

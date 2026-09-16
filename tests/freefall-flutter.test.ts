import {it,expect} from 'vitest';
import {freefallFlutter} from '../src/animation/FreefallFlutter';
import {MeteorArrival} from '../src/player/MeteorArrival';
const angles=(t:number,w=1)=>{const f=freefallFlutter(t,w);return [f.roll,f.yaw,f.pitch,...f.bends.map(b=>b.angle)];};
it('is silent without weight and rejects invalid input',()=>{
 for(const t of [0,3.7,120])expect(angles(t,0).every(a=>a===0)).toBe(true);
 expect(angles(NaN,1).every(Number.isFinite)).toBe(true);expect(angles(2,NaN).every(a=>a===0)).toBe(true);
});
it('keeps every joint bounded and continuous while it keeps moving',()=>{
 let previous=angles(0),travel=0;
 for(let i=1;i<=600;i++){const next=angles(i/60);for(let j=0;j<next.length;j++){expect(Math.abs(next[j]!)).toBeLessThan(.5);const step=Math.abs(next[j]!-previous[j]!);expect(step).toBeLessThan(.05);travel+=step;}previous=next;}
 expect(travel).toBeGreaterThan(20);
});
it('drives both legs out of phase for alternating kicks',()=>{
 const legs=(t:number)=>{const b=freefallFlutter(t,1).bends;return [b.find(x=>x.bone==='LeftUpLeg'&&x.axis===0)!.angle,b.find(x=>x.bone==='RightUpLeg'&&x.axis===0)!.angle] as const;};
 for(const t of [.3,1.1,2.4]){const [l,r]=legs(t);expect(l).toBeCloseTo(-r,6);}
});
it('continues the menu clock into the descent and fades out before impact',()=>{
 const f=new MeteorArrival();f.start(7.35);expect(f.clock).toBeCloseTo(7.35);expect(f.flutter).toBe(1);
 f.update(.5,()=>{});expect(f.clock).toBeCloseTo(7.85);expect(f.flutter).toBe(1);
 f.update(3.6,()=>{});expect(f.flutter).toBe(0);
});

import {it,expect} from 'vitest';
import {RunProgression} from '../src/run/RunProgression';
import {RunRNG} from '../src/core/RunRNG';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents} from '../src/core/contracts';
it('sorteia efeitos especiais sem diluição pelo tamanho do catálogo',()=>{
 const run=new RunProgression(new EventBus<GameEvents>()),rng=new RunRNG('variedade').stream('loot');
 const items=Array.from({length:10000},()=>run.randomItem(rng));
 expect(items.filter(i=>i.stat==='extraJumps').length).toBeGreaterThan(350);
 expect(items.filter(i=>i.stat==='skillCharges').length).toBeGreaterThan(80);
 expect(items.filter(i=>i.hook==='blast').length).toBeGreaterThan(80);
 expect(new Set(items.map(i=>i.id)).size).toBeGreaterThan(70);
 const sequence=(seed:string)=>{const r=new RunRNG(seed).stream('loot');return Array.from({length:20},()=>run.randomItem(r).id);};
 expect(sequence('a')).toEqual(sequence('a'));
 expect(sequence('a')).not.toEqual(sequence('b'));
});

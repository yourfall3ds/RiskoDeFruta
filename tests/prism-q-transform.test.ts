import {describe,it,expect} from 'vitest';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents} from '../src/core/contracts';
import {MPCharge} from '../src/combat/MPCharge';
describe('PRISM first Q tier',()=>{
 it('can transform at zero MP without spending resource',()=>{const mp=new MPCharge(new EventBus<GameEvents>());mp.current=0;for(let i=0;i<40;i++)mp.update(1/60,true,true);expect(mp.tier).toBe(1);expect(mp.update(1/60,false,true)).toBe(1);expect(mp.current).toBe(0);});
 it('still charges the normal tier II cost',()=>{const mp=new MPCharge(new EventBus<GameEvents>());for(let i=0;i<85;i++)mp.update(1/60,true,true);expect(mp.update(1/60,false,true)).toBe(2);expect(mp.current).toBe(45);});
 it('keeps pistol tier I paid',()=>{const mp=new MPCharge(new EventBus<GameEvents>());for(let i=0;i<40;i++)mp.update(1/60,true);expect(mp.update(1/60,false)).toBe(1);expect(mp.current).toBe(75);});
});

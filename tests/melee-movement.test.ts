import {it,expect} from 'vitest';
import {UnarmedCombat} from '../src/combat/UnarmedCombat';
import {meleeMovement} from '../src/combat/MeleeMovement';
import {EMPTY_INPUT} from '../src/input/InputFrame';

it('plants a strike briefly, restores movement on recovery and keeps evasion available',()=>{
 const combat=new UnarmedCombat();combat.armed=false;const input={...EMPTY_INPUT,x:1,fire:true};
 expect(meleeMovement(input,combat,true)).toBe(input);
 combat.strike();combat.update(combat.step.windup+.01);
 expect(meleeMovement(input,combat,true).x).toBe(0);
 expect(meleeMovement(input,combat,false)).toBe(input);
 for(const evade of ['dash','dodge'] as const){const escaping={...input,[evade]:true};expect(meleeMovement(escaping,combat,true)).toBe(escaping);}
 combat.update(combat.step.active+combat.step.recover*.8);
 expect(meleeMovement(input,combat,true).x).toBeGreaterThan(.8);
 combat.update(1);expect(meleeMovement(input,combat,true)).toBe(input);
});

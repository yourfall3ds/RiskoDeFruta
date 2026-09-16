import type {InputFrame} from '../input/InputFrame';
import type {UnarmedCombat} from './UnarmedCombat';

/** A planted strike slows the step; dodges and airborne steering remain responsive. */
export function meleeMovement(input:InputFrame,combat:UnarmedCombat,grounded:boolean):InputFrame {
 if(!grounded||combat.armed||!combat.busy||input.dodge||input.dash)return input;
 const p=combat.phaseProgress;
 const scale=combat.phase==='windup'?.3*(1-p):combat.phase==='active'?0:.15+.85*p;
 return {...input,x:input.x*scale,z:input.z*scale};
}

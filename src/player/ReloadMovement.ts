import type {InputFrame} from '../input/InputFrame';
/** Reload occupies the weapons, not locomotion. Block attack intent from cancelling sprint. */
export function reloadMovement(input:InputFrame,reloading:boolean):InputFrame {
 return reloading?{...input,fire:false,charging:false}:input;
}

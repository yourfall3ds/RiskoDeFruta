import {MELEE_TUNING} from '../player/PlayerTuning';
import type {MeleePhase} from '../combat/UnarmedCombat';

/** Blender action names and authored contact frames; no additive bone offsets. */
export const MELEE_CLIPS:Readonly<Record<string,{clip:string;frames:number;contactFrame:number}>>={
 'right-cross':{clip:'ComboRightCross',frames:45,contactFrame:18},
 'left-hook':{clip:'ComboLeftHook',frames:43,contactFrame:17},
 'right-kick':{clip:'ComboRightKick',frames:50,contactFrame:19},
 'uppercut':{clip:'ComboUppercut',frames:50,contactFrame:19},
 'left-kick':{clip:'ComboLeftKick',frames:52,contactFrame:20},
 'spin-kick':{clip:'ComboSpinKick',frames:66,contactFrame:21},
};

/** Damage phase and animation share a clock, including attack-speed bonuses. */
export function meleeClipProgress(id:string,phase:MeleePhase,progress:number):number {
 const spec=MELEE_CLIPS[id],step=MELEE_TUNING.steps.find(s=>s.id===id);
 if(!spec||!step)return 0;
 const p=Math.max(0,Math.min(1,progress));
 const contact=(spec.contactFrame-1)/(spec.frames-1);
 const activeEnd=Math.min(1,contact+step.active*60/(spec.frames-1));
 return phase==='windup'?p*contact:phase==='active'?contact+p*(activeEnd-contact)
  :phase==='recover'?activeEnd+p*(1-activeEnd):0;
}

import type {FlutterBend} from './FreefallFlutter';
import type {MeleePhase} from '../combat/UnarmedCombat';

/**
 * Poses autorais de corpo a corpo, escritas direto nos ossos do rig real
 * (`Hips`, `Spine`, `Spine01`, `Spine02`, `neck`, `*Shoulder`, `*Arm`, `*ForeArm`, `*Hand`,
 * `*UpLeg`, `*Leg`, `*Foot`, `*ToeBase` — os nomes existentes em `gunslinger.glb`).
 *
 * São camadas ADITIVAS sobre o clipe de locomoção, aplicadas pelo mesmo caminho do
 * `freefallFlutter`: o clipe reescreve cada junta no quadro seguinte, então nada acumula e a
 * locomoção, o reset e o dispose continuam intactos.
 *
 * Cada etapa tem três momentos — antecipação (carrega no sentido oposto), impacto (extensão) e
 * recuperação (volta) — e envolve pés, quadril e ombros, não só o braço. Nenhum clipe de tiro é
 * reaproveitado para representar um soco ou um chute.
 *
 * Ângulos em radianos nos eixos do espaço da raiz: 0 = x (direita), 1 = y (cima), 2 = z (frente).
 */
export interface MeleeBonePose {bone:string;axis:0|1|2;
  /** Ângulo no fim da antecipação (corpo carregado). */
  windup:number;
  /** Ângulo no pico do golpe. */
  impact:number;
}

/** Quanto do gesto sobra no fim da recuperação (0 = volta inteira à locomoção). */
const RECOVERY_RESIDUE=0.12;

const CROSS:readonly MeleeBonePose[]=[
  {bone:'Hips',axis:1,windup:.16,impact:-.3},
  {bone:'Spine',axis:1,windup:.2,impact:-.34},
  {bone:'Spine02',axis:1,windup:.12,impact:-.22},
  {bone:'RightShoulder',axis:1,windup:.2,impact:-.36},
  {bone:'RightArm',axis:0,windup:-.5,impact:-1.25},
  {bone:'RightArm',axis:1,windup:.3,impact:-.5},
  {bone:'RightForeArm',axis:0,windup:-1.15,impact:-.16},
  {bone:'RightHand',axis:0,windup:-.2,impact:.08},
  {bone:'LeftArm',axis:0,windup:-.55,impact:-.75},
  {bone:'LeftForeArm',axis:0,windup:-1.3,impact:-1.45},
  {bone:'RightUpLeg',axis:1,windup:.14,impact:-.24},
  {bone:'RightToeBase',axis:1,windup:.1,impact:-.3},
  {bone:'LeftLeg',axis:0,windup:.12,impact:.2},
];

const HOOK:readonly MeleeBonePose[]=[
  {bone:'Hips',axis:1,windup:-.2,impact:.36},
  {bone:'Spine',axis:1,windup:-.26,impact:.42},
  {bone:'Spine02',axis:1,windup:-.14,impact:.26},
  {bone:'LeftShoulder',axis:1,windup:-.24,impact:.4},
  {bone:'LeftArm',axis:1,windup:-.45,impact:.85},
  {bone:'LeftArm',axis:0,windup:-.4,impact:-.8},
  {bone:'LeftForeArm',axis:0,windup:-1.5,impact:-1.1},
  {bone:'LeftHand',axis:1,windup:-.15,impact:.25},
  {bone:'RightArm',axis:0,windup:-.6,impact:-.8},
  {bone:'RightForeArm',axis:0,windup:-1.35,impact:-1.5},
  {bone:'LeftUpLeg',axis:1,windup:-.16,impact:.28},
  {bone:'LeftToeBase',axis:1,windup:-.12,impact:.34},
  {bone:'RightLeg',axis:0,windup:.14,impact:.24},
];

const UPPERCUT:readonly MeleeBonePose[]=[
  {bone:'Hips',axis:0,windup:.2,impact:-.16},
  {bone:'Spine',axis:0,windup:.26,impact:-.3},
  {bone:'Spine01',axis:0,windup:.14,impact:-.2},
  {bone:'neck',axis:0,windup:.1,impact:-.16},
  {bone:'RightShoulder',axis:0,windup:.18,impact:-.3},
  {bone:'RightArm',axis:0,windup:.55,impact:-1.55},
  {bone:'RightForeArm',axis:0,windup:-.9,impact:-1.5},
  {bone:'LeftArm',axis:0,windup:-.5,impact:-.9},
  {bone:'LeftForeArm',axis:0,windup:-1.2,impact:-1.5},
  // Agacha e estende: o impulso sai das pernas.
  {bone:'RightUpLeg',axis:0,windup:.45,impact:-.12},
  {bone:'RightLeg',axis:0,windup:.7,impact:.05},
  {bone:'LeftUpLeg',axis:0,windup:.4,impact:-.1},
  {bone:'LeftLeg',axis:0,windup:.62,impact:.05},
  {bone:'RightFoot',axis:0,windup:-.3,impact:.12},
];

const FRONT_KICK:readonly MeleeBonePose[]=[
  {bone:'Hips',axis:0,windup:-.1,impact:.3},
  {bone:'Spine',axis:0,windup:-.12,impact:.34},
  {bone:'Spine02',axis:0,windup:-.08,impact:.2},
  {bone:'RightUpLeg',axis:0,windup:-.55,impact:-1.5},
  {bone:'RightLeg',axis:0,windup:1.35,impact:.12},
  {bone:'RightFoot',axis:0,windup:.4,impact:-.35},
  {bone:'RightToeBase',axis:0,windup:.2,impact:-.28},
  {bone:'LeftLeg',axis:0,windup:.22,impact:.34},
  {bone:'LeftFoot',axis:0,windup:-.1,impact:-.2},
  // Braços contrabalançam o chute.
  {bone:'RightArm',axis:2,windup:.35,impact:.7},
  {bone:'LeftArm',axis:2,windup:-.3,impact:-.6},
  {bone:'RightForeArm',axis:0,windup:-1.1,impact:-1.25},
  {bone:'LeftForeArm',axis:0,windup:-1.1,impact:-1.3},
];

const SPIN_KICK:readonly MeleeBonePose[]=[
  {bone:'Hips',axis:1,windup:-.5,impact:1.1},
  {bone:'Spine',axis:1,windup:-.34,impact:.72},
  {bone:'Spine02',axis:1,windup:-.2,impact:.4},
  {bone:'neck',axis:1,windup:.3,impact:-.35},
  // Perna de giro sai lateral e alta.
  {bone:'RightUpLeg',axis:1,windup:-.4,impact:.95},
  {bone:'RightUpLeg',axis:2,windup:.15,impact:.9},
  {bone:'RightLeg',axis:0,windup:1.1,impact:.16},
  {bone:'RightFoot',axis:0,windup:.3,impact:-.3},
  {bone:'LeftUpLeg',axis:0,windup:.3,impact:.16},
  {bone:'LeftLeg',axis:0,windup:.42,impact:.3},
  {bone:'LeftToeBase',axis:1,windup:-.3,impact:.6},
  // Braços abertos para o eixo do giro.
  {bone:'RightArm',axis:2,windup:.5,impact:1.05},
  {bone:'LeftArm',axis:2,windup:-.5,impact:-1.05},
  {bone:'RightForeArm',axis:0,windup:-.8,impact:-.55},
  {bone:'LeftForeArm',axis:0,windup:-.9,impact:-.6},
];

export const MELEE_POSES:Readonly<Record<string,readonly MeleeBonePose[]>>={
  'right-cross':CROSS,'left-hook':HOOK,'uppercut':UPPERCUT,'front-kick':FRONT_KICK,'spin-kick':SPIN_KICK,
};

/** Deslocamento da raiz que acompanha a etapa: avanço no soco, giro no chute rodado. */
export interface MeleeRootMotion {
  /** Giro extra em torno de Y, radianos. */
  yaw:number;
  /** Inclinação para frente, radianos. */
  pitch:number;
  /** Rolagem lateral, radianos. */
  roll:number;
}
export interface MeleePose {bends:FlutterBend[];root:MeleeRootMotion}

const ROOT:Readonly<Record<string,MeleeRootMotion>>={
  'right-cross':{yaw:-.16,pitch:.07,roll:.05},
  'left-hook':{yaw:.2,pitch:.06,roll:-.07},
  'uppercut':{yaw:-.07,pitch:-.12,roll:.03},
  'front-kick':{yaw:.05,pitch:-.16,roll:0},
  'spin-kick':{yaw:1.25,pitch:.05,roll:.12},
};

/**
 * Peso da pose no momento atual da etapa.
 *
 * `windup` cresce até 1 no fim da antecipação; `impact` domina na janela ativa e decai na
 * recuperação até sobrar apenas `RECOVERY_RESIDUE`. Como as três fases vêm do `UnarmedCombat`,
 * acelerar a cadência encurta a pose inteira junto com o golpe.
 */
export function meleePoseWeights(phase:MeleePhase,progress:number):{windup:number;impact:number} {
  const p=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0));
  if(phase==='windup')return {windup:p*p*(3-2*p),impact:0};
  // As duas camadas nunca somam mais que 1: senão antecipação e impacto se empilhavam e uma junta
  // chegava a passar de 90°. O pico visual acontece no primeiro quarto da janela ativa.
  if(phase==='active'){const k=Math.min(1,p/.25),s=k*k*(3-2*k);return {windup:1-s,impact:s};}
  if(phase==='recover'){const fade=1-p*p*(3-2*p);return {windup:0,impact:RECOVERY_RESIDUE+(1-RECOVERY_RESIDUE)*fade};}
  return {windup:0,impact:0};
}

/** Pose completa da etapa: curvas nos ossos reais + deslocamento da raiz. */
export function meleePose(stepId:string,phase:MeleePhase,progress:number,strength=1):MeleePose {
  const table=MELEE_POSES[stepId];
  const root=ROOT[stepId]??{yaw:0,pitch:0,roll:0};
  if(!table||phase==='idle')return {bends:[],root:{yaw:0,pitch:0,roll:0}};
  const {windup,impact}=meleePoseWeights(phase,progress);
  const scale=Math.max(0,Math.min(1,strength));
  const bends:FlutterBend[]=table.map(pose=>({
    bone:pose.bone,axis:pose.axis,
    angle:(pose.windup*windup+pose.impact*impact)*scale,
  }));
  return {bends,root:{yaw:root.yaw*impact*scale,pitch:root.pitch*impact*scale,roll:root.roll*impact*scale}};
}

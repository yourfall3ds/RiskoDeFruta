import {ITEMS,type RunProgression} from './RunProgression';

/**
 * Progresso real do modo em curso.
 *
 * Na expedição o que conta são os marcos concluídos, a fase alcançada e o chefe; nas hordas
 * continua valendo `completedWaves`. O relatório de morte lê isto em vez de somar hordas num modo
 * que não tem hordas.
 */
export interface AttemptObjectives {
  mode:'expedition'|'horde'|'classic';
  completed?:number;
  total?:number;
  phase?:'totems'|'boss'|'extract';
  bossDefeated?:boolean;
}

export interface AttemptSummary {time:number;stage:number;kills:number;level:number;wave:number;completedWaves:number;credits:number;objectives:AttemptObjectives;items:{id:string;name:string;icon:number;count:number}[]}

/** Pontos por marco da expedição — mesmo peso que uma horda vencida tinha no modo antigo. */
export const SCORE_PER_MILESTONE=500;
/** Bônus por estágio já atravessado pela fenda. */
export const SCORE_PER_STAGE=1200;
export const SCORE_PER_KILL=100;
export const SCORE_PER_ITEM=75;
/** Bônus de derrotar a Praga Alfa do estágio. */
export const SCORE_BOSS=2500;

/**
 * Pontuação da tentativa, discriminada por origem.
 *
 * Mantém a fórmula antiga (abate, item, segundo vivo) e substitui a contribuição das hordas pelos
 * marcos efetivamente concluídos quando o modo é a expedição. O modo horda legado continua somando
 * `completedWaves`, sem perder nada de quem joga por `?mode=horde`.
 */
export function attemptScore(summary:AttemptSummary):{total:number;kills:number;progress:number;items:number;time:number;boss:number;stage:number;progressLabel:string} {
  const itemCount=summary.items.reduce((total,item)=>total+item.count,0);
  const expedition=summary.objectives.mode==='expedition';
  const milestones=expedition?summary.objectives.completed??0:summary.completedWaves;
  const progress=milestones*SCORE_PER_MILESTONE;
  const stage=Math.max(0,summary.stage-1)*SCORE_PER_STAGE;
  const boss=summary.objectives.bossDefeated?SCORE_BOSS:0;
  const kills=summary.kills*SCORE_PER_KILL,items=itemCount*SCORE_PER_ITEM,time=Math.floor(summary.time);
  return {total:kills+progress+items+time+boss+stage,kills,progress,items,time,boss,stage,
    progressLabel:expedition?'CÁLICE CHEIO':'HORDAS VENCIDAS'};
}

/** Copy the completed attempt before mutable run state is reset. */
export function attemptSummary(run:RunProgression,wave=1,completedWaves=0,objectives:AttemptObjectives={mode:'horde'}):AttemptSummary {
 return {time:run.time,stage:run.stage,kills:run.totalKills,level:run.level,wave,completedWaves,credits:run.credits,objectives,items:[...run.inventory].map(([id,count])=>{const item=ITEMS.find(i=>i.id===id)!;return {id,name:item.name,icon:item.icon,count};})};
}

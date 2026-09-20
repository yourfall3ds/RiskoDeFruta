import type {DamageContext} from '../core/contracts';
/** Shared by articulated and fallback corpses so the launch sound matches actual movement. */
/**
 * Teto da velocidade com que um cadáver é arremessado por explosão, em m/s.
 *
 * Bem acima do chute pesado (10): a onda de choque é o golpe mais violento do jogo e o corpo tem
 * de ATRAVESSAR a tela, não escorregar. O teto existe porque acima disto o cadáver some do campo
 * de visão antes de o jogador registrar que matou alguém.
 */
export const CORPSE_BLAST_SPEED_CAP=26;
/** Elevação do arremesso explosivo. Alta de propósito: explosão joga para CIMA, não para o lado. */
export const CORPSE_BLAST_LIFT=9;

export function corpseLaunch(context:DamageContext):{x:number;y:number;z:number} {
 const heavy=context.damageTags.includes('melee_heavy')&&context.forceMagnitude>=8;
 /**
  * Explosão arremessa de verdade.
  *
  * Antes, estilhaço e míssil caíam no ramo genérico — velocidade 3 e elevação 2,2, ou seja um
  * empurrão mais fraco que o de um soco. O corpo mal saía do lugar, e a arma explosiva não se
  * distinguia da balística nem na morte. É o mesmo remendo que `enemyImpact` levou para os VIVOS,
  * aplicado agora a quem a explosão matou.
  *
  * O eco de proc de item continua de fora: a explosão secundária de uma bomba não é o golpe.
  */
 const blast=context.damageTags.includes('explosive')&&context.procChainDepth===0;
 if(blast){
  const speed=Math.min(CORPSE_BLAST_SPEED_CAP,Math.max(9,context.forceMagnitude*1.9));
  return {x:context.forceDirection.x*speed,y:CORPSE_BLAST_LIFT,z:context.forceDirection.z*speed};
 }
 const speed=heavy?Math.min(10,context.forceMagnitude):3;
 return {x:context.forceDirection.x*speed,y:heavy?4:2.2,z:context.forceDirection.z*speed};
}
export function enemyImpact(context:DamageContext,variant:string,kind:string,cooldown:number):{force:number;stagger:boolean} {
 const regular=context.sourceId==='dual_pistols'||context.procChainDepth>0;
 const melee=!regular&&context.damageTags.includes('melee');
 /**
  * Explosão empurra MUITO mais que bala.
  *
  * Antes, estilhaço de granada, míssil e qualquer explosão caíam no mesmo balde genérico `.65` do
  * tiro pesado — o corpo mal saía do lugar, e a arma explosiva não se distinguia da balística no
  * impacto. Aqui a onda de choque ganha ramo próprio, com o MAIOR teto dos três: é o que faz a
  * lança-granadas e a chuva de mísseis arremessarem a horda em vez de cutucá-la.
  *
  * Continua passando pela `resistance`: chefe e gigante resistem à onda na mesma proporção em que
  * resistem a tudo o mais, senão a explosão viraria o único jeito de mover um chefe.
  *
  * O proc derivado (`procChainDepth > 0`) segue no ramo `regular` mesmo carregando a etiqueta:
  * a explosão secundária de um item não é o golpe, é o eco dele.
  */
 const explosive=!regular&&context.damageTags.includes('explosive');
 // Direct punches move a normal enemy about 0.8 m; kicks/finishers about 1.8–2.2 m.
 // Secondary item procs retain their reduced impulse, even when copied from a melee hit.
 const resistance=kind==='boss'?5:variant==='giant'?3:1;
 const cap=explosive?26:melee?18:10;
 const scale=regular?.18:explosive?1.9:melee?1.6:.65;
 const force=Math.min(cap,context.forceMagnitude*scale)/resistance;
 return {force,stagger:!regular&&force>3&&cooldown<=0};
}

import type {Vec3} from '../core/contracts';

/**
 * QUEM cada inimigo está caçando — e por que isso NÃO é "o vivo mais próximo".
 *
 * `nearestLivingPlayer` como regra única colapsa a horda: com quatro jogadores e trinta corpos,
 * todos convergem para o mesmo alvo a cada tique e a pressão vira uma pilha em cima de um só. Pior,
 * o alvo pisca — dois jogadores que se cruzam em distância parecida trocam o alvo de trinta corpos
 * num quadro, e nenhuma perseguição chega a durar.
 *
 * Por isso o alvo é um ESTADO do inimigo (`targetPlayerId`), adquirido por POLÍTICA do arquétipo,
 * mantido enquanto for válido e invalidado por condições explícitas. "Mais próximo" continua
 * existindo — como política de alguns arquétipos e como candidato inicial das outras —, nunca como
 * a regra do mundo.
 *
 * O alvo é uma ENTRADA da IA, não a ordem "corra reto até ele": cada arquétipo decide sobre ele
 * (perseguir, flanquear, recuar, saltar). Ver `EnemySimulation`.
 */

/**
 * - `NEAREST` — reavalia todo tique. Só para quem deve mesmo grudar no mais perto (nenhum comum).
 * - `RANDOM_LIVING` — sorteia um vivo na aquisição e mantém. Espalha a horda por construção.
 * - `STICKY_NEAREST` — **padrão dos comuns**: escolhe um vivo adequado e SEGURA. Só troca por
 *   condição explícita, nunca porque outro jogador ficou cinco centímetros mais perto.
 * - `THREAT` — quem mais machucou este corpo. Recompensa foco de fogo, como no RoR2.
 * - `DIRECTOR_ASSIGNED` — o alvo vem de fora (evento autorado, chefe); a IA só respeita.
 */
export type TargetPolicy='NEAREST'|'RANDOM_LIVING'|'STICKY_NEAREST'|'THREAT'|'DIRECTOR_ASSIGNED';

/** Sem alvo. Zero nunca é `entityId` de jogador (a faixa é 1..4), então serve de "nenhum". */
export const NO_TARGET=0;

/**
 * Tempo mínimo de posse antes de um `STICKY_NEAREST` sequer CONSIDERAR trocar.
 *
 * É o que compra a vida útil da perseguição: abaixo disto, nenhuma distância troca o alvo.
 */
export const STICKY_LOCK_SECONDS=4;
/**
 * E, passado o travamento, o candidato ainda precisa ser MUITO mais perto para valer a troca.
 *
 * 0,6 = o novo tem de estar a 60% da distância do atual. Dois jogadores lado a lado nunca
 * satisfazem isto, que é exatamente o jitter que se quer matar; um jogador que chega a metade da
 * distância do outro satisfaz, e aí a troca é uma leitura honesta do campo.
 */
export const STICKY_SWITCH_RATIO=.6;

/** O que a política precisa saber de um jogador. `eligible` cobre desconectado/espectador. */
export interface TargetablePlayer {entityId:number;position:Vec3;alive:boolean;eligible:boolean}

/** O estado de alvo que vive NO inimigo e é replicado. */
export interface TargetingState {
  targetPlayerId:number;
  /** Há quanto tempo este alvo é o alvo. Reposto em toda troca. */
  targetLockTime:number;
  /** Relógio da simulação na última troca; diagnóstico e replicação. */
  lastTargetSwitchTime:number;
  /**
   * Jogador que gerou condição de aggro relevante (levou este corpo a um alvo específico).
   * Vence o travamento do `STICKY_NEAREST` — é para isso que ele existe.
   */
  aggroSource:number;
  /** Dano recebido por jogador; alimenta a política `THREAT`. */
  threat:Map<number,number>;
}

export const newTargetingState=():TargetingState=>
  ({targetPlayerId:NO_TARGET,targetLockTime:0,lastTargetSwitchTime:0,aggroSource:NO_TARGET,threat:new Map()});

/** Um jogador só é alvo se está vivo E elegível. Morto não é alvo normal da IA (contrato §18.5). */
export const targetable=(p:TargetablePlayer):boolean=>p.alive&&p.eligible;

/** O vivo mais próximo — candidato e fallback, NUNCA a regra do mundo. Ver o cabeçalho. */
export function nearestLivingPlayer(from:Vec3,players:readonly TargetablePlayer[],distance:(a:Vec3,b:Vec3)=>number):TargetablePlayer|undefined {
  let best:TargetablePlayer|undefined,bestDistance=Number.POSITIVE_INFINITY;
  for(const p of players){
    if(!targetable(p))continue;
    const d=distance(from,p.position);
    if(d<bestDistance){bestDistance=d;best=p;}
  }
  return best;
}

const find=(players:readonly TargetablePlayer[],entityId:number):TargetablePlayer|undefined=>
  players.find(p=>p.entityId===entityId);

/**
 * Por que o alvo atual deixou de servir, ou `''` se ele continua bom.
 *
 * Devolver o MOTIVO e não um booleano é deliberado: é ele que o teste de retarget afirma, e é ele
 * que diz se a troca foi por morte, por elegibilidade ou por decisão do arquétipo.
 */
export function invalidation(state:TargetingState,players:readonly TargetablePlayer[],unreachableFor:number,unreachableLimit:number):string {
  if(state.targetPlayerId===NO_TARGET)return 'sem alvo';
  const current=find(players,state.targetPlayerId);
  if(!current)return 'alvo saiu da corrida';
  if(!current.alive)return 'alvo morreu';
  if(!current.eligible)return 'alvo deixou de ser elegível';
  if(unreachableLimit>0&&unreachableFor>=unreachableLimit)return 'alvo inalcançável';
  return '';
}

export interface AcquireOptions {
  policy:TargetPolicy;
  players:readonly TargetablePlayer[];
  position:Vec3;
  distance:(a:Vec3,b:Vec3)=>number;
  /** Relógio da simulação; escreve `lastTargetSwitchTime`. */
  now:number;
  /** Sorteio 0..1 para `RANDOM_LIVING`. Só o servidor fornece — RNG de gameplay não é do cliente. */
  random:()=>number;
  /** Há quanto tempo o corpo não consegue chegar ao alvo atual. 0 desliga a invalidação por rota. */
  unreachableFor?:number;
  unreachableLimit?:number;
  /** Força a reaquisição: a IA entrou em estado explícito de retarget. */
  forceRetarget?:boolean;
}

/**
 * Aplica a política e devolve o alvo vigente, escrevendo em `state`.
 *
 * A ordem é a do contrato: pegar os vivos → descartar inválidos → avaliar candidatos → selecionar
 * pela política → gravar → **manter**. O caminho comum (alvo válido, política grudenta, sem aggro)
 * sai sem avaliar candidato nenhum: não se reseleciona o alvo inteiro a cada tique.
 */
export function acquireTarget(state:TargetingState,options:AcquireOptions,dt=0):number {
  const {policy,players,position,distance,now,random}=options;
  state.targetLockTime+=dt;
  const reason=invalidation(state,players,options.unreachableFor??0,options.unreachableLimit??0);
  const current=reason?undefined:find(players,state.targetPlayerId);

  // Aggro explícito vence qualquer travamento — é a única coisa que pode.
  if(state.aggroSource!==NO_TARGET){
    const source=find(players,state.aggroSource);
    state.aggroSource=NO_TARGET;
    if(source&&targetable(source))return switchTo(state,source.entityId,now);
  }

  if(current&&!options.forceRetarget){
    // Mantido por construção: `RANDOM_LIVING` e `DIRECTOR_ASSIGNED` nunca reavaliam sozinhas, e
    // `THREAT`/`STICKY_NEAREST` só trocam pela condição própria, abaixo.
    if(policy==='RANDOM_LIVING'||policy==='DIRECTOR_ASSIGNED')return state.targetPlayerId;
    if(policy==='THREAT'){
      const top=topThreat(state,players);
      return top&&top!==state.targetPlayerId?switchTo(state,top,now):state.targetPlayerId;
    }
    if(policy==='STICKY_NEAREST'){
      if(state.targetLockTime<STICKY_LOCK_SECONDS)return state.targetPlayerId;
      const nearest=nearestLivingPlayer(position,players,distance);
      if(!nearest||nearest.entityId===state.targetPlayerId)return state.targetPlayerId;
      // Só troca por uma diferença que um humano enxergaria, nunca por centímetros.
      return distance(position,nearest.position)<distance(position,current.position)*STICKY_SWITCH_RATIO
        ?switchTo(state,nearest.entityId,now):state.targetPlayerId;
    }
    // `NEAREST` é a única que reavalia sempre, e é de propósito que nenhum comum a use.
    const nearest=nearestLivingPlayer(position,players,distance);
    return nearest&&nearest.entityId!==state.targetPlayerId?switchTo(state,nearest.entityId,now):state.targetPlayerId;
  }

  // Aquisição do zero.
  if(policy==='RANDOM_LIVING'){
    const living=players.filter(targetable);
    if(!living.length)return clear(state,now);
    return switchTo(state,living[Math.min(living.length-1,Math.floor(random()*living.length))]!.entityId,now);
  }
  if(policy==='THREAT'){
    const top=topThreat(state,players);
    if(top)return switchTo(state,top,now);
  }
  // Todas as demais (inclusive `DIRECTOR_ASSIGNED` sem designação viva) caem no mais próximo como
  // CANDIDATO INICIAL. Daí em diante quem manda é a política, não a distância.
  const nearest=nearestLivingPlayer(position,players,distance);
  return nearest?switchTo(state,nearest.entityId,now):clear(state,now);
}

function topThreat(state:TargetingState,players:readonly TargetablePlayer[]):number {
  let best=NO_TARGET,score=0;
  for(const [entityId,amount] of state.threat){
    const player=find(players,entityId);
    if(!player||!targetable(player)||amount<=score)continue;
    score=amount;best=entityId;
  }
  return best;
}

function switchTo(state:TargetingState,entityId:number,now:number):number {
  if(state.targetPlayerId!==entityId){state.lastTargetSwitchTime=now;state.targetLockTime=0;}
  state.targetPlayerId=entityId;
  return entityId;
}

function clear(state:TargetingState,now:number):number {
  if(state.targetPlayerId!==NO_TARGET){state.lastTargetSwitchTime=now;state.targetLockTime=0;}
  state.targetPlayerId=NO_TARGET;
  return NO_TARGET;
}

/** Registra dano para a política `THREAT` e para o aggro. Chamado pelo servidor, jamais pelo cliente. */
export function noteThreat(state:TargetingState,attackerEntityId:number,amount:number):void {
  if(attackerEntityId<=0||!(amount>0))return;
  state.threat.set(attackerEntityId,(state.threat.get(attackerEntityId)??0)+amount);
}

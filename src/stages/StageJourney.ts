/**
 * Conclusão do estágio: recolher o suco no cálice, embarcar na nave, viajar e chegar ao bioma
 * seguinte.
 *
 * É uma máquina de estados PURA — não toca cena, áudio, rede nem inventário. Quem a conduz
 * (`PlayerScene`) lê `holdsControl` para congelar o passo fixo inteiro durante a transição, pede o
 * carregamento quando `takeLoadRequest()` devolve `true` e aplica o plano quando `takeArrival()`
 * devolve `true`. Cada um desses portões dispara **uma única vez por viagem**, então nem um estágio
 * é avançado duas vezes nem o plano é aplicado em duplicata quando um quadro repete.
 *
 * Falha de carregamento não perde progresso: a viagem fica em espera, anuncia o erro, conta a
 * tentativa e pede o carregamento de novo. O estágio só avança quando existe plano válido.
 */

export type JourneyPhase='idle'|'harvest'|'board'|'travel'|'arrival'|'done';
/** Sinais para o chamador tocar som e soltar apresentação. Nada aqui produz áudio. */
export type JourneyCue='collect'|'board'|'launch'|'arrive';

/** Recolher o suco no cálice, em segundos. */
export const JOURNEY_HARVEST_SECONDS=1.8;
/** Nave chegando e embarque, em segundos. */
export const JOURNEY_BOARD_SECONDS=2.4;
/** Piso da viagem: mesmo com carregamento instantâneo a transição precisa ser vista. */
export const JOURNEY_MIN_TRAVEL_SECONDS=1.8;
/** Espera antes de tentar carregar o destino de novo depois de uma falha. */
export const JOURNEY_RETRY_SECONDS=3;

export class StageJourney {
  phase:JourneyPhase='idle';
  clock=0;
  /** Mensagem da última falha de carregamento; vazia quando não há falha pendente. */
  error='';
  /** Quantas vezes o destino foi pedido nesta viagem, incluindo a primeira. */
  attempts=0;
  /** Nome legível do bioma de destino, para a interface. */
  destination='';
  /** Estágio em que a viagem começou; o destino é `fromStage + 1`. */
  fromStage=0;

  private routeLoaded=false;
  private loadRequest=false;
  private retryClock=0;
  private advancePending=false;
  private arrivalPending=false;

  get active():boolean {return this.phase!=='idle'&&this.phase!=='done';}
  /**
   * Congela o jogo perigoso: motor, diretor, colisão e rede ficam parados, como na entrada.
   * A chegada NÃO entra aqui porque quem segura o controle nela é a `IntroSequence`.
   */
  get holdsControl():boolean {return this.phase==='harvest'||this.phase==='board'||this.phase==='travel';}
  /** A viagem está parada esperando o destino (carregando ou depois de uma falha). */
  get waiting():boolean {return this.phase==='travel'&&!this.routeLoaded;}
  /** `true` enquanto a falha está anunciada e a nova tentativa ainda não saiu. */
  get failed():boolean {return this.phase==='travel'&&this.error!=='';}
  /** Segundos até a próxima tentativa automática; 0 fora de uma falha. */
  get retryIn():number {return this.failed?Math.max(0,this.retryClock):0;}

  /** Andamento 0..1 da transição inteira, para a barra da interface. */
  get progress():number {
    if(this.phase==='idle')return 0;
    if(this.phase==='done')return 1;
    const harvest=Math.min(1,this.phase==='harvest'?this.clock/JOURNEY_HARVEST_SECONDS:1);
    const board=this.phase==='harvest'?0:Math.min(1,this.phase==='board'?this.clock/JOURNEY_BOARD_SECONDS:1);
    const travel=this.phase==='harvest'||this.phase==='board'?0
      :this.phase==='travel'?Math.min(1,this.routeLoaded?this.clock/JOURNEY_MIN_TRAVEL_SECONDS:.55):1;
    return Math.min(1,harvest*.2+board*.25+travel*.35+(this.phase==='arrival'?.2:0));
  }

  /** Título da etapa, em português, para o cartão de transição. */
  get label():string {
    if(this.phase==='harvest')return 'SUCO RECOLHIDO';
    if(this.phase==='board')return 'EMBARQUE';
    if(this.phase==='travel')return this.error?'FALHA NA ROTA':'EM VIAGEM';
    if(this.phase==='arrival')return 'CHEGADA';
    return '';
  }

  /** Linha de apoio: para onde se vai, o que está acontecendo e o que fazer numa falha. */
  get detail():string {
    if(this.phase==='harvest')return 'O cálice foi esvaziado. Créditos restantes viram XP.';
    if(this.phase==='board')return `A nave de inserção chegou. Destino: ${this.destination}.`;
    if(this.phase==='travel')return this.error
      ?`${this.error} · nova tentativa em ${Math.ceil(this.retryIn)} s · [E] tentar agora · o progresso está guardado`
      :`Rumo a ${this.destination} · tentativa ${this.attempts}`;
    if(this.phase==='arrival')return `${this.destination} · prepare o salto`;
    return '';
  }

  /**
   * Começa a viagem. Devolve `false` se já existe uma em curso — é o portão contra o `E` repetido
   * no cálice concluído.
   */
  begin(stage:number,destination:string):boolean {
    if(this.phase!=='idle')return false;
    this.phase='harvest';this.clock=0;this.error='';this.attempts=0;this.retryClock=0;
    this.routeLoaded=false;this.loadRequest=false;this.arrivalPending=false;
    this.fromStage=Number.isFinite(stage)?Math.floor(stage):1;
    this.destination=destination;
    this.advancePending=true;
    return true;
  }

  update(dt:number,onCue:(cue:JourneyCue)=>void=()=>{}):void {
    if(!Number.isFinite(dt)||dt<0||!this.active)return;
    this.clock+=dt;
    if(this.phase==='harvest'){
      if(this.clock<JOURNEY_HARVEST_SECONDS)return;
      this.phase='board';this.clock-=JOURNEY_HARVEST_SECONDS;onCue('board');
    }
    if(this.phase==='board'){
      if(this.clock<JOURNEY_BOARD_SECONDS)return;
      this.phase='travel';this.clock-=JOURNEY_BOARD_SECONDS;
      this.loadRequest=true;this.attempts++;onCue('launch');
      return;
    }
    if(this.phase!=='travel')return;
    if(this.error){
      this.retryClock-=dt;
      if(this.retryClock<=0){this.error='';this.loadRequest=true;this.attempts++;this.clock=0;}
      return;
    }
    if(!this.routeLoaded||this.clock<JOURNEY_MIN_TRAVEL_SECONDS)return;
    this.phase='arrival';this.clock=0;this.arrivalPending=true;onCue('arrive');
  }

  /** `true` uma única vez por pedido: o chamador deve iniciar (ou repetir) o carregamento agora. */
  takeLoadRequest():boolean {
    if(!this.loadRequest)return false;
    this.loadRequest=false;return true;
  }
  /** O destino está carregado e o plano do próximo estágio é válido. */
  routeReady():void {
    if(this.phase!=='travel')return;
    this.routeLoaded=true;this.error='';this.retryClock=0;
  }
  /** O destino falhou. A viagem espera, anuncia e tenta de novo sem perder nada. */
  routeFailed(message:string):void {
    if(this.phase!=='travel'||this.routeLoaded)return;
    this.error=message||'Falha ao carregar o destino';this.retryClock=JOURNEY_RETRY_SECONDS;
  }
  /**
   * A chegada não pôde ser aplicada (plano perdido entre quadros): volta à viagem e pede o destino
   * de novo. Defensivo — `routeReady` só é chamado com plano em mãos.
   */
  returnToTravel(message:string):void {
    if(this.phase!=='arrival')return;
    this.phase='travel';this.clock=0;this.arrivalPending=false;this.routeLoaded=false;
    this.error=message||'Falha ao aplicar o destino';this.retryClock=JOURNEY_RETRY_SECONDS;
  }
  /** Nova tentativa imediata pedida pelo jogador. */
  retryNow():boolean {
    if(!this.failed)return false;
    this.retryClock=0;return true;
  }

  /** `true` uma única vez por viagem: é aqui que o estágio avança de verdade. */
  consumeAdvance():boolean {
    if(!this.advancePending)return false;
    this.advancePending=false;return true;
  }
  /** `true` uma única vez por viagem: aplicar o plano e começar a sequência de chegada. */
  takeArrival():boolean {
    if(!this.arrivalPending)return false;
    this.arrivalPending=false;return true;
  }
  /** A chegada terminou (queda, impacto e o corpo de pé): o jogo volta ao normal. */
  arrived():void {if(this.phase==='arrival'){this.phase='done';this.clock=0;}}

  reset():void {
    this.phase='idle';this.clock=0;this.error='';this.attempts=0;this.destination='';this.fromStage=0;
    this.routeLoaded=false;this.loadRequest=false;this.retryClock=0;this.advancePending=false;this.arrivalPending=false;
  }
}

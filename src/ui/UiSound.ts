/**
 * A VOZ DA INTERFACE.
 *
 * O jogo tinha som de tiro, de passo, de bicho e de impacto — e silêncio absoluto na interface.
 * Passar o mouse, escolher classe, confirmar: nada. Interface muda não parece "limpa", parece
 * morta, e é metade da razão de um menu passar a sensação de página web.
 *
 * ## Por que SINTETIZADO e não arquivo
 *
 * Nenhum arquivo é baixado. Cada som é montado na hora com dois ou três osciladores e um
 * envelope — o vocabulário de bip filtrado de console de nave. Isso vale por três motivos
 * concretos, não por elegância:
 *
 * 1. **Peso**: o conjunto inteiro custa zero byte de rede. O jogo já carrega dezenas de MB de
 *    modelo e textura; acrescentar um pacote de foley de interface pioraria o carregamento que
 *    o jogador acabou de esperar.
 * 2. **Latência**: som de interface precisa sair no MESMO quadro do clique. Um buffer
 *    sintetizado começa imediatamente, sem depender de decodificação ter terminado.
 * 3. **Variação**: o passar de mouse acontece dezenas de vezes por minuto. Um arquivo fixo vira
 *    tortura auditiva em trinta segundos; aqui cada disparo desafina de propósito, de leve.
 *
 * ## Regras de convivência
 *
 * - O contexto de áudio **só nasce no primeiro gesto do usuário**. Navegador nenhum permite tocar
 *   antes disso, e criar o contexto cedo só produz um objeto suspenso e um aviso no console.
 * - `pointerover` não toca em toque nem quando o ponteiro já está no botão desde antes: é só
 *   movimento de mouse de verdade.
 * - Tudo passa por um ganho mestre baixo. Som de interface que compete com o jogo é defeito.
 * - Um botão pode se calar com `data-quiet`.
 */

type Voz='hover'|'click'|'pick'|'back'|'ready';

/** Receita de cada voz: frequências, duração e timbre. */
const VOZES:Readonly<Record<Voz,{de:number;para:number;dur:number;tipo:OscillatorType;ganho:number;brilho:number}>>={
  /** Passar o mouse: curto, agudo, quase um tique. Tem de ser quase subliminar. */
  hover: {de:1180,para:1460,dur:.055,tipo:'triangle',ganho:.16,brilho:2600},
  /** Clique comum: descida seca. */
  click: {de:880, para:420, dur:.085,tipo:'square',  ganho:.22,brilho:1700},
  /** Escolher classe: subida afirmativa. */
  pick:  {de:520, para:990, dur:.13, tipo:'sawtooth',ganho:.20,brilho:2100},
  /** Voltar: o inverso do escolher. */
  back:  {de:760, para:360, dur:.11, tipo:'triangle',ganho:.18,brilho:1400},
  /** PRONTO: o mais cheio dos cinco, com uma quinta por cima. */
  ready: {de:440, para:880, dur:.22, tipo:'sawtooth',ganho:.26,brilho:2400},
};

export class UiSound {
  private contexto:AudioContext|undefined;
  private mestre:GainNode|undefined;
  private ultimoHover=0;
  private volume=.55;

  /** `false` desliga sem destruir nada — o controle de som do menu chega aqui. */
  setVolume(valor:number):void {
    this.volume=Math.max(0,Math.min(1,valor));
    if(this.mestre)this.mestre.gain.value=this.volume;
  }

  /**
   * Liga a interface inteira de uma vez, por delegação no `document`.
   *
   * Delegação e não um ouvinte por botão: os botões do menu nascem, morrem e são MOVIDOS entre
   * telas (ver `MenuShell`), e o painel de diagnóstico cria oitenta de uma vez. Um ouvinte por
   * elemento significaria religar tudo a cada mudança de tela e vazar ouvintes nos que somem.
   */
  attach(raiz:Document|HTMLElement=document):void {
    raiz.addEventListener('pointerover',event=>{
      const alvo=this.botao(event);
      if(!alvo||(event as PointerEvent).pointerType!=='mouse')return;
      // Um tique por 60 ms no máximo: atravessar uma pilha de botões não pode virar metralhadora.
      const agora=performance.now();
      if(agora-this.ultimoHover<60)return;
      this.ultimoHover=agora;
      this.tocar('hover');
    },{passive:true});

    raiz.addEventListener('pointerdown',event=>{
      const alvo=this.botao(event);
      if(!alvo)return;
      this.tocar(this.vozDe(alvo));
    },{passive:true});
  }

  /** Qual voz este botão tem. Sai da função do botão, não da aparência. */
  private vozDe(botao:HTMLElement):Voz {
    if(botao.classList.contains('rdf-menu-ready'))return 'ready';
    if(botao.classList.contains('rdf-menu-back'))return 'back';
    if(botao.classList.contains('class-option'))return 'pick';
    return 'click';
  }

  private botao(event:Event):HTMLElement|undefined {
    const alvo=(event.target as HTMLElement|null)?.closest<HTMLElement>('button,a[href],summary');
    if(!alvo||alvo.hasAttribute('data-quiet'))return undefined;
    if(alvo instanceof HTMLButtonElement&&alvo.disabled)return undefined;
    return alvo;
  }

  private garantirContexto():boolean {
    if(this.contexto)return this.contexto.state!=='closed';
    const Fabrica=window.AudioContext??(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
    if(!Fabrica)return false;
    try{
      this.contexto=new Fabrica();
      this.mestre=this.contexto.createGain();
      this.mestre.gain.value=this.volume;
      this.mestre.connect(this.contexto.destination);
      return true;
    }catch{return false;}
  }

  /**
   * Monta e dispara uma voz.
   *
   * O envelope usa `exponentialRampToValueAtTime` porque rampa LINEAR até zero produz um clique
   * audível na ponta — o próprio corte vira um estalo. Por isso o alvo é 0,0001 e não 0.
   */
  tocar(voz:Voz):void {
    if(this.volume<=0||!this.garantirContexto())return;
    const ctx=this.contexto!,mestre=this.mestre!;
    if(ctx.state==='suspended')void ctx.resume();
    const receita=VOZES[voz],t=ctx.currentTime;
    // Desafinação de ±1,5%: o mesmo som duas vezes seguidas nunca é exatamente o mesmo.
    const desvio=1+(Math.random()-.5)*.03;

    const filtro=ctx.createBiquadFilter();
    filtro.type='lowpass';
    filtro.frequency.value=receita.brilho;
    filtro.Q.value=.9;

    const envelope=ctx.createGain();
    envelope.gain.setValueAtTime(.0001,t);
    envelope.gain.exponentialRampToValueAtTime(receita.ganho,t+.008);
    envelope.gain.exponentialRampToValueAtTime(.0001,t+receita.dur);

    const osc=ctx.createOscillator();
    osc.type=receita.tipo;
    osc.frequency.setValueAtTime(receita.de*desvio,t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40,receita.para*desvio),t+receita.dur);
    osc.connect(filtro);filtro.connect(envelope);envelope.connect(mestre);
    osc.start(t);osc.stop(t+receita.dur+.02);

    // A quinta por cima, só no PRONTO: é o que faz o som soar como confirmação e não como clique.
    if(voz==='ready'){
      const alto=ctx.createOscillator();
      const altoGanho=ctx.createGain();
      alto.type='triangle';
      alto.frequency.setValueAtTime(receita.de*1.5*desvio,t);
      alto.frequency.exponentialRampToValueAtTime(receita.para*1.5*desvio,t+receita.dur);
      altoGanho.gain.setValueAtTime(.0001,t);
      altoGanho.gain.exponentialRampToValueAtTime(receita.ganho*.45,t+.02);
      altoGanho.gain.exponentialRampToValueAtTime(.0001,t+receita.dur);
      alto.connect(altoGanho);altoGanho.connect(mestre);
      alto.start(t);alto.stop(t+receita.dur+.02);
    }
  }

  dispose():void {
    void this.contexto?.close();
    this.contexto=undefined;this.mestre=undefined;
  }
}

/** Instância única: a interface é uma só. */
export const uiSound=new UiSound();

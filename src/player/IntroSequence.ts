import type {Vec3} from '../core/contracts';
import {MeteorArrival,DESCENT_START_HEIGHT,flightPoint} from './MeteorArrival';

/**
 * Entrada cinematográfica completa: espera no deck aberto da nave → corrida → salto pela borda →
 * mergulho de cabeça → impacto → recuperação do corpo → levantar → controle liberado.
 *
 * **Apresentação pura.** Nada aqui toca o `PlayerMotor`, o diretor, a rede ou o passo fixo: a classe
 * só devolve onde desenhar o corpo, qual clipe amostrar e onde colocar a câmera. O mergulho e a
 * recuperação continuam sendo o `MeteorArrival` original (com as correções dele preservadas) — a
 * entrada apenas ACRESCENTA o prólogo no deck em vez de substituir a queda por um teleporte.
 *
 * Todo estado vive em campos simples e `reset()`/`abort()` devolvem tudo ao repouso, então reiniciar,
 * cancelar ou pular nunca deixa corpo suspenso, câmera presa ou controle liberado fora de hora.
 */

/** Corrida no deck, em segundos. */
export const INTRO_RUN_SECONDS=1.5;
/** Salto pela borda até o corpo entrar em queda livre, em segundos. */
export const INTRO_LEAP_SECONDS=.55;
/** Distância percorrida no deck, em metros. O deck autoral tem 18 m, então sobra pista atrás. */
export const INTRO_RUN_DISTANCE=9.2;
/** Avanço do salto, da borda até o topo da trajetória de queda. */
export const INTRO_LEAP_DISTANCE=3.4;
/** Altura do arco do salto sobre o nível do deck. */
export const INTRO_LEAP_RISE=1.3;
/** Passos audíveis durante a corrida no deck. */
export const INTRO_RUN_STEPS=6;
/** Intervalo entre rajadas de vento durante a queda. */
export const INTRO_WIND_INTERVAL=.85;
/**
 * Altura da superfície pisável acima da chapa do deck, medida no GLB autoral.
 *
 * Os frisos antiderrapantes, a faixa de perigo e as guias da boca ficam TODOS neste mesmo plano —
 * a asserção de build em `scripts/build-dropship-deck.py` garante isso. A primeira versão tinha
 * friso de 8,5 cm e esta constante em 4 cm, então na pose de espera o corpo ficava visivelmente
 * pairando sobre a chapa. QA do Codex: "feet floating above deck".
 */
export const DECK_TREAD_HEIGHT=.008;
/**
 * Profundidade da sola abaixo da origem da raiz em cada clipe, medida quadro a quadro na superfície
 * já deformada do `gunslinger.glb`, rodando a própria entrada. O clipe `Run` afunda **9,2 cm** no
 * pior quadro: no terreno isso passa, mas numa chapa de metal a poucos metros da câmera o pé
 * atravessaria o piso. A entrada compensa com esta folga.
 *
 * A primeira medição usou 61 amostras uniformes do clipe e achou 7,1 cm — a mistura de estados e a
 * cadência real caem entre essas amostras e chegam mais fundo. Os valores abaixo vêm da sequência
 * rodando de verdade; `tests/intro-presentation.test.ts` refaz a medida a cada execução.
 */
export const CLIP_SOLE:Readonly<Record<string,number>>={Idle:.027,Run:-.092,JumpRise:.007};
/** Folga vertical do corpo para a sola assentar no topo da nervura. */
export const deckClearance=(clip:string):number=>DECK_TREAD_HEIGHT-(CLIP_SOLE[clip]??0);

export type IntroPhase='idle'|'standby'|'run'|'leap'|'dive'|'recover'|'done';
export type IntroCue='step'|'launch'|'wind'|'impact'|'rise';

/** Pose de apresentação do corpo neste quadro. */
export interface IntroBodyPose {
  phase:IntroPhase;
  position:Vec3;
  yaw:number;
  /** Inclinação para frente em radianos; `Math.PI` é o mergulho de cabeça. */
  pitch:number;
  roll:number;
  /** Clipe do rig a amostrar quando o corpo está no deck ou no salto. */
  clip:'Idle'|'Run'|'JumpRise';
  clipProgress:number;
  /**
   * Presente só no prólogo do deck (espera, corrida, salto). É o que o `CharacterVisual` usa para
   * trocar o clipe e a orientação; ausente, o corpo volta a ser exatamente o mergulho original.
   */
  stride?:{clip:string;progress:number;yaw:number;pitch:number;roll:number};
  /** Peso do `freefallFlutter`; só vale no salto (a queda usa o peso do `MeteorArrival`). */
  flutter:number;
  flutterTime:number;
}

/** Enquadramento da entrada. `weight` 0 devolve a câmera de jogo sem corte. */
export interface IntroShot {position:Vec3;target:Vec3;weight:number;sprint:number}

const clamp01=(n:number)=>Math.max(0,Math.min(1,Number.isFinite(n)?n:0));
const smooth=(n:number)=>{const t=clamp01(n);return t*t*(3-2*t);};

/**
 * Contrapeso de quem está de pé numa plataforma que balança.
 *
 * `liftRate` é a velocidade vertical da nave. Subindo, o corpo cede nos joelhos e atrasa; descendo,
 * estica e joga o peso à frente — é o mesmo reflexo de quem viaja em pé num barco. O deslocamento
 * lateral tem período próprio, mais lento que a respiração, para a correção não virar tremor.
 *
 * Os limites são pequenos de propósito: a nave oscila 16 cm e ninguém cambaleia por isso. O que o
 * olho lê é que o corpo REAGE à plataforma, em vez de estar colado numa altura fixa.
 */
export function balanceSway(liftRate:number,clock:number):{crouch:number;pitch:number;roll:number;shift:number}{
  const rate=Number.isFinite(liftRate)?Math.max(-1,Math.min(1,liftRate)):0;
  const t=Number.isFinite(clock)?clock:0;
  return {
    /** Joelho cedendo contra a subida da chapa, em metros. */
    crouch:-rate*.052,
    /** Peso à frente quando a nave desce. */
    pitch:rate*.036+Math.sin(t*.63)*.006,
    /** Correção lateral lenta, com período próprio. */
    roll:Math.sin(t*.47+1.3)*.021-rate*.018,
    /** Passo de ajuste dos pés, em metros. */
    shift:Math.sin(t*.47+1.3)*.024,
  };
}
const add=(a:Vec3,b:Vec3,k=1):Vec3=>({x:a.x+b.x*k,y:a.y+b.y*k,z:a.z+b.z*k});

export class IntroSequence {
  /** Mergulho e recuperação originais; a entrada integra, não substitui. */
  readonly flight=new MeteorArrival();
  phase:IntroPhase='idle';
  /** Relógio da fase atual. */
  clock=0;
  /**
   * Relógio livre da espera no deck. Continua correndo do menu para a corrida, então a pose de
   * espera não dá salto no instante em que o jogador aperta Jogar.
   */
  standbyClock=0;
  /** `true` quando a entrada terminou porque o jogador pulou. */
  skipped=false;
  /**
   * Voo estacionário da nave neste quadro, vindo de `DropshipDeck.motion`.
   *
   * Sem isto o corpo ficava numa altura fixa enquanto a chapa oscilava 16 cm sob ele — metade do
   * ciclo afundado, metade pairando. Somar a flutuação aqui é o que coloca o personagem **em cima**
   * do deck de verdade; `liftRate` ainda alimenta o contrapeso da pose de equilíbrio.
   */
  deckMotion={lift:0,roll:0,liftRate:0};
  private steps=0;
  private windClock=0;

  /** A entrada está desenhando o corpo (inclui a espera no menu). */
  get visible():boolean {return this.phase!=='idle'&&this.phase!=='done';}
  /** A entrada ainda segura o controle: motor, diretor e rede continuam parados. */
  get holdsControl():boolean {return this.phase==='run'||this.phase==='leap'||this.phase==='dive'||this.phase==='recover';}
  /** A espera antes do Jogar, com o corpo no deck. */
  get standby():boolean {return this.phase==='standby';}
  /** Já houve uma entrada nesta tentativa (não repetir ao voltar da pausa). */
  get consumed():boolean {return this.phase==='done';}

  /** A nave ainda deve aparecer: some assim que o corpo se afasta o bastante na queda. */
  get deckVisible():boolean {return this.visible&&this.flight.height>60;}
  /** Tempo total desde o Jogar, somando prólogo e queda. */
  get elapsed():number {
    if(this.phase==='idle'||this.phase==='standby')return 0;
    if(this.phase==='run')return this.clock;
    if(this.phase==='leap')return INTRO_RUN_SECONDS+this.clock;
    return INTRO_RUN_SECONDS+INTRO_LEAP_SECONDS+this.flight.elapsed;
  }
  /** Dissolução do cartão do menu: acompanha a arrancada no deck, não a queda. */
  get reveal():number {return this.phase==='idle'||this.phase==='standby'?0:smooth(this.elapsed/.85);}
  /** Duração total da entrada completa, para o rótulo do controle de pular. */
  get duration():number {return INTRO_RUN_SECONDS+INTRO_LEAP_SECONDS+this.flight.duration;}

  /** Menu vivo: o corpo aparece de pé no deck da nave. */
  beginStandby():void {
    if(this.phase!=='idle')return;
    this.phase='standby';this.clock=0;this.skipped=false;
  }
  /**
   * Jogar: começa a corrida pelo deck a partir do mesmo relógio da espera.
   *
   * `prologue=false` entra direto no mergulho — é o caminho de degradação quando o GLB da nave não
   * carregou. Sem deck visível, correr no vazio seria pior que a queda original.
   */
  start(prologue=true):void {
    if(this.holdsControl)return;
    this.clock=0;this.steps=0;this.windClock=0;this.skipped=false;
    this.flight.start(this.standbyClock);
    // Durante a corrida e o salto o relógio da queda fica parado: o corpo ainda está no deck.
    this.phase=prologue?'run':'dive';
  }
  /**
   * Pula o restante da entrada: o corpo termina de pé no ponto de pouso, sem nada suspenso.
   * O impacto e o levantar continuam sendo anunciados, então nenhum som fica pela metade.
   */
  skip(onCue?:(cue:IntroCue)=>void):void {
    if(!this.holdsControl)return;
    const landed=this.flight.impact;
    this.flight.start(this.standbyClock);
    this.flight.update(this.flight.duration,()=>{});
    // Quem pula antes do chão ainda ouve e vê o impacto: a chegada nunca fica sem resolução.
    if(!landed)onCue?.('impact');
    this.finish();
    this.skipped=true;
  }
  /** Encerramento limpo usado pelo fim natural, pelo pulo e pelos saltos de QA. */
  private finish():void {
    this.phase='done';this.clock=0;this.flight.active=false;this.windClock=0;
  }
  /** Cancelamento duro (teleporte de QA, morte, troca de região): nada fica no ar. */
  abort():void {if(this.phase!=='idle')this.finish();}
  /** Nova tentativa: a entrada volta a ser possível do zero. */
  reset():void {
    this.phase='idle';this.clock=0;this.standbyClock=0;this.steps=0;this.windClock=0;this.skipped=false;
    this.flight.start();this.flight.active=false;
  }

  /**
   * Avança a entrada. `dt` é o tempo real de apresentação (a lentidão de finalização não entra aqui).
   * Devolve os sinais do quadro para o chamador tocar som e soltar VFX.
   */
  update(dt:number,onCue:(cue:IntroCue)=>void=()=>{}):void {
    if(!Number.isFinite(dt)||dt<0)return;
    if(this.phase==='idle'||this.phase==='done')return;
    if(this.phase==='standby'){this.standbyClock+=dt;return;}
    this.standbyClock+=dt;this.clock+=dt;
    if(this.phase==='run'){
      const wanted=Math.min(INTRO_RUN_STEPS,Math.floor(this.clock/INTRO_RUN_SECONDS*INTRO_RUN_STEPS)+1);
      while(this.steps<wanted){this.steps++;onCue('step');}
      if(this.clock>=INTRO_RUN_SECONDS){this.phase='leap';this.clock-=INTRO_RUN_SECONDS;onCue('launch');}
      if(this.phase!=='leap')return;
    }
    if(this.phase==='leap'){
      if(this.clock<INTRO_LEAP_SECONDS)return;
      this.phase='dive';this.clock-=INTRO_LEAP_SECONDS;this.windClock=0;
      // O mergulho recebe o tempo excedente do salto para não perder um quadro na troca.
      const carry=this.clock;this.clock=0;
      if(carry>0)this.advanceFlight(carry,onCue);
      return;
    }
    this.advanceFlight(dt,onCue);
  }

  private advanceFlight(dt:number,onCue:(cue:IntroCue)=>void):void {
    const before=this.flight.recovery;
    this.flight.update(dt,()=>onCue('impact'));
    if(this.flight.height>0){
      this.windClock+=dt;
      while(this.windClock>=INTRO_WIND_INTERVAL){this.windClock-=INTRO_WIND_INTERVAL;onCue('wind');}
      this.phase='dive';
    } else {
      this.phase='recover';
      if(before<.34&&this.flight.recovery>=.34)onCue('rise');
    }
    if(!this.flight.active&&this.flight.recovery>=1)this.finish();
  }

  /** Topo da trajetória: onde o salto termina e o mergulho começa. É a âncora do deck. */
  diveTop(landing:Vec3,yaw:number):Vec3 {return flightPoint(landing,yaw,DESCENT_START_HEIGHT);}
  /** Borda aberta do deck, de onde o corpo salta. */
  deckEdge(landing:Vec3,yaw:number):Vec3 {
    const top=this.diveTop(landing,yaw);
    return {x:top.x-Math.sin(yaw)*INTRO_LEAP_DISTANCE,y:top.y,z:top.z-Math.cos(yaw)*INTRO_LEAP_DISTANCE};
  }
  /** Ponto de espera no deck, atrás da borda. */
  deckStart(landing:Vec3,yaw:number):Vec3 {
    const edge=this.deckEdge(landing,yaw);
    return {x:edge.x-Math.sin(yaw)*INTRO_RUN_DISTANCE,y:edge.y,z:edge.z-Math.cos(yaw)*INTRO_RUN_DISTANCE};
  }

  /** Pose do corpo neste quadro, já no espaço do mundo. */
  pose(landing:Vec3,yaw:number):IntroBodyPose|undefined {
    const pose=this.bodyPose(landing,yaw);
    if(pose&&(pose.phase==='standby'||pose.phase==='run'||pose.phase==='leap'))
      pose.stride={clip:pose.clip,progress:pose.clipProgress,yaw:pose.yaw,pitch:pose.pitch,roll:pose.roll};
    return pose;
  }

  private bodyPose(landing:Vec3,yaw:number):IntroBodyPose|undefined {
    if(!this.visible)return undefined;
    const forward={x:Math.sin(yaw),y:0,z:Math.cos(yaw)};
    const start=this.deckStart(landing,yaw);
    if(this.phase==='standby'){
      // Espera no deck de uma nave em voo: o corpo sobe e desce COM a chapa e se equilibra nela.
      // A respiração continua; o que entra é o contrapeso, proporcional à subida da nave.
      const {lift,roll,liftRate}=this.deckMotion;
      const balance=balanceSway(liftRate,this.standbyClock);
      return {phase:this.phase,position:{x:start.x+balance.shift*Math.cos(yaw),y:start.y+lift+deckClearance('Idle')+balance.crouch,z:start.z-balance.shift*Math.sin(yaw)},yaw,
        pitch:balance.pitch,roll:roll+Math.sin(this.standbyClock*1.1)*.012+balance.roll,clip:'Idle',
        clipProgress:(this.standbyClock*.34)%1,flutter:0,flutterTime:this.standbyClock};
    }
    if(this.phase==='run'){
      const t=clamp01(this.clock/INTRO_RUN_SECONDS);
      // Arranque real: a velocidade cresce até a borda em vez de frear no fim.
      const travelled=INTRO_RUN_DISTANCE*(.45*t+.55*t*t);
      const body=add(start,forward,travelled);
      // A folga entra MAIS RÁPIDO que a mistura de clipes (0,15 s): assim a sola já subiu quando o
      // `Run` começa a pesar na pose, em vez de o pé raspar a chapa nos primeiros quadros.
      // A chapa continua oscilando enquanto ele corre sobre ela: a corrida acompanha a nave.
      body.y+=this.deckMotion.lift+deckClearance('Idle')+(deckClearance('Run')-deckClearance('Idle'))*smooth(this.clock/.08);
      // O contrapeso da espera não some no quadro do Jogar: ele se dissolve durante a arrancada.
      // Zerá-lo de uma vez abria um degrau entre a última pose parada e a primeira em movimento —
      // é exatamente a continuidade que `tests/intro-sequence.test.ts` mede.
      const settle=1-smooth(this.clock/.35);
      if(settle>0){
        const balance=balanceSway(this.deckMotion.liftRate,this.standbyClock);
        body.x+=balance.shift*Math.cos(yaw)*settle;
        body.z-=balance.shift*Math.sin(yaw)*settle;
        body.y+=balance.crouch*settle;
      }
      return {phase:this.phase,position:body,yaw,
        pitch:-.07-.08*t,roll:Math.sin(this.clock*16)*.035,clip:'Run',
        clipProgress:(this.clock*2.1)%1,flutter:0,flutterTime:this.standbyClock};
    }
    if(this.phase==='leap'){
      const t=clamp01(this.clock/INTRO_LEAP_SECONDS);
      const edge=this.deckEdge(landing,yaw);
      const travelled=INTRO_LEAP_DISTANCE*t*(1.25-.25*t);
      const body=add(edge,forward,travelled);
      // A folga do deck e a flutuação da nave se dissolvem durante o salto: no fim o corpo está
      // exatamente no topo da queda, que é âncora fixa e não pode herdar o balanço da plataforma.
      body.y+=(deckClearance('Run')+this.deckMotion.lift)*(1-smooth(t/.35));
      body.y+=INTRO_LEAP_RISE*Math.sin(Math.PI*t);
      // Vira de cabeça para baixo já no ar: a queda continua exatamente nesta orientação.
      return {phase:this.phase,position:body,yaw,pitch:Math.PI*smooth((t-.3)/.7),
        roll:Math.sin(t*Math.PI)*.09,clip:'JumpRise',clipProgress:Math.min(.62,.1+t*.7),
        flutter:smooth((t-.45)/.55),flutterTime:this.flight.clock};
    }
    // Mergulho e recuperação: o corpo é inteiramente do `MeteorArrival` preservado.
    const point=this.flight.position(landing,yaw);
    return {phase:this.phase,position:point,yaw,pitch:Math.PI*this.flight.dive,roll:this.flight.sway,
      clip:'Idle',clipProgress:0,flutter:this.flight.flutter,flutterTime:this.flight.clock};
  }

  /**
   * Enquadramento da entrada. `weight` cai a zero na recuperação, então a câmera volta sozinha ao
   * jogo — nunca fica presa numa pose de cinemática.
   *
   * A corrida é vista de trás e de lado, com a saída aberta no quadro; o salto abre para a lateral e
   * mira entre o corpo e o destino, dando contexto de onde a queda vai terminar.
   */
  shot(landing:Vec3,yaw:number):IntroShot|undefined {
    const pose=this.pose(landing,yaw);
    if(!pose)return undefined;
    const forward={x:Math.sin(yaw),y:0,z:Math.cos(yaw)},right={x:Math.cos(yaw),y:0,z:-Math.sin(yaw)};
    const body=pose.position;
    if(pose.phase==='standby'){
      const position=add(add(body,forward,3.0),right,-1.05);position.y+=1.02;
      const target=add(body,right,-.34);target.y+=1.06;
      return {position,target,weight:1,sprint:0};
    }
    if(pose.phase==='run'){
      const t=clamp01(this.clock/INTRO_RUN_SECONDS);
      // Gira de frente para trás enquanto o corpo dispara: termina atrás do ombro, com a boca à vista.
      const position=add(add(body,forward,3.0-7.4*smooth(t)),right,-1.05+2.3*smooth(t));position.y+=1.02+1.0*smooth(t);
      const target=add(body,forward,1.4+5.0*smooth(t));target.y+=1.15-.35*smooth(t);
      return {position,target,weight:1,sprint:smooth(t)};
    }
    if(pose.phase==='leap'){
      const t=clamp01(this.clock/INTRO_LEAP_SECONDS);
      const position=add(add(body,forward,-3.2+1.0*t),right,2.6+1.4*t);position.y+=1.5-2.4*t;
      // O alvo desce do corpo para o destino: o jogador vê onde vai cair antes de a queda começar.
      const destination={x:landing.x,y:landing.y,z:landing.z};
      const blend=smooth((t-.35)/.65);
      const target={x:body.x+(destination.x-body.x)*blend*.22,y:body.y+(destination.y-body.y)*blend*.22+1.1*(1-blend),z:body.z+(destination.z-body.z)*blend*.22};
      return {position,target,weight:1,sprint:1-t*.5};
    }
    // Queda: perseguição atrás e acima; recuperação devolve o controle da câmera ao jogo.
    const recovery=this.flight.recovery;
    const weight=1-smooth((recovery-.12)/.72);
    const position=add(add(body,forward,-3.8),{x:0,y:1,z:0},1);
    const target={x:body.x,y:body.y+(this.flight.dive>0?-.8:1),z:body.z};
    return {position,target,weight,sprint:Math.max(0,this.flight.flutter)};
  }
}

/**
 * Passos medidos nos CLIPES REAIS, não em senoides.
 *
 * Carrega `public/models/gunslinger.glb` num `NullEngine`, dirige o `CharacterVisual` de verdade
 * (mesma máquina de estados, mesmo blend direcional, mesma escala de relógio por velocidade) e passa
 * a altura do osso pelo `FootstepSync` que o jogo usa. É o teste que faltava: o antigo dizia
 * "funciona igual em frente, trás e lateral" apenas trocando a duração de uma senoide, então não
 * teria como perceber que `WalkBackward` e os strafes sobem o pé só até 15,7 cm e ficavam mudos.
 *
 * LIMITE HONESTO: isto mede o CONTATO DO OSSO. Não mede sincronia percebida, mixagem, nem se o som
 * escolhido combina com a superfície — isso continua sendo QA visual/áudio no jogo.
 */
import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {FootstepSync,type FootSide} from '../src/animation/FootstepSync';
import {loadLocomotionRig,HEADINGS,GAITS,type LocomotionRig,type Heading,type Gait,type Stride} from './support/locomotion-rig';

const DT=1/60;
let rig:LocomotionRig;
beforeAll(async()=>{rig=await loadLocomotionRig();},60_000);
afterAll(()=>rig?.dispose());

interface Run {hits:{time:number;side:FootSide}[];peak:number;floor:number;sync:FootstepSync}
/** Dirige o rig por `seconds` e devolve os apoios detectados. O aquecimento tira o blend de entrada. */
function drive(stride:Stride,speed:number,seconds:number,{dt=DT,warmup=.6,sync=new FootstepSync(),muted=false}={}):Run{
  rig.visual.resetAttempt();sync.reset();sync.muted=muted;
  const hits:Run['hits']=[];let peak=0,floor=Infinity,time=0;
  for(let frame=0;frame<Math.round((seconds+warmup)/dt);frame++){
    const heights=rig.step(dt,stride);time+=dt;
    const warming=time<warmup;
    sync.update(dt,[{side:0,height:heights.right},{side:1,height:heights.left}],stride.grounded??true,speed,
      side=>{if(!warming)hits.push({time:time-warmup,side});});
    if(warming)continue;
    peak=Math.max(peak,heights.right,heights.left);floor=Math.min(floor,heights.right,heights.left);
  }
  return {hits,peak,floor,sync};
}
const velocity=(heading:Heading,gait:Gait):Stride=>
  ({vx:HEADINGS[heading].x*GAITS[gait],vz:HEADINGS[heading].z*GAITS[gait]});

describe('passos nos clipes reais do gunslinger',()=>{
  it('o rig traz os clipes de locomoção que o jogo pede',()=>{
    for(const clip of ['Idle','Walk','Run','WalkBackward','RunBackward','StrafeLeft','StrafeRight','RunStrafeLeft','RunStrafeRight'])
      expect(rig.clips,`clipe ${clip}`).toContain(clip);
  });

  // Frente, trás e os dois lados, andando e correndo. As diagonais longitudinais entram junto; as
  // diagonais de ANDAR ficam de fora de propósito (ver o teste de limitação, mais abaixo).
  const covered:[Gait,Heading][]=[];
  for(const gait of ['walk','run'] as Gait[])
    for(const heading of ['forward','backward','left','right'] as Heading[])covered.push([gait,heading]);
  for(const heading of ['forward-left','forward-right','backward-left','backward-right'] as Heading[])covered.push(['run',heading]);
  for(const heading of ['backward-left','backward-right'] as Heading[])covered.push(['walk',heading]);

  for(const [gait,heading] of covered){
    it(`${gait} ${heading}: os dois pés alternam, um passo por apoio`,()=>{
      const {hits,peak,floor,sync}=drive(velocity(heading,gait),GAITS[gait],4);
      // Cadência plausível: entre 1,5 e 5 apoios por segundo cobre do andar mais lento ao correr.
      expect(hits.length/4,'apoios por segundo').toBeGreaterThan(1.5);
      expect(hits.length/4,'apoios por segundo').toBeLessThan(5);
      // Alternância perfeita é o sinal de que cada apoio é UM apoio: pé repetido significa
      // mergulho falso contado duas vezes, que era o que acontecia no `Walk`.
      for(let i=1;i<hits.length;i++)expect(hits[i]!.side,`apoio ${i} repetiu o pé`).not.toBe(hits[i-1]!.side);
      // E nenhum apoio real foi barrado pelo intervalo mínimo.
      expect(sync.crowded,'apoios barrados').toBe(0);
      // A curva do osso realmente cruza os dois limiares — a detecção não passou por sorte.
      expect(peak,'pico da passada').toBeGreaterThan(sync.liftHeight);
      expect(floor,'platô de apoio').toBeLessThan(sync.contactHeight);
    });
  }

  it('correr entrega mais passos por segundo que andar, no mesmo rumo',()=>{
    for(const heading of ['forward','backward','left','right'] as Heading[]){
      const walking=drive(velocity(heading,'walk'),GAITS.walk,4).hits.length;
      const running=drive(velocity(heading,'run'),GAITS.run,4).hits.length;
      expect(running,`${heading}: correr deveria pisar mais`).toBeGreaterThan(walking);
    }
  });

  it('mudar de ritmo no meio da corrida acompanha sem passo fantasma nem silêncio',()=>{
    // Anda 2 s, corre 2 s, anda 2 s — tudo com o MESMO detector, sem reset entre as fases.
    rig.visual.resetAttempt();
    const sync=new FootstepSync();const phases=[0,0,0];const hits:{time:number;side:FootSide}[]=[];
    let time=0;
    for(const [index,speed] of [GAITS.walk,GAITS.run,GAITS.walk].entries()){
      for(let frame=0;frame<Math.round(2/DT);frame++){
        const h=rig.step(DT,{vx:0,vz:speed});time+=DT;
        sync.update(DT,[{side:0,height:h.right},{side:1,height:h.left}],true,speed,side=>{phases[index]!++;hits.push({time,side});});
      }
    }
    expect(time).toBeCloseTo(6,5);
    // Nenhuma fase fica muda e nada é barrado: a cadência acompanha o ritmo sozinha.
    for(const count of phases)expect(count).toBeGreaterThan(3);
    expect(sync.crowded).toBe(0);
    // Nenhuma rajada: dois apoios nunca colam.
    for(let i=1;i<hits.length;i++)expect(hits[i]!.time-hits[i-1]!.time,`apoios ${i-1} e ${i} colados`).toBeGreaterThan(.09);
    // Fora das transições os pés alternam. DENTRO delas, não: medido no rig, o cross-fade
    // corrida→andar deixa o pé esquerdo pairando a 5,8 cm — ele desce, é puxado de volta a 16,3 cm
    // e só encosta na passada seguinte, então o direito pisa duas vezes seguidas. Quem erra é o
    // blend, não o detector; forçar alternância aqui seria inventar um som sem pisada na tela.
    const steady=hits.filter(hit=>Math.abs(hit.time-2)>.6&&Math.abs(hit.time-4)>.6);
    for(let i=1;i<steady.length;i++)
      if(steady[i-1]!.time>steady[i]!.time-.6)
        expect(steady[i]!.side,`apoio em ${steady[i]!.time.toFixed(2)}s repetiu o pé`).not.toBe(steady[i-1]!.side);
  });

  it('parado no Idle não produz passo nenhum',()=>{
    const {hits,peak}=drive({vx:0,vz:0},0,4);
    expect(hits).toHaveLength(0);
    // O `Idle` respira entre 7,3 e 7,7 cm: fica abaixo do rearme, que é por isso que 9,5 cm foi
    // escolhido e não 8,5 cm. Se alguém baixar o limiar, este número denuncia.
    expect(peak).toBeLessThan(new FootstepSync().liftHeight);
    expect(peak).toBeGreaterThan(.07);
  });

  it('no ar não produz passo, e a aterrissagem produz exatamente um',()=>{
    rig.visual.resetAttempt();
    const sync=new FootstepSync();const hits:FootSide[]=[];
    for(let frame=0;frame<120;frame++){
      const h=rig.step(DT,{vx:0,vz:GAITS.run,vy:-6,grounded:false});
      sync.update(DT,[{side:0,height:h.right},{side:1,height:h.left}],false,GAITS.run,side=>hits.push(side));
    }
    expect(hits,'passo no ar').toHaveLength(0);
    // Toca o chão. No quadro do `grounded` os pés ainda estão a ~37 e ~32 cm — nada soa ali. O
    // clipe de pouso desce os dois, e a janela de aterrissagem deixa passar UM som só.
    const touchdown=rig.step(DT,{vx:0,vz:GAITS.run,grounded:true});
    sync.update(DT,[{side:0,height:touchdown.right},{side:1,height:touchdown.left}],true,GAITS.run,side=>hits.push(side));
    expect(touchdown.right,'os pés ainda estão no ar no quadro do toque').toBeGreaterThan(.2);
    expect(hits,'som antes de o pé chegar ao chão').toHaveLength(0);
    for(let frame=0;frame<Math.round(new FootstepSync().landingWindowSeconds/DT);frame++){
      const h=rig.step(DT,{vx:0,vz:GAITS.run,grounded:true});
      sync.update(DT,[{side:0,height:h.right},{side:1,height:h.left}],true,GAITS.run,side=>hits.push(side));
    }
    expect(hits,'aterrissagem duplicada').toHaveLength(1);
  });

  it('sair do parado só soa depois de um pé subir e descer de verdade',()=>{
    rig.visual.resetAttempt();
    const sync=new FootstepSync();const times:number[]=[];let time=0;
    for(let frame=0;frame<120;frame++){
      const h=rig.step(DT,{vx:0,vz:0});time+=DT;
      sync.update(DT,[{side:0,height:h.right},{side:1,height:h.left}],true,0,()=>times.push(time));
    }
    expect(times,'passo enquanto parado').toHaveLength(0);
    for(let frame=0;frame<180;frame++){
      const h=rig.step(DT,{vx:0,vz:GAITS.walk});time+=DT;
      sync.update(DT,[{side:0,height:h.right},{side:1,height:h.left}],true,GAITS.walk,()=>times.push(time));
    }
    expect(times.length).toBeGreaterThan(3);
    // O defeito antigo era um passo NO PRIMEIRO QUADRO de movimento, com o pé parado no chão desde
    // o `Idle`. Agora o primeiro som espera a subida do blend `Idle`→`Walk`.
    expect(times[0]!-2,'primeiro passo depois de começar a andar').toBeGreaterThan(2*DT);
  });

  it('a taxa de quadros não muda a cadência medida nos clipes',()=>{
    // 120, 60 e 30 Hz sobre o MESMO trecho de corrida. O relógio do clipe é o mesmo, então a
    // contagem de apoios tem de bater; taxa alta não pode pular apoio em silêncio.
    const counts=[1/120,1/60,1/30].map(dt=>{
      const run=drive({vx:0,vz:GAITS.run},GAITS.run,4,{dt});
      expect(run.sync.crowded,`apoios barrados a ${Math.round(1/dt)} Hz`).toBe(0);
      return run.hits.length;
    });
    const spread=Math.max(...counts)-Math.min(...counts);
    expect(spread,`contagens ${counts.join('/')}`).toBeLessThanOrEqual(1);
  });

  it('calado não soa, e ao voltar não solta rajada',()=>{
    const muted=drive({vx:0,vz:GAITS.run},GAITS.run,3,{muted:true});
    expect(muted.hits).toHaveLength(0);
    // Mesma passada, agora audível, a partir do estado que ficou guardado enquanto estava calada.
    muted.sync.muted=false;
    const hits:{time:number;side:FootSide}[]=[];let time=0;
    for(let frame=0;frame<Math.round(1/DT);frame++){
      const h=rig.step(DT,{vx:0,vz:GAITS.run});time+=DT;
      muted.sync.update(DT,[{side:0,height:h.right},{side:1,height:h.left}],true,GAITS.run,side=>hits.push({time,side}));
    }
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.length).toBeLessThan(6);
    for(let i=1;i<hits.length;i++)expect(hits[i]!.side).not.toBe(hits[i-1]!.side);
  });

  it('LIMITAÇÃO conhecida: a diagonal de ANDAR quase não levanta o pé, e nada é inventado',()=>{
    // `CharacterVisual` mistura `Walk` (50 quadros) e `StrafeLeft`/`StrafeRight` (66) com o MESMO
    // `progress` normalizado: na diagonal os clipes ficam em contrafase e o blend 50/50 cancela a
    // subida — o pico cai de ~16 cm para ~7 cm, abaixo da respiração do `Idle`. O detector fica
    // mudo porque o personagem na tela realmente não levanta o pé; forjar um som aqui seria voltar
    // ao relógio de passos. A correção é de conteúdo, no dono do `CharacterVisual`.
    for(const heading of ['forward-left','forward-right'] as Heading[]){
      const {hits,peak}=drive(velocity(heading,'walk'),GAITS.walk,4);
      expect(peak,`${heading}: pico do pé`).toBeLessThan(.09);
      expect(hits,`${heading}: som sem pisada visível`).toHaveLength(0);
    }
    // A MESMA diagonal correndo funciona, porque `Run` tem amplitude de sobra.
    for(const heading of ['forward-left','forward-right'] as Heading[])
      expect(drive(velocity(heading,'run'),GAITS.run,4).hits.length).toBeGreaterThan(8);
  });
});

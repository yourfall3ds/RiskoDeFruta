/**
 * Auditoria numérica dos passos nos clipes REAIS de locomoção do `gunslinger.glb`.
 *
 * O ponto é medir, não afirmar. Para cada combinação andar/correr × frente/trás/lateral/diagonal o
 * script roda o `CharacterVisual` de verdade (mesma máquina de estados, mesmo blend direcional),
 * guarda a curva de altura dos dois pés e passa essa curva pelo `FootstepSync` — o mesmo objeto que
 * o jogo usa. O relatório mostra pico de subida, platô de apoio, quantos apoios por segundo e se
 * algum contato foi barrado pelo intervalo mínimo.
 *
 * Roda: npx tsx scripts/audit-footstep-clips.ts
 * Escreve: docs/footstep-clip-contacts.json
 */
import {writeFileSync} from 'node:fs';
import {FootstepSync,type FootSide} from '../src/animation/FootstepSync';
import {loadLocomotionRig,HEADINGS,GAITS,type Heading,type Gait} from '../tests/support/locomotion-rig';

const DT=1/60,SECONDS=4,WARMUP=.6;
const rig=await loadLocomotionRig();
const reference=new FootstepSync();

interface Row {
  id:string;gait:Gait;heading:Heading;speed:number;
  liftPeak:{right:number;left:number};contactFloor:{right:number;left:number};
  /** Maior altura por pé enquanto o `FootstepSync` o considerava apoiado. */
  contacts:number;perSecond:number;alternation:number;crowded:number;
  gapSeconds:{min:number;max:number};
  sides:number[];
}

const rows:Row[]=[],problems:string[]=[],contentWarnings:string[]=[];
const round=(value:number,digits=4):number=>Number(value.toFixed(digits));

/**
 * Combinações que o RIG não consegue sustentar, e que portanto não são defeito do detector.
 *
 * `CharacterVisual` mistura o clipe longitudinal e o lateral com o MESMO `progress` normalizado, mas
 * `Walk` tem 50 quadros e `StrafeLeft`/`StrafeRight` têm 66: na diagonal os dois ficam em
 * contrafase e o blend 50/50 cancela a subida do pé — o pico cai de ~16 cm para ~7 cm, abaixo até
 * da respiração do `Idle`. Com o pé praticamente parado não existe contato para detectar, e inventar
 * um som aqui seria voltar ao relógio de passos. Fica registrado como pendência de conteúdo para o
 * dono do `CharacterVisual` (ver docs/CLAUDE_FOOTSTEP_REFERENCE_DELIVERY.md).
 */
const CONTENT_LIMITS=new Set(['walk-forward-left','walk-forward-right']);

for(const gait of Object.keys(GAITS) as Gait[]){
  for(const heading of Object.keys(HEADINGS) as Heading[]){
    const speed=GAITS[gait],direction=HEADINGS[heading];
    const vx=direction.x*speed,vz=direction.z*speed;
    // Cada combinação começa do zero: o rig é reposicionado e o detector re-semeado, senão o
    // resto do teste anterior vazaria para o próximo e a contagem seria fantasia.
    rig.visual.resetAttempt();reference.reset();
    const sync=new FootstepSync();
    const peak={right:0,left:0},floor={right:Infinity,left:Infinity};
    const hits:{time:number;side:FootSide}[]=[];
    let time=0;
    for(let frame=0;frame<Math.round((SECONDS+WARMUP)/DT);frame++){
      const heights=rig.step(DT,{vx,vz});
      time+=DT;
      const warming=time<WARMUP;
      sync.update(DT,[{side:0,height:heights.right},{side:1,height:heights.left}],true,speed,
        (side)=>{if(!warming)hits.push({time:time-WARMUP,side});});
      if(warming)continue;
      peak.right=Math.max(peak.right,heights.right);peak.left=Math.max(peak.left,heights.left);
      floor.right=Math.min(floor.right,heights.right);floor.left=Math.min(floor.left,heights.left);
    }
    const gaps=hits.slice(1).map((hit,index)=>hit.time-hits[index]!.time);
    let alternation=0;
    for(let i=1;i<hits.length;i++)if(hits[i]!.side!==hits[i-1]!.side)alternation++;
    const row:Row={
      id:`${gait}-${heading}`,gait,heading,speed,
      liftPeak:{right:round(peak.right),left:round(peak.left)},
      contactFloor:{right:round(floor.right),left:round(floor.left)},
      contacts:hits.length,perSecond:round(hits.length/SECONDS,3),
      alternation:hits.length>1?round(alternation/(hits.length-1),3):0,
      crowded:sync.crowded,
      gapSeconds:{min:round(Math.min(...gaps),3),max:round(Math.max(...gaps),3)},
      sides:hits.map(h=>h.side),
    };
    rows.push(row);

    const bucket=CONTENT_LIMITS.has(row.id)?contentWarnings:problems;
    const fail=(condition:boolean,message:string):void=>{if(condition)bucket.push(`${row.id}: ${message}`);};
    fail(hits.length===0,'nenhum passo em 4 s de locomoção');
    fail(row.perSecond<1,`só ${row.perSecond} passos/s — cadência baixa demais para ${gait}`);
    fail(row.alternation<1,`os pés não alternam (${(row.alternation*100).toFixed(0)}% de trocas)`);
    fail(row.crowded>0,`${row.crowded} apoios barrados pelo intervalo mínimo`);
    fail(Math.max(peak.right,peak.left)<=reference.liftHeight,
      `pico de ${round(Math.max(peak.right,peak.left))} m não passa do rearme (${reference.liftHeight} m)`);
    fail(Math.min(floor.right,floor.left)>reference.contactHeight,
      `piso de ${round(Math.min(floor.right,floor.left))} m nunca chega ao apoio (${reference.contactHeight} m)`);
  }
}

// Margem real dos limiares: a distância entre o pior clipe e cada limiar. Um número pequeno aqui é
// o aviso de que o limiar está encostado na amplitude do rig, não de que o teste passou por sorte.
const detectable=rows.filter(r=>!CONTENT_LIMITS.has(r.id));
const worstLift=Math.min(...detectable.map(r=>Math.max(r.liftPeak.right,r.liftPeak.left)));
const worstFloor=Math.max(...detectable.map(r=>Math.min(r.contactFloor.right,r.contactFloor.left)));

// Parado e no ar não podem produzir passo nenhum: é o falso positivo que o jogo mostrava.
const quiet:Record<string,number>={};
for(const [id,stride,speed,frames] of [
  ['idle',{vx:0,vz:0},0,240],
  ['airborne',{vx:0,vz:GAITS.run,vy:6,grounded:false},GAITS.run,240],
] as const){
  rig.visual.resetAttempt();const sync=new FootstepSync();let count=0;
  for(let frame=0;frame<frames;frame++){
    const heights=rig.step(DT,stride);
    sync.update(DT,[{side:0,height:heights.right},{side:1,height:heights.left}],stride.grounded??true,speed,()=>count++);
  }
  quiet[id]=count;
  if(count)problems.push(`${id}: ${count} passos onde não deveria haver nenhum`);
}

// Partida parado → andando: o primeiro som só pode vir depois de um pé subir e descer de verdade.
rig.visual.resetAttempt();
const start=new FootstepSync();const startTimes:number[]=[];
{
  let time=0;
  for(let frame=0;frame<120;frame++){const h=rig.step(DT,{vx:0,vz:0});time+=DT;
    start.update(DT,[{side:0,height:h.right},{side:1,height:h.left}],true,0,()=>startTimes.push(time));}
  for(let frame=0;frame<180;frame++){const h=rig.step(DT,{vx:0,vz:GAITS.walk});time+=DT;
    start.update(DT,[{side:0,height:h.right},{side:1,height:h.left}],true,GAITS.walk,()=>startTimes.push(time));}
}
const firstStep=startTimes.length?round(startTimes[0]!-2,3):-1;
if(startTimes.some(t=>t<=2))problems.push(`partida: ${startTimes.filter(t=>t<=2).length} passos ainda parado`);
// Um passo no PRIMEIRO quadro de movimento seria o defeito antigo: o pé já estava baixo desde o
// `Idle` e o som saía sem nenhuma subida. Depois de dois quadros o pé teve tempo de subir de
// verdade no blend `Idle`→`Walk`, e aí o som acompanha uma pisada que a tela mostra.
if(firstStep>=0&&firstStep<2*DT)problems.push(`partida: primeiro passo em ${firstStep}s — sem subida antes do contato`);
if(firstStep<0)problems.push('partida: nenhum passo depois de começar a andar');

const output={
  model:'public/models/gunslinger.glb',
  reference:{repo:'https://github.com/dropecho/unity_footstep',commit:'2e3620087499c86b45b83811739f9a7e0db5d7c0',
    license:'MIT © 2023 Benjamin Van Treese — docs/licenses/unity_footstep-LICENSE.md'},
  thresholds:{contactHeight:reference.contactHeight,liftHeight:reference.liftHeight,
    minIntervalSeconds:reference.minIntervalSeconds,minSpeed:reference.minSpeed,descentTolerance:reference.descentTolerance},
  margins:{worstLiftPeak:round(worstLift),liftMargin:round(worstLift-reference.liftHeight),
    worstContactFloor:round(worstFloor),contactMargin:round(reference.contactHeight-worstFloor)},
  quiet,firstStepAfterStartSeconds:firstStep,
  rows,problems,contentWarnings,
};
writeFileSync('docs/footstep-clip-contacts.json',JSON.stringify(output,null,1));

for(const row of rows)console.log(
  row.id.padEnd(22),
  'pico',`${(row.liftPeak.right*100).toFixed(1)}/${(row.liftPeak.left*100).toFixed(1)}cm`.padStart(14),
  'piso',`${(row.contactFloor.right*100).toFixed(1)}/${(row.contactFloor.left*100).toFixed(1)}cm`.padStart(14),
  'apoios',String(row.contacts).padStart(3),
  `${row.perSecond.toFixed(2)}/s`.padStart(8),
  'alterna',`${(row.alternation*100).toFixed(0)}%`.padStart(5),
  'intervalo',`${row.gapSeconds.min.toFixed(2)}..${row.gapSeconds.max.toFixed(2)}s`.padStart(13),
  'barrados',row.crowded);
console.log('\nmargem de rearme',(output.margins.liftMargin*100).toFixed(1)+'cm sobre',(reference.liftHeight*100).toFixed(1)+'cm',
  '| margem de apoio',(output.margins.contactMargin*100).toFixed(1)+'cm sob',(reference.contactHeight*100).toFixed(1)+'cm');
console.log('parado',quiet.idle,'passos | no ar',quiet.airborne,'passos | primeiro passo ao partir',firstStep+'s');
if(contentWarnings.length)console.log('PENDÊNCIA DE CONTEÚDO (blend do CharacterVisual, não do detector):\n - '+contentWarnings.join('\n - '));
console.log(problems.length?'PROBLEMAS:\n - '+problems.join('\n - '):'AUDITORIA LIMPA');
rig.dispose();
process.exit(problems.length?1:0);

import {it,expect} from 'vitest';
import {
 IntroSequence,INTRO_RUN_SECONDS,INTRO_LEAP_SECONDS,INTRO_RUN_DISTANCE,INTRO_LEAP_DISTANCE,INTRO_RUN_STEPS,
 type IntroCue,type IntroPhase,
} from '../src/player/IntroSequence';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents} from '../src/core/contracts';

const LANDING={x:31,y:12.5,z:-8},YAW=.7;
const forward=(yaw:number)=>({x:Math.sin(yaw),z:Math.cos(yaw)});
const along=(p:{x:number;z:number},yaw:number)=>p.x*forward(yaw).x+p.z*forward(yaw).z;

/** Roda a entrada inteira em 120 Hz e devolve cada quadro. */
function play(intro:IntroSequence,options:{standby?:number;prologue?:boolean;steps?:number}={}){
 const cues:IntroCue[]=[],frames:{phase:IntroPhase;position:{x:number;y:number;z:number};pitch:number;holds:boolean;weight:number}[]=[];
 intro.beginStandby();
 for(let i=0;i<(options.standby??60);i++)intro.update(1/120,c=>cues.push(c));
 intro.start(options.prologue??true);
 for(let i=0;i<(options.steps??1600)&&intro.visible;i++){
  intro.update(1/120,c=>cues.push(c));
  const pose=intro.pose(LANDING,YAW),shot=intro.shot(LANDING,YAW);
  if(pose)frames.push({phase:pose.phase,position:pose.position,pitch:pose.pitch,holds:intro.holdsControl,weight:shot?.weight??0});
 }
 return {cues,frames};
}

it('places the deck behind the dive top so the run and the leap end exactly where the fall begins',()=>{
 const intro=new IntroSequence();
 const top=intro.diveTop(LANDING,YAW),edge=intro.deckEdge(LANDING,YAW),start=intro.deckStart(LANDING,YAW);
 expect(top.y).toBeGreaterThan(LANDING.y+800);
 expect(along(top,YAW)-along(edge,YAW)).toBeCloseTo(INTRO_LEAP_DISTANCE,6);
 expect(along(edge,YAW)-along(start,YAW)).toBeCloseTo(INTRO_RUN_DISTANCE,6);
 // Deck plano: espera e borda na mesma altura, que é onde os pés ficam.
 expect(start.y).toBe(edge.y);expect(edge.y).toBe(top.y);
});

it('runs the full entrance and only releases control after the body is back on its feet',()=>{
 const intro=new IntroSequence();
 const {frames,cues}=play(intro);
 const order=[...new Set(frames.map(f=>f.phase))];
 expect(order).toEqual(['run','leap','dive','recover']);
 // O controle fica retido em TODOS os quadros da entrada; só o fim natural devolve.
 expect(frames.every(f=>f.holds)).toBe(true);
 expect(intro.holdsControl).toBe(false);
 expect(intro.phase).toBe('done');
 expect(intro.skipped).toBe(false);
 // Sinais completos: passos no deck, salto, vento na queda, impacto único e o corpo levantando.
 expect(cues.filter(c=>c==='step').length).toBe(INTRO_RUN_STEPS);
 expect(cues.filter(c=>c==='launch').length).toBe(1);
 expect(cues.filter(c=>c==='impact').length).toBe(1);
 expect(cues.filter(c=>c==='rise').length).toBe(1);
 expect(cues.filter(c=>c==='wind').length).toBeGreaterThanOrEqual(3);
 expect(cues.indexOf('launch')).toBeLessThan(cues.indexOf('impact'));
 expect(cues.indexOf('impact')).toBeLessThan(cues.lastIndexOf('rise'));
});

it('moves continuously from the deck to the ground: no teleport, no jump between phases',()=>{
 const intro=new IntroSequence();
 const {frames}=play(intro);
 const start=intro.deckStart(LANDING,YAW);
 expect(Math.hypot(frames[0]!.position.x-start.x,frames[0]!.position.z-start.z)).toBeLessThan(.3);
 for(let i=1;i<frames.length;i++){
  const a=frames[i-1]!.position,b=frames[i]!.position;
  // 120 Hz: nenhum passo pode ser um salto de posição, nem na troca corrida→salto→queda.
  expect(Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z),`quadro ${i} fase ${frames[i]!.phase}`).toBeLessThan(5);
 }
 const last=frames.at(-1)!.position;
 expect(Math.hypot(last.x-LANDING.x,last.y-LANDING.y,last.z-LANDING.z)).toBeLessThan(.01);
});

it('advances along the deck and leaves the edge head first',()=>{
 const intro=new IntroSequence();
 const {frames}=play(intro);
 const run=frames.filter(f=>f.phase==='run');
 for(let i=1;i<run.length;i++)expect(along(run[i]!.position,YAW)).toBeGreaterThanOrEqual(along(run[i-1]!.position,YAW)-1e-9);
 // Arranque real: a segunda metade da corrida cobre mais chão que a primeira.
 const half=Math.floor(run.length/2);
 const first=along(run[half]!.position,YAW)-along(run[0]!.position,YAW);
 const second=along(run.at(-1)!.position,YAW)-along(run[half]!.position,YAW);
 expect(second).toBeGreaterThan(first);
 // O salto sobe e volta; o mergulho começa de cabeça e assim fica.
 const leap=frames.filter(f=>f.phase==='leap');
 expect(Math.max(...leap.map(f=>f.position.y))).toBeGreaterThan(intro.deckEdge(LANDING,YAW).y+.8);
 expect(leap.at(-1)!.pitch).toBeGreaterThan(Math.PI*.95);
 for(const frame of frames.filter(f=>f.phase==='dive'))expect(frame.pitch).toBeCloseTo(Math.PI,6);
 // Depois da borda o corpo só desce.
 const falling=frames.filter(f=>f.phase==='dive');
 for(let i=1;i<falling.length;i++)expect(falling[i]!.position.y).toBeLessThanOrEqual(falling[i-1]!.position.y+1e-8);
});

it('returns the camera to gameplay by itself instead of holding a cinematic pose',()=>{
 const intro=new IntroSequence();
 const {frames}=play(intro);
 expect(frames.filter(f=>f.phase!=='recover').every(f=>f.weight===1)).toBe(true);
 expect(frames.at(-1)!.weight).toBeLessThan(.02);
 expect(intro.shot(LANDING,YAW)).toBeUndefined();
 // O enquadramento nunca fica dentro do corpo.
 const intro2=new IntroSequence();intro2.beginStandby();intro2.start();
 for(let i=0;i<900&&intro2.visible;i++){
  intro2.update(1/120);
  const pose=intro2.pose(LANDING,YAW),shot=intro2.shot(LANDING,YAW);
  if(pose&&shot)expect(Math.hypot(shot.position.x-pose.position.x,shot.position.y-pose.position.y,shot.position.z-pose.position.z)).toBeGreaterThan(1.4);
 }
});

it('skips cleanly: control released at once, impact still resolved, body standing on the ground',()=>{
 for(const at of [.4,2.0,3.4,6.2]){
  const intro=new IntroSequence(),cues:IntroCue[]=[];
  intro.beginStandby();intro.start();
  for(let i=0;i<at*120;i++)intro.update(1/120,c=>cues.push(c));
  const before=cues.filter(c=>c==='impact').length;
  intro.skip(c=>cues.push(c));
  expect(cues.filter(c=>c==='impact').length,`pulo em ${at}s`).toBe(1);
  expect(before).toBeLessThanOrEqual(1);
  expect(intro.holdsControl).toBe(false);
  expect(intro.visible).toBe(false);
  expect(intro.deckVisible).toBe(false);
  expect(intro.pose(LANDING,YAW)).toBeUndefined();
  expect(intro.shot(LANDING,YAW)).toBeUndefined();
  expect(intro.skipped).toBe(true);
  // Pular de novo não devolve som nem muda nada.
  intro.skip(c=>cues.push(c));
  expect(cues.filter(c=>c==='impact').length).toBe(1);
  // Continuar atualizando depois do pulo não ressuscita a entrada.
  for(let i=0;i<300;i++)intro.update(1/120,c=>cues.push(c));
  expect(intro.phase).toBe('done');
 }
});

it('reset and abort leave nothing suspended and never release control early',()=>{
 const intro=new IntroSequence();
 intro.beginStandby();intro.start();
 for(let i=0;i<200;i++)intro.update(1/120);
 intro.abort();
 expect(intro.holdsControl).toBe(false);expect(intro.visible).toBe(false);expect(intro.deckVisible).toBe(false);
 expect(intro.pose(LANDING,YAW)).toBeUndefined();expect(intro.flight.active).toBe(false);
 intro.reset();
 expect(intro.phase).toBe('idle');expect(intro.standbyClock).toBe(0);expect(intro.skipped).toBe(false);
 // Depois do reset a entrada roda inteira outra vez.
 const {frames}=play(intro);
 expect(frames.at(-1)!.phase).toBe('recover');expect(intro.phase).toBe('done');
});

it('freezes on pause and ignores invalid deltas',()=>{
 const intro=new IntroSequence();
 intro.beginStandby();intro.start();
 for(let i=0;i<90;i++)intro.update(1/120);
 const before=intro.pose(LANDING,YAW)!;
 for(const bad of [0,NaN,-3,Number.POSITIVE_INFINITY])intro.update(bad);
 const after=intro.pose(LANDING,YAW)!;
 expect(after.position).toEqual(before.position);
 expect(after.phase).toBe(before.phase);
});

it('keeps the ship on screen for the leap and drops it once the body is away',()=>{
 const intro=new IntroSequence();
 intro.beginStandby();
 expect(intro.deckVisible).toBe(true);
 intro.start();
 for(let i=0;i<(INTRO_RUN_SECONDS+INTRO_LEAP_SECONDS)*120;i++)intro.update(1/120);
 expect(intro.deckVisible).toBe(true);
 for(let i=0;i<600&&intro.deckVisible;i++)intro.update(1/120);
 expect(intro.deckVisible).toBe(false);
 expect(intro.phase==='dive'||intro.phase==='recover').toBe(true);
});

it('falls back to the original dive when the ship asset is unavailable',()=>{
 const intro=new IntroSequence(),cues:IntroCue[]=[];
 intro.beginStandby();intro.start(false);
 expect(intro.phase).toBe('dive');
 for(let i=0;i<1600&&intro.visible;i++)intro.update(1/120,c=>cues.push(c));
 expect(intro.phase).toBe('done');
 expect(cues.filter(c=>c==='step')).toHaveLength(0);
 expect(cues.filter(c=>c==='impact')).toHaveLength(1);
});

it('is presentation only: never touches the motor and is identical for every client',()=>{
 const player=new PlayerMotor(new CollisionWorld(),new EventBus<GameEvents>(),{x:0,y:0,z:-10});
 const snapshot=JSON.stringify({p:player.position,v:player.velocity,yaw:player.yaw,hp:player.hp});
 const a=new IntroSequence(),b=new IntroSequence();
 const posesA:string[]=[],posesB:string[]=[];
 for(const [intro,out] of [[a,posesA],[b,posesB]] as const){
  intro.beginStandby();
  for(let i=0;i<17;i++)intro.update(1/120);
  intro.start();
  for(let i=0;i<1600&&intro.visible;i++){intro.update(1/120);out.push(JSON.stringify(intro.pose(player.position,player.yaw)));}
 }
 // Mesma entrada, mesmos quadros: nenhum cliente de co-op vê uma entrada divergente.
 expect(posesA).toEqual(posesB);
 expect(posesA.length).toBeGreaterThan(900);
 expect(JSON.stringify({p:player.position,v:player.velocity,yaw:player.yaw,hp:player.hp})).toBe(snapshot);
});

it('carries the standby clock into the run so the waiting pose does not pop on Play',()=>{
 const intro=new IntroSequence();
 intro.beginStandby();
 for(let i=0;i<300;i++)intro.update(1/120);
 const waiting=intro.pose(LANDING,YAW)!;
 expect(waiting.phase).toBe('standby');
 expect(intro.reveal).toBe(0);
 intro.start();
 const running=intro.pose(LANDING,YAW)!;
 expect(Math.hypot(running.position.x-waiting.position.x,running.position.z-waiting.position.z)).toBeLessThan(.01);
 expect(running.flutterTime).toBeCloseTo(waiting.flutterTime,6);
 // A dissolução do cartão acompanha a arrancada, não a queda.
 intro.update(.9);
 expect(intro.reveal).toBe(1);
});

it('holds the fall clock while the body is still on the deck',()=>{
 const intro=new IntroSequence();
 intro.beginStandby();intro.start();
 for(let i=0;i<(INTRO_RUN_SECONDS+INTRO_LEAP_SECONDS)*120-2;i++)intro.update(1/120);
 // Nada de queda enquanto a corrida e o salto acontecem: a altitude continua no topo.
 expect(intro.flight.elapsed).toBe(0);
 expect(intro.flight.height).toBeGreaterThan(880);
 intro.update(1/30);
 expect(intro.flight.elapsed).toBeGreaterThan(0);
});

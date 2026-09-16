import type {BoxCollider} from '../../physics/CollisionWorld';
import type {Vec3} from '../../core/contracts';
import {HIGHLAND_CHESTS} from '../HighlandSites';
import {ReliefField,areaWeight,type ReliefArea,type ReliefFeature,type ReliefPath,type ReliefPlan} from './ReliefField';

/**
 * Planos de relevo autorados por região.
 *
 * As feições (crista, terraço, bacia, ondulação) são autorais; as EXCLUSÕES não: elas são derivadas
 * dos dados de colisão que já existem — caixas de estrutura, pontes (`walkableLinks`) e âncoras de
 * recompensa. É isso que garante que porta, ponte, celeiro, silo, poste e baú continuem exatamente
 * na cota em que foram assados, sem lista mágica de coordenadas para manter à mão.
 *
 * O mesmo par (região, dados de colisão) produz o mesmo plano no cliente e no servidor.
 */

export interface ReliefSource {
 boxes:readonly BoxCollider[];
 walkableLinks?:readonly{a:Vec3;b:Vec3;width:number}[];
 /** Âncoras que não podem mudar de cota: baús, totens, pontos de chegada. */
 anchors?:readonly{x:number;z:number;radius?:number}[];
}

/** Ilhas dos planaltos, como `scripts/build-highland-farms.py` as autorou. */
export const HIGHLAND_ISLANDS=[
 {id:'campos-altos',x:500,z:280,height:18,rx:100,rz:98},
 {id:'moinhos-do-leste',x:720,z:320,height:26,rx:95,rz:85},
 {id:'vale-das-sementes',x:610,z:520,height:20,rx:110,rz:95},
] as const;

/** Elevação autorada de uma ilha dos planaltos. Reproduz `elevation()` do script de autoria. */
export function highlandElevation(x:number,z:number,island:(typeof HIGHLAND_ISLANDS)[number]):number {
 const u=(x-island.x)/island.rx,v=(z-island.z)/island.rz,r=Math.hypot(u,v);
 return island.height+Math.max(0,1-r*r)**2*(5+3*Math.sin(u*3+v*2));
}

/** Trilhas autoradas dos planaltos (`docs/highland-trails.json`), usadas como corredores jogáveis. */
export const HIGHLAND_TRAILS:readonly{id:string;width:number;points:readonly(readonly[number,number])[]}[]=[
 {id:'campos-travessia',width:4.5,points:[[410,280],[450,280],[490,280],[520,290],[550,297],[586,297]]},
 {id:'campos-vale',width:4.5,points:[[520,290],[525,325],[530,345],[539,363]]},
 {id:'campos-suprimentos-oeste',width:4.5,points:[[450,280],[465,265],[465,250]]},
 {id:'campos-suprimentos-leste',width:4.5,points:[[550,297],[548,270]]},
 {id:'moinhos-travessia',width:4.5,points:[[636,306],[660,300],[700,300],[735,320],[782,325]]},
 {id:'moinhos-vale',width:4.5,points:[[700,300],[700,340],[700,365],[689,393]]},
 {id:'moinhos-praca',width:4.5,points:[[735,320],[732,330],[720,330]]},
 {id:'vale-acesso',width:4.5,points:[[573,434],[585,455],[610,480],[610,515],[610,550],[610,580]]},
 {id:'vale-acesso-leste',width:4.5,points:[[658,440],[640,465],[610,480]]},
 {id:'campos-entrada-celeiro',width:4.5,points:[[490,280],[493,290],[493,300]]},
 {id:'moinhos-entrada',width:4.5,points:[[660,300],[650,310]]},
];

/** Caixas que NÃO devem virar exclusão: baús móveis e qualquer volume marcado como móvel. */
const MOVING=/^(moving-|.*-chest-)/;

/**
 * Talude máximo admitido na descida até uma exclusão. 0,49 ≈ 26°, bem abaixo do limite caminhável.
 * É este número que impede que uma estrutura no meio de um terraço vire um poço de paredes verticais.
 */
const EXCLUSION_GRADE=.49;

/** Quantos metros de transição são necessários para descer `relief` metros sem criar parede. */
function featherFor(relief:number,minimum:number):number {
 return Math.max(minimum,Math.abs(relief)/EXCLUSION_GRADE);
}

/**
 * Exclusões vindas das caixas de colisão.
 *
 * Só entram caixas que realmente encostam no chão da zona esculpida: um beiral ou uma passarela a
 * dois metros do solo não impede o terreno de subir sob ela, e um volume enterrado bem abaixo também
 * não. A margem cresce com a pegada — um poste de cerca segura pouco em volta, uma fundação de
 * celeiro segura bem mais — e a transição é dimensionada pelo relevo que existiria ALI, de modo que
 * a descida até a estrutura nunca passa de {@link EXCLUSION_GRADE}.
 */
export function boxExclusions(
 boxes:readonly BoxCollider[],
 bounds:ReliefPlan['bounds'],
 base:(x:number,z:number)=>number,
 relief:(x:number,z:number)=>number,
):ReliefArea[] {
 const areas:ReliefArea[]=[];
 for(const box of boxes){
  if(MOVING.test(box.id))continue;
  const x=(box.min.x+box.max.x)/2,z=(box.min.z+box.max.z)/2;
  if(x<bounds.minX-16||x>bounds.maxX+16||z<bounds.minZ-16||z>bounds.maxZ+16)continue;
  const floor=base(x,z);
  if(box.min.y>floor+2.2||box.max.y<floor-.6)continue;
  const hx=(box.max.x-box.min.x)/2,hz=(box.max.z-box.min.z)/2;
  const margin=featherFor(relief(x,z),Math.min(7,Math.max(1.6,Math.max(hx,hz)*1.1)));
  areas.push({shape:'rect',x,z,hx:hx+margin,hz:hz+margin,feather:margin});
 }
 return areas;
}

/** Exclusões das pontes: o corredor inteiro e um pátio de chegada em cada cabeceira. */
export function bridgeExclusions(links:readonly{a:Vec3;b:Vec3;width:number}[],relief:(x:number,z:number)=>number):ReliefArea[] {
 const areas:ReliefArea[]=[];
 for(const link of links){
  const feather=featherFor(Math.max(relief(link.a.x,link.a.z),relief(link.b.x,link.b.z)),6);
  areas.push({shape:'path',points:[[link.a.x,link.a.z],[link.b.x,link.b.z]],halfWidth:link.width/2+2.5+feather,feather});
  for(const end of [link.a,link.b])areas.push({shape:'disc',x:end.x,z:end.z,rx:5+feather,rz:5+feather,feather});
 }
 return areas;
}

/** Exclusões das âncoras de recompensa: a cota do baú e a do piso ao lado dele não podem mudar. */
export function anchorExclusions(anchors:readonly{x:number;z:number;radius?:number}[],relief:(x:number,z:number)=>number):ReliefArea[] {
 return anchors.map(anchor=>{
  const core=anchor.radius??4.5,feather=featherFor(relief(anchor.x,anchor.z),5);
  return{shape:'disc',x:anchor.x,z:anchor.z,rx:core+feather,rz:core+feather,feather};
 });
}

/**
 * Converte uma trilha autorada num caminho jogável.
 *
 * O nível de cada nó não é escolhido à mão: é o próprio relevo amostrado ali (sem o termo de
 * caminho), suavizado ao longo da trilha e depois limitado a `maxGrade`. O resultado é uma estrada
 * que ACOMPANHA as feições grandes — sobe no terraço, desce na bacia — sem herdar cada solavanco, e
 * com inclinação garantidamente caminhável. É isso que liga os desníveis em vez de contorná-los.
 */
export function levelTrail(
 trail:{id:string;width:number;points:readonly(readonly[number,number])[]},
 raw:(x:number,z:number)=>number,
 {spacing=6,maxGrade=.3,smoothing=3}:{spacing?:number;maxGrade?:number;smoothing?:number}={},
):ReliefPath {
 const sampled:[number,number][]=[];
 for(let i=0;i+1<trail.points.length;i++){
  const a=trail.points[i]!,b=trail.points[i+1]!,length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const steps=Math.max(1,Math.round(length/spacing));
  for(let s=0;s<steps;s++){const t=s/steps;sampled.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
 }
 const last=trail.points.at(-1);if(last)sampled.push([last[0],last[1]]);
 let levels=sampled.map(([x,z])=>raw(x,z));
 for(let pass=0;pass<smoothing;pass++){
  const next=levels.slice();
  for(let i=1;i+1<levels.length;i++)next[i]=(levels[i-1]!+levels[i]!*2+levels[i+1]!)/4;
  levels=next;
 }
 // Limitador de rampa em duas varreduras: garante |Δy| <= maxGrade * Δs entre nós vizinhos.
 const span=(i:number,j:number)=>Math.hypot(sampled[i]![0]-sampled[j]![0],sampled[i]![1]-sampled[j]![1]);
 for(let i=1;i<levels.length;i++){const limit=maxGrade*span(i,i-1);levels[i]=Math.min(levels[i]!,levels[i-1]!+limit);levels[i]=Math.max(levels[i]!,levels[i-1]!-limit);}
 for(let i=levels.length-2;i>=0;i--){const limit=maxGrade*span(i,i+1);levels[i]=Math.min(levels[i]!,levels[i+1]!+limit);levels[i]=Math.max(levels[i]!,levels[i+1]!-limit);}
 return{id:trail.id,halfWidth:trail.width/2+1.2,feather:5.5,points:sampled.map(([x,z],i)=>[x,z,levels[i]!] as const)};
}

/** Avaliador do relevo SEM os caminhos — é a referência usada para nivelar as trilhas. */
function rawSampler(plan:Omit<ReliefPlan,'paths'>):(x:number,z:number)=>number {
 const field=new ReliefField({...plan,paths:[]});
 return(x,z)=>field.offsetAt(x,z);
}

function highlandFeatures(island:(typeof HIGHLAND_ISLANDS)[number]):ReliefFeature[] {
 const seed=island.id.length*37+island.x;
 const common:ReliefFeature[]=[
  {kind:'undulation',id:island.id+'-macro',amplitude:1.15,scale:27,seed},
  {kind:'undulation',id:island.id+'-micro',amplitude:.38,scale:9.5,seed:seed+101},
 ];
 if(island.id==='campos-altos')return[...common,
  {kind:'plateau',id:'campos-terraco-nordeste',area:{shape:'disc',x:545,z:245,rx:27,rz:24,feather:15},height:2.7},
  {kind:'plateau',id:'campos-crista-sul',area:{shape:'path',points:[[455,312],[482,332],[516,336]],halfWidth:11,feather:17},height:2.2},
  {kind:'plateau',id:'campos-bacia-oeste',area:{shape:'disc',x:468,z:252,rx:21,rz:19,feather:15},height:-1.2},
  {kind:'plateau',id:'campos-afloramento-leste',area:{shape:'disc',x:558,z:312,rx:14,rz:12,feather:8},height:3.1},
 ];
 if(island.id==='moinhos-do-leste')return[...common,
  {kind:'plateau',id:'moinhos-terraco-norte',area:{shape:'disc',x:748,z:292,rx:24,rz:20,feather:14},height:2.5},
  {kind:'plateau',id:'moinhos-crista-sul',area:{shape:'path',points:[[688,352],[716,366],[748,356]],halfWidth:10,feather:15},height:2.1},
  {kind:'plateau',id:'moinhos-bacia',area:{shape:'disc',x:698,z:332,rx:19,rz:17,feather:13},height:-1.1},
  {kind:'plateau',id:'moinhos-afloramento',area:{shape:'disc',x:762,z:342,rx:13,rz:11,feather:8},height:2.8},
 ];
 return[...common,
  {kind:'plateau',id:'vale-terraco-nordeste',area:{shape:'disc',x:652,z:490,rx:26,rz:22,feather:15},height:2.6},
  {kind:'plateau',id:'vale-bacia-central',area:{shape:'disc',x:598,z:532,rx:31,rz:27,feather:18},height:-1.5},
  {kind:'plateau',id:'vale-crista-sul',area:{shape:'path',points:[[568,562],[602,578],[644,560]],halfWidth:11,feather:16},height:2.3},
  {kind:'plateau',id:'vale-afloramento-oeste',area:{shape:'disc',x:560,z:502,rx:13,rz:12,feather:8},height:2.9},
 ];
}

function highlandPlan(island:(typeof HIGHLAND_ISLANDS)[number],source:ReliefSource):ReliefPlan {
 const reach=.84;
 const bounds={minX:island.x-island.rx*reach,maxX:island.x+island.rx*reach,minZ:island.z-island.rz*reach,maxZ:island.z+island.rz*reach};
 const base=(x:number,z:number)=>highlandElevation(x,z,island);
 const core:Omit<ReliefPlan,'paths'>={
  id:'highland-'+island.id,bounds,resolution:2.5,base,
  zones:[{shape:'disc',x:island.x,z:island.z,rx:island.rx*.79,rz:island.rz*.79,feather:13}],
  exclusions:[],features:highlandFeatures(island),
  pedestal:.95,minLift:.04,uvScale:5,
 };
 // Primeira passada sem exclusões: é o relevo "ideal", e é ele que dimensiona cada transição.
 const unmasked=rawSampler(core);
 core.exclusions=[
  ...boxExclusions(source.boxes,bounds,base,unmasked),
  ...bridgeExclusions(source.walkableLinks??[],unmasked),
  // As cotas de `HIGHLAND_CHESTS` foram geradas do piso antigo e são contrato de teste e de bake de
  // navegação: o relevo não pode mexer nelas nem no piso ao lado do baú.
  ...anchorExclusions([...HIGHLAND_CHESTS,...(source.anchors??[])],unmasked),
 ];
 const raw=rawSampler(core);
 const inside=(x:number,z:number)=>Math.hypot((x-island.x)/island.rx,(z-island.z)/island.rz)<.92;
 const paths=HIGHLAND_TRAILS.filter(trail=>trail.points.some(([x,z])=>inside(x,z))).map(trail=>levelTrail(trail,raw));
 return{...core,paths};
}

/** Campo inicial: a ilha principal do `farm-world`, plana em y=0 e cheia de estrutura autorada. */
function baseFieldPlan(source:ReliefSource):ReliefPlan {
 const bounds={minX:-23,maxX:23,minZ:-25,maxZ:25};
 const base=()=>0;
 const core:Omit<ReliefPlan,'paths'>={
  id:'base-field',bounds,resolution:1.25,base,
  zones:[{shape:'disc',x:0,z:0,rx:21.5,rz:23.5,feather:5}],
  exclusions:[],
  features:[
   {kind:'undulation',id:'campo-macro',amplitude:.62,scale:12.5,seed:411},
   {kind:'undulation',id:'campo-micro',amplitude:.2,scale:4.4,seed:907},
   {kind:'plateau',id:'campo-terraco-leste',area:{shape:'disc',x:16.5,z:-15,rx:7.5,rz:7,feather:5.5},height:1.45},
   {kind:'plateau',id:'campo-crista-oeste',area:{shape:'path',points:[[-16,-17],[-13.5,-8],[-15,1]],halfWidth:4.5,feather:6},height:1.15},
   {kind:'plateau',id:'campo-bacia-norte',area:{shape:'disc',x:11,z:6,rx:6.5,rz:5.5,feather:5},height:-.75},
  ],
  pedestal:.42,minLift:.02,uvScale:4,
 };
 const unmasked=rawSampler(core);
 core.exclusions=[
  ...boxExclusions(source.boxes,bounds,base,unmasked),
  ...bridgeExclusions(source.walkableLinks??[],unmasked),
  ...anchorExclusions(source.anchors??[],unmasked),
  // Rampa autorada para a ilha de cima: a ligação entre os dois níveis já existe e é intocável.
  {shape:'rect',x:0,z:16,hx:9,hz:13,feather:4},
  // Chegada do jogador (`PlayerScene` sorteia x −2..2, z −17..−10, e o meteoro pousa aqui). A cota
  // de chegada é contrato de cinemática, de reset e do bake de navegação: fica exatamente em y=0.
  {shape:'rect',x:0,z:-13.5,hx:8.5,hz:10,feather:4.5},
 ];
 const raw=rawSampler(core);
 const paths=[levelTrail(
  {id:'campo-subida-leste',width:4,points:[[6,-6],[10,-10],[14,-13],[16.5,-15]]},
  raw,{spacing:2.5,maxGrade:.28,smoothing:2},
 )];
 return{...core,paths};
}

/** Regiões com relevo esculpido integrado. Qualquer outra passa direto, sem custo. */
export const SCULPTED_REGIONS=['base','highland-farms'] as const;
export type SculptedRegion=(typeof SCULPTED_REGIONS)[number];

/** Todos os planos de uma região. `base` é o mundo inicial; as demais são regiões de streaming. */
export function reliefPlansFor(region:string,source:ReliefSource):ReliefPlan[] {
 if(region==='base')return[baseFieldPlan(source)];
 if(region==='highland-farms')return HIGHLAND_ISLANDS.map(island=>highlandPlan(island,source));
 return[];
}

/** Soma dos pesos de exclusão no ponto, para diagnóstico e teste. */
export function exclusionWeightAt(plan:ReliefPlan,x:number,z:number):number {
 let blocked=0;
 for(const area of plan.exclusions)blocked=Math.max(blocked,areaWeight(area,x,z));
 return blocked;
}

import {ItemPickupNotice} from './ItemPickupNotice';
import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import type {Camera} from '@babylonjs/core/Cameras/camera';
import type {EnemySwarm} from '../game/EnemySwarm';
import {ITEMS,type RunProgression} from '../run/RunProgression';
import type {RunInteractables} from '../run/RunInteractables';
import {ENEMY_AFFIXES} from '../enemies/EnemyAffixes';
import {ENEMIES} from '../run/MonsterDirector';
import {perkIcon} from './PerkIcons';
import {CHALICE_SIGNAL_SECONDS,type ExpeditionObjectives} from '../run/ExpeditionObjectives';
import type {HarvestResonance} from '../run/HarvestResonance';
import type {MPCharge} from '../combat/MPCharge';
import type {WeatherCycle} from '../world/WeatherCycle';
import {radialSurfaceOf,type EnemySurface} from '../enemies/EnemySpace';
import type {Vec3} from '../core/contracts';
import {objectiveBearing} from './ObjectiveBearing';
import type {EconomyMirror} from '../run/RunEconomy';

const COMPASS=['↑','↗','→','↘','↓','↙','←','↖'] as const;
const bearingArrow=(from:{x:number;z:number},to:{x:number;z:number},heading:number)=>COMPASS[Math.round(((Math.atan2(to.x-from.x,to.z-from.z)*180/Math.PI-heading+720)%360)/45)%8]!;

/** Cadência do HUD: PlayerScene chama `update` todo frame, só ~10 atualizações por segundo passam. */
const UPDATE_PERIOD=.1;
/** Teto de barras simultâneas e raio de exibição, em metros — comportamento preservado. */
const NEARBY_BARS=12,NEARBY_RANGE=28;
/** `Vector3.Project` precisa de uma matriz de mundo; a identidade nunca muda e não é escrita. */
const IDENTITY=Matrix.Identity();
/**
 * Percentuais com duas casas.
 *
 * Posições e larguras vêm de projeção e de vida em ponto flutuante: sem arredondar, ruído na
 * última casa reescreveria `style` a cada atualização sem mover um pixel sequer. Duas casas valem
 * 0,01% da tela (menos de meio pixel em 4K) e 0,01% de uma barra de 118px — invisível.
 */
const pct=(value:number)=>`${Math.round(value*100)/100}%`;

type StyleProp='width'|'left'|'top'|'opacity'|'display';
/** Escreve `style` só quando o valor muda; ler é barato, invalidar layout à toa não é. */
const css=(node:HTMLElement,prop:StyleProp,value:string):void=>{if(node.style[prop]!==value)node.style[prop]=value;};
const text=(node:HTMLElement,value:string):void=>{if(node.textContent!==value)node.textContent=value;};
const attr=(node:HTMLElement,name:string,value:string):void=>{if(node.getAttribute(name)!==value)node.setAttribute(name,value);};
const shown=(node:HTMLElement,visible:boolean):void=>{if(node.hidden===visible)node.hidden=!visible;};
const classes=(node:HTMLElement,value:string):void=>{if(node.className!==value)node.className=value;};

/**
 * Painel de HTML que lembra o que já escreveu.
 *
 * O HUD reconstrói o mesmo texto dezenas de vezes por segundo (relógio parado, missão parada,
 * contrato parado). Atribuir `innerHTML` idêntico ainda destrói e reconstrói a subárvore, então a
 * comparação de string troca um parse de HTML por uma comparação de string.
 */
class HtmlSlot {
 private written:string|undefined;
 constructor(readonly node:HTMLElement){}
 /** `true` quando o DOM foi realmente tocado. */
 set(html:string):boolean {if(html===this.written)return false;this.written=html;this.node.innerHTML=html;return true;}
}

interface Marker {root:HTMLElement}
/**
 * Pool de marcadores projetados na tela: números de dano, barras de vida e caixas de suprimento.
 *
 * Antes cada atualização recriava essas subárvores inteiras por `innerHTML` — com 12 barras são
 * ~48 nós destruídos e recriados 10 vezes por segundo. Aqui os nós ficam presos ao container e só
 * mudam posição, opacidade, largura e rótulo; os que sobram vão para `display:none` e voltam a ser
 * usados no quadro seguinte. O pool para no pico real de marcadores simultâneos — `swarm.labels`
 * tem teto 32, as barras têm teto `NEARBY_BARS` e os suprimentos param no número de baús do
 * estágio — então ele não cresce indefinidamente.
 */
class MarkerPool<T extends Marker> {
 private readonly entries:T[]=[];private live=0;
 constructor(private readonly host:HTMLElement,private readonly build:()=>T){}
 /** Quantos nós o pool já criou — o teste de vazamento observa exatamente isto. */
 get size():number {return this.entries.length;}
 begin():void {this.live=0;}
 take():T {
  const reused=this.entries[this.live++];
  if(reused){css(reused.root,'display','');return reused;}
  const made=this.build();this.entries.push(made);this.host.append(made.root);return made;
 }
 end():void {for(let i=this.live;i<this.entries.length;i++)css(this.entries[i]!.root,'display','none');}
}

interface BarMarker extends Marker {trail:HTMLElement;fill:HTMLElement}
interface SupplyMarker extends Marker {cost:HTMLElement}

/** Só a barra: nome e números ficam no rótulo acessível, nunca desenhados sobre a cena. */
function buildBar():BarMarker {
 const root=document.createElement('div'),track=document.createElement('div');
 const trail=document.createElement('i'),fill=document.createElement('i');
 trail.className='health-trail';track.append(trail,fill);root.append(track);root.setAttribute('role','img');
 return {root,trail,fill};
}
function buildLabel():Marker {return {root:document.createElement('b')};}
function buildSupply():SupplyMarker {
 const root=document.createElement('b'),cost=document.createElement('small');
 root.textContent='◈';root.append(cost);
 return {root,cost};
}

type SwarmActor=EnemySwarm['actors'][number];

/** Só o que o HUD lê da viagem entre estágios; mantém o painel livre da máquina de estados. */
export interface StageJourneyView {active:boolean;label:string;detail:string;destination:string;failed:boolean}

/**
 * Texto do painel TAB, pelo MODO realmente ativo.
 *
 * O texto anterior era fixo e prometia “chefes a cada cinco ondas” mesmo numa expedição que não
 * tem ondas — informação falsa para quem lê o painel durante a run.
 */
export function modeBrief(expedition:boolean,hordeMode:boolean):string {
 const base='Abata pragas para ganhar XP e créditos. Abra baús e combine melhorias. ';
 if(expedition)return base+'Cada estágio começa numa ilha sorteada, longe do cálice: explore, abra baús e melhore o equipamento antes de ativá-lo. A ativação inicia a horda final com a Praga Alfa — quanto maior o seu nível, maior o reforço que ela traz. Elimine frutas próximas dentro da área para coletar suco. Com o cálice cheio e o chefe morto, volte ao cálice e use [E]: o suco é recolhido, a nave embarca você e a expedição continua em OUTRO bioma. Itens, nível e XP seguem com você; os créditos restantes viram XP no embarque.';
 if(hordeMode)return base+'Vença cada horda e recolha o item que cai no campo. A cada cinco ondas, enfrente uma Praga Alfa.';
 return base+'Contenha a infestação até a Praga Alfa aparecer, derrote-a e atravesse a fenda para avançar de estágio.';
}

export class RunHUD {
 private readonly element=document.createElement('div');private readonly controls=new AbortController();private inventoryKey='';private lastUpdate=-1;private statsKey='';
 // Referências resolvidas uma vez: `querySelector` por atualização percorria o HUD inteiro a cada painel.
 private readonly inventory:HtmlSlot;private readonly bearing:HtmlSlot;private readonly clockPanel:HtmlSlot;private readonly mission:HtmlSlot;
 private readonly contract:HtmlSlot;private readonly hostiles:HtmlSlot;private readonly interact:HtmlSlot;private readonly toast:HtmlSlot;
 private readonly statsPanel:HtmlSlot;private readonly route:HtmlSlot;private readonly meter:HtmlSlot;
 private readonly xpText:HTMLElement;private readonly xpFill:HTMLElement;
 private readonly bossBox:HTMLElement;private readonly bossFill:HTMLElement;private readonly bossText:HTMLElement;
 private readonly interactBox:HTMLElement;private readonly routeBox:HTMLElement;private readonly meterBox:HTMLElement;
 private readonly bars:MarkerPool<BarMarker>;private readonly damage:MarkerPool<Marker>;private readonly supplies:MarkerPool<SupplyMarker>;
 private readonly pickup:ItemPickupNotice;
 showItemPickup(id:string):void {this.pickup.show(id);}
 clearItemPickups():void {this.pickup.clear();}
 private decay='';
 // Seleção das barras próximas sem `filter`/`sort` por atualização: buffers reaproveitados.
 private readonly nearby:SwarmActor[]=[];private readonly nearbyKeys:number[]=[];
 private readonly world=new Vector3();private readonly screen=new Vector3();private readonly anchor=new Vector3();
 /**
  * Referencial dos marcadores de mundo. Resolvido do próprio `EnemySwarm` a cada atualização, então
  * a integração não precisa ligar nada. `useSurface` existe só para quem quiser injetar outro.
  */
 private surface:EnemySurface|undefined;
 private surfaceOverride:EnemySurface|undefined;
 private readonly objectiveForward=new Vector3(0,0,1);
 /** Porto opcional: quem passar um `FlatSurface` continua no caminho plano literal. */
 useSurface(surface:EnemySurface|undefined):void {this.surfaceOverride=radialSurfaceOf(surface);}
 constructor(){
  this.element.id='run-hud';this.element.innerHTML='<div class="run-inventory"></div><div class="run-clock"></div><div class="run-mission"></div><aside class="expedition-route" hidden></aside><div class="harvest-resonance" hidden></div><aside class="district-contract"></aside><div class="run-boss" hidden><span>PRAGA ALFA</span><div><i></i></div><small></small></div><div class="run-xp"><span></span><div><i></i></div></div><div class="run-hostiles"></div><div class="run-interact" hidden></div><div class="run-toast"></div><div class="damage-labels"></div><div class="run-bearing"></div><div class="world-supplies"></div><div class="enemy-health-bars"></div><aside class="run-stats" hidden></aside><small class="stats-hint">TAB · MAPA E ATRIBUTOS</small>';document.body.append(this.element);
  this.pickup=new ItemPickupNotice(this.element);
  const pick=(selector:string):HTMLElement=>this.element.querySelector(selector) as HTMLElement;
  this.inventory=new HtmlSlot(pick('.run-inventory'));this.bearing=new HtmlSlot(pick('.run-bearing'));this.clockPanel=new HtmlSlot(pick('.run-clock'));
  this.mission=new HtmlSlot(pick('.run-mission'));this.contract=new HtmlSlot(pick('.district-contract'));this.hostiles=new HtmlSlot(pick('.run-hostiles'));
  this.toast=new HtmlSlot(pick('.run-toast'));this.statsPanel=new HtmlSlot(pick('.run-stats'));
  this.interactBox=pick('.run-interact');this.interact=new HtmlSlot(this.interactBox);
  this.routeBox=pick('.expedition-route');this.route=new HtmlSlot(this.routeBox);
  this.meterBox=pick('.harvest-resonance');this.meter=new HtmlSlot(this.meterBox);
  const xp=pick('.run-xp');this.xpText=xp.querySelector('span') as HTMLElement;this.xpFill=xp.querySelector('i') as HTMLElement;
  this.bossBox=pick('.run-boss');this.bossFill=this.bossBox.querySelector('i') as HTMLElement;this.bossText=this.bossBox.querySelector('small') as HTMLElement;
  this.bars=new MarkerPool(pick('.enemy-health-bars'),buildBar);
  this.damage=new MarkerPool(pick('.damage-labels'),buildLabel);
  this.supplies=new MarkerPool(pick('.world-supplies'),buildSupply);
  window.addEventListener('keydown',event=>{if(event.code==='Tab'&&!event.repeat&&!this.element.hidden){event.preventDefault();const panel=this.statsPanel.node;panel.hidden=!panel.hidden;}},{signal:this.controls.signal});

 }
 get atlasOpen():boolean{return !this.statsPanel.node.hidden;}
 setVisible(visible:boolean):void {this.element.hidden=!visible;document.getElementById('player-hud')?.classList.toggle('run-active',visible);}
 /** Nós já criados pelos três pools de marcadores. Exposto para o teste de vazamento de DOM. */
 get pooledMarkers():number {return this.bars.size+this.damage.size+this.supplies.size;}
 /**
  * `camera` orienta apenas a seta da bússola. Toda distância e todo alcance de interação usam
  * `player`, senão o marco “acende” pela posição da câmera, que fica metros atrás do corpo.
  */
 update(run:RunProgression,swarm:EnemySwarm,interact:RunInteractables,camera:Camera,expedition?:{objectives:ExpeditionObjectives;resonance:HarvestResonance;mp:MPCharge;player:{x:number;y:number;z:number};weather?:WeatherCycle;journey?:StageJourneyView},economy?:EconomyMirror):void {
  /**
   * O SALDO EXIBIDO (contrato §21.2).
   *
   * Com sala, quem manda é o espelho replicado: a carteira do `RunProgression` local deixou de
   * receber recompensa quando a horda migrou, e mostrar aquele zero seria mentir para o jogador.
   * Isto é APRESENTAÇÃO — o número aparece e não decide nada; quem decide a compra é o servidor.
   */
  const credits=economy?.adopted?economy.credits:run.credits;
  if(run.time>=this.lastUpdate&&run.time-this.lastUpdate<UPDATE_PERIOD)return;this.lastUpdate=run.time;
  // Sem fiação nova: quem tem a horda já tem o referencial dela. Na fazenda isto é `undefined` e
  // todos os marcadores seguem pelo caminho plano literal.
  this.surface=this.surfaceOverride??swarm.surface;
  const key=[...run.inventory].join();if(key!==this.inventoryKey){this.inventoryKey=key;this.inventory.set([...run.inventory].slice(0,12).map(([id,count])=>{const item=ITEMS.find(x=>x.id===id)!;return `<div title="${item.name}: ${item.description}"><i class="item-icon" style='${perkIcon(item.icon)}'></i><b>×${count}</b></div>`;}).join('')+(run.inventory.size>12?'<small class=inventory-more>+'+(run.inventory.size-12)+' ITENS · TAB</small>':''));}
  const f=camera.getForwardRay().direction,heading=(Math.atan2(f.x,f.z)*180/Math.PI+360)%360,seconds=Math.floor(run.time);
  this.objectiveForward.copyFrom(f);
  this.bearing.set(`${['N','NE','L','SE','S','SO','O','NO'][Math.round(heading/45)%8]} · ${Math.round(heading)}°`);
  this.clockPanel.set(`<b>◷ ${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}</b><span>ESTÁGIO ${run.stage} · ${expedition?.objectives.planned?(expedition.objectives.phase==='extract'?'EMBARQUE LIBERADO':expedition.objectives.phase==='boss'?'HORDA FINAL':['NORMAL','CRESCENTE','DIFÍCIL','CAÓTICA','EXTREMA'][Math.min(4,swarm.director.state)]):['NORMAL','CRESCENTE','DIFÍCIL','CAÓTICA','PRAGA ALFA','FENDA'][swarm.director.state]}</span><strong>◈ ${credits} CRÉDITOS</strong><em class="run-weather">${expedition?.weather?.label??''}</em>`);
  this.renderExpedition(expedition,heading);
  this.mission.set(expedition?.journey?.active?`${expedition.journey.label} · ${expedition.journey.destination}`
   :expedition?.objectives.planned?this.expeditionMission(expedition.objectives,expedition.player,heading):swarm.director.hordeMode?(swarm.director.intermission>0?'PRÓXIMA HORDA EM '+Math.ceil(swarm.director.intermission)+' s':swarm.director.wave%5===0?'ELIMINE O CHEFE E SUA HORDA':'SOBREVIVA À HORDA '+swarm.director.wave):swarm.bossDeadTime>=5?'ENTRE NA FENDA · CELEIRO':swarm.bossDeadTime>=0?'PRAGA ALFA DERROTADA':swarm.boss?'ELIMINE A PRAGA ALFA':['LOCALIZE A PRAGA ALFA','CONTENHA A INFESTAÇÃO','SOBREVIVA AO SURTO','RESISTA À COLHEITA FINAL','A PRAGA ALFA SE APROXIMA'][swarm.director.state]??'');

  const radial=radialSurfaceOf(this.surface);
  const nearChest=interact.entries.filter(e=>!e.used&&e.kind!=='altar').map(e=>({entry:e,d:radial?radial.planarDistance(camera.position,e):Math.hypot(e.x-camera.position.x,e.z-camera.position.z)})).sort((a,b)=>a.d-b.d)[0];
  const delta=nearChest?new Vector3(nearChest.entry.x-camera.position.x,nearChest.entry.y-camera.position.y,nearChest.entry.z-camera.position.z):Vector3.Zero();
  const up=radial?.up(camera.position)??{x:0,y:1,z:0};
  const right=Vector3.Cross(new Vector3(up.x,up.y,up.z),f).normalize();
  const lootArrow=COMPASS[(Math.round(Math.atan2(Vector3.Dot(delta,right),Vector3.Dot(delta,f))*4/Math.PI)+8)%8];

  const reward=interact.waveRewardGuide;
  // A dica da recompensa é o último filho do contrato; concatenar aqui dá o mesmo DOM que o
  // `insertAdjacentHTML('beforeend')` anterior e mantém o painel inteiro sob uma única comparação.
  const rewardHint=reward?`<span class="wave-reward-guide"><b>◈ RECOMPENSA DA HORDA</b><br>${reward.drop.item.name}<br><small>${reward.drop.waveField} · ${COMPASS[Math.round(((Math.atan2(reward.drop.landing.x-camera.position.x,reward.drop.landing.z-camera.position.z)*180/Math.PI-heading+720)%360)/45)%8]} ${Math.round(reward.distance)} m · [E] recolher</small></span>`:'';
  const contract=interact.districtContract;
  const bonus=contract?`<small>${contract.contract.name}: ${contract.opened}/${contract.required} baús → item bônus.</small>`:'';
  this.contract.set('<small>FIQUE MAIS FORTE</small><b>Abata → ganhe créditos → abra baús</b>'+(nearChest?`<span>${lootArrow} BAÚ · ${Math.round(nearChest.d)} m · ${nearChest.entry.cost} créditos</span><small>${credits>=nearChest.entry.cost?'Você pode abrir este baú. Aproxime-se e aperte [E].':`Faltam ${nearChest.entry.cost-credits} créditos: derrote mais frutas.`} Depois, [E] recolhe o item.</small>`:'<span>Baús esgotados: procure o cálice para avançar.</span>')+'<small>Explore as pontes → encontre e ative o cálice → encha de suco e derrote o chefe → [E] embarque.</small>'+bonus+rewardHint);

  text(this.xpText,`NV. ${run.level} · ${run.xp} / ${run.nextLevelXP} XP`);css(this.xpFill,'width',pct(run.xp/run.nextLevelXP*100));
  this.hostiles.set(`<span>ONDA ${swarm.director.hordeMode?swarm.director.wave:Math.floor(swarm.director.time/36)+1}</span><b>${swarm.count} / ${swarm.populationCap}</b><small>${swarm.kills} abatidos · ${swarm.director.hordeMode?(swarm.director.intermission>0?(swarm.director.completedWaves>0?'RECOLHA O ITEM · PREPARE-SE':'PREPARE-SE'):Math.max(0,swarm.director.waveQuota-swarm.director.spawned)+' por nascer'):(swarm.director.time%36>27?'REAGRUPE-SE':'HORDA ATIVA')}</small>`);
  shown(this.bossBox,Boolean(swarm.boss)&&swarm.bossHP>0);css(this.bossFill,'width',pct(swarm.bossHP/swarm.bossMaxHP*100));text(this.bossText,`${Math.ceil(swarm.bossHP)} / ${swarm.bossMaxHP}`);
  const entry=interact.nearest,loot=interact.nearestLoot;
  const totem=expedition?.objectives.interactable(expedition.player);
  const boarding=expedition?.objectives.collectable(expedition.player);
  // A fenda do celeiro só sobrevive nos modos legados; a expedição termina no próprio cálice.
  const riftOpen=expedition?.objectives.planned?false:swarm.bossDeadTime>=5;
  shown(this.interactBox,Boolean(entry||loot||totem||(riftOpen&&interact.atRift)));
  this.interact.set(riftOpen&&interact.atRift?'<b>[E] ATRAVESSAR A FENDA</b><span>Créditos restantes viram XP.</span>'
   :boarding?'<b>[E] RECOLHER O SUCO · EMBARCAR</b><span>A nave leva a expedição para outro bioma. Itens, nível e XP seguem com você; os créditos restantes viram XP.</span>'
   :totem?`<b>[E] ATIVAR CÁLICE · INICIAR HORDA FINAL</b><span>A Praga Alfa virá. Colete ${totem.site.juiceTarget} unidades de suco e derrote o chefe. Explore e melhore o equipamento antes: o reforço da horda acompanha o seu nível.</span>`:loot?`<b><i class="item-icon" style='${perkIcon(loot.item.icon)}'></i>${loot.item.name}</b><span>${loot.item.description}</span><span>[E] Recolher item</span>`:entry?`<b>${entry.name} · ◈ ${entry.cost}</b><span>[E] ${entry.kind==='altar'?'Oferecer créditos · 58% de chance':'Abrir · item aleatório'}</span>`:'');
  this.toast.set(interact.messageTime>0?interact.message:'');
  this.renderStats(run,Boolean(expedition?.objectives.planned),swarm.director.hordeMode);
  const engine=camera.getEngine(),width=engine.getRenderWidth(),height=engine.getRenderHeight(),viewport=camera.viewport.toGlobal(width,height),transform=camera.getTransformationMatrix();
  const project=(x:number,y:number,z:number):boolean=>{
   Vector3.ProjectToRef(this.world.set(x,y,z),IDENTITY,transform,viewport,this.screen);
   const p=this.screen;return p.z>=0&&p.z<=1&&p.x>=0&&p.x<=width&&p.y>=0&&p.y<=height;
  };
  this.damage.begin();
  for(const l of swarm.labels){
   // O número de dano sobe 0,8 m na vertical LOCAL do golpe, não no `+Y` do mundo.
   this.lift(l.position,(1-l.time)*.8,this.anchor);
   if(!project(this.anchor.x,this.anchor.y,this.anchor.z))continue;
   const marker=this.damage.take();
   // Acerto direto no ponto fraco tem classe PRÓPRIA: o jogador precisa distinguir "tive sorte no
   // crítico" de "acertei a asa". Mesmo pool de nós, nenhuma alocação nova.
   classes(marker.root,l.weak?'crit weak':l.crit?'crit':'');
   css(marker.root,'left',pct(this.screen.x/width*100));css(marker.root,'top',pct(this.screen.y/height*100));
   css(marker.root,'opacity',String(Math.round(Math.min(1,l.time*3)*100)/100));
   text(marker.root,`${l.amount}${l.weak?'✦':l.crit?'!':''}`);
  }
  this.damage.end();
  const near=this.selectNearby(swarm,camera);
  this.bars.begin();
  for(let i=0;i<near;i++){
   const a=this.nearby[i]!;
   this.headAnchor(a,this.anchor);
   if(!project(this.anchor.x,this.anchor.y,this.anchor.z))continue;
   const marker=this.bars.take();
   classes(marker.root,`enemy-health variant-${a.variant}${a.hit>0?' damaged':''}`);
   css(marker.root,'left',pct(this.screen.x/width*100));css(marker.root,'top',pct(this.screen.y/height*100));
   css(marker.trail,'width',pct(a.healthTrail/a.health.maximum*100));css(marker.fill,'width',pct(a.health.current/a.health.maximum*100));
   attr(marker.root,'aria-label',`${ENEMIES[a.kind].name} ${ENEMY_AFFIXES[a.variant].label}: ${Math.ceil(a.health.current)} de ${a.health.maximum} de vida`);
  }
  this.bars.end();
  this.supplies.begin();
  for(const e of interact.entries){
   if(e.used)continue;
   // Distância CAMINHÁVEL (arco na esfera) e etiqueta 1,8 m acima na vertical local do baú.
   const d=this.surface?this.surface.planarDistance(e,camera.position):Math.hypot(e.x-camera.position.x,e.z-camera.position.z);
   this.lift(e,1.8,this.anchor);
   if(d>=55||d<=3||!project(this.anchor.x,this.anchor.y,this.anchor.z))continue;
   const marker=this.supplies.take();
   css(marker.root,'left',pct(this.screen.x/width*100));css(marker.root,'top',pct(this.screen.y/height*100));
   css(marker.root,'opacity',String(Math.round(Math.min(1,(55-d)/15)*100)/100));
   text(marker.cost,`${e.kind==='altar'?'ALTAR':'BAÚ'} · ${e.cost} ◈`);
  }
  this.supplies.end();
 }
 /** `p` deslocado `height` metros na vertical LOCAL. Sem superfície é o `+Y` de sempre. */
 private lift(p:{x:number;y:number;z:number},height:number,out:Vector3):Vector3 {
  if(!this.surface)return out.copyFromFloats(p.x,p.y+height,p.z);
  const up=this.surface.up(p);
  return out.copyFromFloats(p.x+up.x*height,p.y+up.y*height,p.z+up.z*height);
 }
 /**
  * Ponto logo acima da CABEÇA da praga, que é onde a barra é ancorada.
  *
  * No plano é literalmente a expressão de sempre: o topo da caixa em `y`, sobre o `x`/`z` do corpo.
  *
  * Na esfera "acima da cabeça" não é `+Y` — é a radial DAQUELE ponto. Usar o `maximumWorld.y` numa
  * ilha fora do polo norte ancorava a barra num ponto que não fica sobre o corpo (e muitas vezes
  * dentro do convés ou fora do tronco de visão), e a barra simplesmente sumia. O topo agora é medido
  * projetando os oito cantos da caixa na vertical local — o análogo exato de `maximumWorld.y`, e
  * independente de como o corpo está girado.
  */
 private headAnchor(a:SwarmActor,out:Vector3):Vector3 {
  const box=a.body.getBoundingInfo().boundingBox,p=a.root.position;
  if(!this.surface)return out.copyFromFloats(p.x,box.maximumWorld.y+.22,p.z);
  const up=this.surface.up(p);
  let top=0;
  for(const corner of box.vectorsWorld){
   const along=(corner.x-p.x)*up.x+(corner.y-p.y)*up.y+(corner.z-p.z)*up.z;
   if(along>top)top=along;
  }
  return this.lift(p,top+.22,out);
 }
 /**
  * As `NEARBY_BARS` pragas vivas mais próximas, ordenadas como antes (distância 3D à câmera,
  * recorte 2D em `NEARBY_RANGE`), mas por inserção num buffer fixo.
  *
  * O `filter().sort()` anterior alocava um array por atualização e recalculava `DistanceSquared`
  * dentro do comparador — O(n log n) distâncias para ficar com doze. Aqui cada ator é medido uma
  * única vez.
  *
  * O recorte plano `dx² + dz²` NÃO vale numa esfera: dois corpos em lados opostos do globo têm o
  * mesmo `(x, z)` e passariam pelo teste, roubando as doze vagas de quem está de fato ao lado do
  * jogador — barras aparecendo para quem não se vê, e faltando para quem está na sua cara. Na
  * esfera o recorte é o ARCO no convés e a altura é medida na vertical local, que é a mesma métrica
  * que a horda usa para alcance de ataque.
  */
 private selectNearby(swarm:EnemySwarm,camera:Camera):number {
  const actors=this.nearby,keys=this.nearbyKeys,eye=camera.position,surface=this.surface;let count=0;
  for(const a of swarm.actors){
   if(!a.active||a.health.dead)continue;
   let key:number;
   if(surface){
    const arc=surface.planarDistance(a.root.position,eye);
    if(arc>=NEARBY_RANGE)continue;
    const lift=surface.heightGap(a.root.position,eye);
    key=arc*arc+lift*lift;
   }else{
    const dx=a.root.position.x-eye.x,dz=a.root.position.z-eye.z;
    if(dx*dx+dz*dz>=NEARBY_RANGE*NEARBY_RANGE)continue;
    const dy=a.root.position.y-eye.y;key=dx*dx+dy*dy+dz*dz;
   }
   if(count===NEARBY_BARS&&key>=keys[NEARBY_BARS-1]!)continue;
   let i=Math.min(count,NEARBY_BARS-1);
   for(;i>0&&keys[i-1]!>key;i--){actors[i]=actors[i-1]!;keys[i]=keys[i-1]!;}
   actors[i]=a;keys[i]=key;
   if(count<NEARBY_BARS)count++;
  }
  return count;
 }
 /**
  * Painel TAB. Refazê-lo custa uma busca em `ITEMS` por item do inventário mais um `innerHTML`
  * grande, então ele só é reconstruído quando nível, atributos, modo ou inventário mudam — e não
  * dez vezes por segundo enquanto nada muda.
  */
 private renderStats(run:RunProgression,expedition:boolean,hordeMode:boolean):void {
  const stats=run.stats,brief=modeBrief(expedition,hordeMode);
  const rows:readonly (readonly [string,string])[]=[['Vida máxima',stats.maxHP.toFixed(0)],['Dano',`${Math.round(stats.damage*100)}%`],['Cadência',`${Math.round(stats.attackSpeed*100)}%`],['Armadura',stats.armor.toFixed(0)],['Crítico',`${Math.round(stats.crit*100)}%`],['Velocidade',`${Math.round(stats.moveSpeed*100)}%`],['Altura do salto',`${Math.round(stats.jump*100)}%`],['Pulos aéreos',String(stats.extraJumps)],['Recarga da esquiva',`${Math.round(stats.dodgeRecharge*100)}%`],['Regeneração',`${stats.regeneration.toFixed(1)} HP/s`],['Poder de habilidade',`${Math.round(stats.mp*100)}%`]];
  const key=`${run.level}|${this.inventoryKey}|${expedition?'e':hordeMode?'h':'c'}|${rows.map(row=>row[1]).join('·')}`;
  if(key===this.statsKey)return;this.statsKey=key;
  // Copy do MODO em curso: o texto antigo prometia chefe a cada cinco ondas mesmo na expedição.
  this.statsPanel.set(`<h2>EXTERMINADOR · NÍVEL ${run.level}</h2><p>${brief}</p><dl>${rows.map(([label,value])=>`<dt>${label}</dt><dd>${value}</dd>`).join('')}</dl><small>Dourado: defesa e ouro · Gigante: atributos ×3 · Luminoso: dano e ataque extra</small><div class=inventory-detail>${[...run.inventory].map(([id,count])=>{const item=ITEMS.find(i=>i.id===id)!;return `<div title="${item.description}"><i class=item-icon style='${perkIcon(item.icon)}'></i><span>${item.name}<small>×${count} · ${item.description}</small></span></div>`;}).join('')}</div>`);
 }
 private objectiveArrow(from:Vec3,to:Vec3,heading:number):string {
  const surface=radialSurfaceOf(this.surface);
  return surface?objectiveBearing(from,to,this.objectiveForward,surface.up(from)):bearingArrow(from,to,heading);
 }
 private objectiveDistance(from:Vec3,to:Vec3):number {
  return this.surface?.planarDistance(from,to)??Math.hypot(to.x-from.x,to.z-from.z);
 }
 private expeditionMission(objectives:ExpeditionObjectives,player:{x:number;y:number;z:number},heading:number):string {
  if(objectives.phase==='extract'){
   const chalice=objectives.totems[0];
   if(objectives.collectable(player))return '[E] RECOLHER O SUCO · EMBARCAR';
   return chalice?`VOLTE AO CÁLICE · ${this.objectiveArrow(player,chalice.site.position,heading)} ${Math.round(this.objectiveDistance(player,chalice.site.position))} m`:'VOLTE AO CÁLICE';
  }
  const current=objectives.current;
  if(objectives.phase==='boss'){
   if(current?.state==='complete')return 'CÁLICE CHEIO · DERROTE A PRAGA ALFA';
   if(current?.state==='paused')return 'VOLTE À ÁREA DO CÁLICE · COLETE SUCO';
   return `HORDA FINAL · ${Math.floor(current?.charged??0)}/${current?.site.juiceTarget??60} SUCO · ${objectives.bossDefeated?'CHEFE DERROTADO':'DERROTE O CHEFE'}`;
  }
  if(!objectives.discovered)return 'EXPLORE AS ILHAS · ENCONTRE O CÁLICE';
  const next=objectives.nearestPending(player);
  if(next){
   if(objectives.interactable(player))return `[E] ATIVE O CÁLICE · ${next.totem.site.name}`;
   return `SIGA ${this.objectiveArrow(player,next.totem.site.position,heading)} ${next.totem.site.name} · ${Math.round(next.distance)} m`;
  }
  return 'EXPLORE AS ILHAS · ENCONTRE O CÁLICE';
 }
 /** Busca, destino descoberto, carga da horda final e ressonância. */
 private renderExpedition(expedition:{objectives:ExpeditionObjectives;resonance:HarvestResonance;mp:MPCharge;player:{x:number;y:number;z:number};weather?:WeatherCycle;journey?:StageJourneyView}|undefined,heading:number):void {
  const objectives=expedition?.objectives;
  shown(this.routeBox,Boolean(objectives?.planned));shown(this.meterBox,Boolean(objectives?.planned));
  if(!expedition||!objectives?.planned)return;
  const player=expedition.player,pending=objectives.nearestPending(player);
  const marks=objectives.discovered?objectives.totems.map(totem=>{
   const distance=this.objectiveDistance(player,totem.site.position);
   const percent=Math.round(totem.charged/totem.site.juiceTarget*100);
   const label=totem.state==='complete'?'CHEIO':totem.state==='charging'?`${Math.floor(totem.charged)}/${totem.site.juiceTarget} SUCO · ${percent}%`:totem.charged>0?`PAUSADO ${percent}%`:`${totem.site.juiceTarget} SUCO`;
   return `<li class="totem-${totem.state}${pending?.totem===totem?' totem-target':''}"><b>${totem.site.index+1}</b><span>${totem.site.name}<small>${label}</small></span><em>${this.objectiveArrow(player,totem.site.position,heading)} ${Math.round(distance)} m</em><i style="width:${Math.min(100,percent)}%"></i></li>`;
  }).join(''):'';
  const header=expedition.journey?.active?'CONCLUSÃO DO ESTÁGIO':objectives.phase==='extract'?'PRONTO PARA EMBARCAR':objectives.phase==='boss'?'HORDA FINAL':objectives.discovered?(objectives.signalAcquired?'SINAL DO CÁLICE':'CÁLICE ENCONTRADO'):'BUSCA DO CÁLICE';
  const footer=expedition.journey?.active?expedition.journey.detail
   :objectives.messageTime>0?objectives.message
   :objectives.phase==='extract'?(objectives.collectable(player)?'[E] recolhe o suco e chama a nave. A expedição continua em outro bioma.':'Recolha a recompensa e volte ao cálice para embarcar.')
   :objectives.interactable(player)?'[E] Ativar inicia a horda final com chefe. Prepare seus itens antes.'
   :objectives.current?.state==='complete'?'O cálice está cheio. Derrote a Praga Alfa para poder embarcar.'
   :objectives.current?`${objectives.bossDefeated?'Chefe derrotado. ':''}Elimine frutas próximas dentro da área para coletar suco.`
   // A busca nunca é infinita: o sinal chega depois de `CHALICE_SIGNAL_SECONDS` de exploração e a
   // dica passa a dizer de onde veio o rumo, em vez de prometer um feixe que não existia ainda.
   :objectives.signalAcquired?'Sinal adquirido: o cálice está marcado no mapa (TAB). Siga o rumo e ative quando estiver preparado.'
   :objectives.discovered?'Siga o feixe âmbar até o cálice. Ative quando estiver preparado.'
    :`Explore as ilhas e suas pontes para encontrar o cálice — o sinal o revela em ${Math.max(0,Math.ceil((CHALICE_SIGNAL_SECONDS-objectives.searchSeconds)/60))} min de busca. Abra baús e melhore seus equipamentos pelo caminho.`;
  this.route.set(`<small>${header}</small><ul>${marks}</ul><span class="route-hint">${footer}</span>`);
  const resonance=expedition.resonance;
  const charges=expedition.mp.maxCharges
   ?`<span class="skill-charges">ESPECIAL ${expedition.mp.charges}/${expedition.mp.maxCharges}${expedition.mp.charges<expedition.mp.maxCharges?` · +1 em ${Math.ceil(expedition.mp.chargeSecondsLeft)} s`:' · PRONTA'}</span>`
   :'';
  this.meter.set(`<small>RESSONÂNCIA DA COLHEITA</small><div>${[0,1,2].map(i=>`<i class="${resonance.level>i?'lit':''}"></i>`).join('')}</div><span>${resonance.level?`+${Math.round((resonance.chargeMultiplier-1)*100)}% na carga · alterne ${resonance.nextAction.map(a=>a==='shot'?'tiro':a==='melee'?'golpe':'ar').join(' ou ')}`:'Alterne tiro, golpe e ação aérea'}</span>${charges}`);
  const decay=String(Math.round(resonance.decayProgress*1000)/1000);
  if(decay!==this.decay){this.decay=decay;this.meterBox.style.setProperty('--resonance-decay',decay);}
 }
 dispose():void {this.pickup.dispose();this.controls.abort();this.element.remove();}
}

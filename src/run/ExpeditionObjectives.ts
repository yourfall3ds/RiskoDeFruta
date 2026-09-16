import type {Vec3} from '../core/contracts';

/** Juice units required by each chalice, independent of elapsed time. */
export const CHALICE_JUICE_TARGETS=[40,60,80,100] as const;
export const CHALICE_CAPTURE_RADIUS=26;
export const FRUIT_JUICE:Readonly<Record<string,number>>={carrot:1,corn:2,tomato:2,eggplant:3,watermelon:4,boss:20};
export const TOTEM_RADIUS=11;
/** Distância de uso do `E`: junto ao poste. A carga vale em toda a área de raio `TOTEM_RADIUS`. */
export const TOTEM_ACTIVATION_RANGE=3.5;
/** Segundos sem rota até o chefe antes de recuperá-lo para perto do jogador. */
export const BOSS_RECOVERY_SECONDS=6;

export interface TotemAnchor {id:string;name:string;x:number;y:number;z:number}
export interface TotemSite {id:string;name:string;index:number;position:Vec3;radius:number;juiceTarget:number}
export type TotemState='available'|'charging'|'paused'|'complete';
export interface TotemProgress {site:TotemSite;charged:number;state:TotemState}
export type ExpeditionPhase='totems'|'boss'|'rift';

/** Consultas mínimas de mundo; mantém a simulação testável sem Babylon. */
export interface ExpeditionTerrain {
  groundAt(x:number,z:number,maxHeight?:number,maxSlope?:number):number;
  insideSolid(p:Vec3,height?:number):boolean;
}

const planar=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);

/**
 * Piso contínuo e largo o bastante para combater: descarta pontes estreitas, interiores sólidos
 * e beiradas onde o jogador cairia ao recuar. Amostra dois anéis para não aprovar um corredor.
 */
export function isOpenGround(world:ExpeditionTerrain,x:number,z:number,y:number,radius:number,samples=12):boolean {
  for(let i=0;i<samples;i++){
    const angle=i/samples*Math.PI*2;
    for(const r of [radius*.45,radius]){
      const px=x+Math.sin(angle)*r,pz=z+Math.cos(angle)*r;
      const py=world.groundAt(px,pz,y+2.4);
      if(!Number.isFinite(py)||Math.abs(py-y)>3.5)return false;
      if(world.insideSolid({x:px,y:py,z:pz},1.8))return false;
    }
  }
  return true;
}

/** Procura um centro válido em anéis crescentes ao redor da âncora do distrito. */
export function findTotemSite(world:ExpeditionTerrain,anchor:TotemAnchor,radius:number,reachable:(p:Vec3)=>boolean):Vec3|undefined {
  for(const ring of [0,7,14,21]){
    for(let i=0;i<(ring?12:1);i++){
      const angle=i*Math.PI/6,x=anchor.x+Math.sin(angle)*ring,z=anchor.z+Math.cos(angle)*ring;
      const y=world.groundAt(x,z,anchor.y+3.5);
      if(!Number.isFinite(y)||Math.abs(y-anchor.y)>9)continue;
      if(world.insideSolid({x,y,z},1.8))continue;
      if(!isOpenGround(world,x,z,y,radius))continue;
      if(!reachable({x,y,z}))continue;
      return {x,y,z};
    }
  }
  return undefined;
}

/** Quatro marcos alcançáveis e separados, ordenados por proximidade do ponto de partida. */
export function planExpedition(world:ExpeditionTerrain,anchors:readonly TotemAnchor[],origin:Vec3,reachable:(p:Vec3)=>boolean,count=4,radius=TOTEM_RADIUS):TotemSite[] {
  const sorted=[...anchors].sort((a,b)=>planar(a,origin)-planar(b,origin));
  const sites:TotemSite[]=[];
  for(const anchor of sorted){
    if(sites.length>=count)break;
    const position=findTotemSite(world,anchor,radius,reachable);
    if(!position)continue;
    if(sites.some(site=>planar(site.position,position)<radius*2.2))continue;
    sites.push({id:anchor.id,name:anchor.name,index:sites.length,position,radius,juiceTarget:CHALICE_JUICE_TARGETS[sites.length]??CHALICE_JUICE_TARGETS[CHALICE_JUICE_TARGETS.length-1]!});
  }
  return sites;
}

/**
 * Four activated chalices filled by nearby combat deaths, then a boss and the rift.
 * Nada aqui depende de zerar a população — o diretor continua ativo durante toda a carga.
 */
export class ExpeditionObjectives {
  readonly totems:TotemProgress[]=[];
  phase:ExpeditionPhase='totems';
  activeIndex=-1;
  bossSpawned=false;bossDefeated=false;bossRecoveries=0;
  rewardsPending=0;
  message='';messageTime=0;
  private bossUnreachable=0;
  private lastHarvestSequence=-1;
  private readonly rewardPositions:Vec3[]=[];
  get nextRewardPosition():Vec3|undefined{return this.rewardPositions[0];}
  /** Juice yield multiplier from varied combat; it never creates passive progress. */
  chargeMultiplier=1;

  setSites(sites:readonly TotemSite[]):void {
    this.totems.length=0;
    for(const site of sites)this.totems.push({site,charged:0,state:'available'});
    this.activeIndex=-1;this.phase='totems';
  }
  get planned():boolean {return this.totems.length>0;}
  get completed():number {return this.totems.filter(t=>t.state==='complete').length;}
  get total():number {return this.totems.length;}
  get current():TotemProgress|undefined {return this.totems[this.activeIndex];}
  inside(totem:TotemProgress,player:Vec3):boolean {
    return planar(totem.site.position,player)<=totem.site.radius&&Math.abs(player.y-totem.site.position.y)<=8;
  }
  /** Marco mais próximo ainda pendente; é ele que o HUD aponta. */
  nearestPending(player:Vec3):{totem:TotemProgress;distance:number}|undefined {
    const pending=this.totems.filter(t=>t.state!=='complete');
    if(!pending.length)return undefined;
    const active=this.current;
    const totem=active&&active.state!=='complete'?active:pending.reduce((a,b)=>planar(a.site.position,player)<=planar(b.site.position,player)?a:b);
    return {totem,distance:planar(totem.site.position,player)};
  }
  /** Marco ao alcance do `E`, para o HUD anunciar a ação antes de o jogador apertar. */
  interactable(player:Vec3):TotemProgress|undefined {
    return this.phase==='totems'
      ?this.totems.filter(t=>t.state!=='complete'&&t.state!=='charging'&&planar(t.site.position,player)<=TOTEM_ACTIVATION_RANGE&&Math.abs(player.y-t.site.position.y)<=4).sort((a,b)=>planar(a.site.position,player)-planar(b.site.position,player))[0]
      :undefined;
  }
  /** `E` junto ao poste: ativa e passa a carregar. Ativar outro pausa o anterior sem apagar a carga. */
  activate(player:Vec3):TotemProgress|undefined {
    if(this.phase!=='totems')return undefined;
    const candidate=this.totems.filter(t=>t.state!=='complete'&&planar(t.site.position,player)<=TOTEM_ACTIVATION_RANGE&&Math.abs(player.y-t.site.position.y)<=4).sort((a,b)=>planar(a.site.position,player)-planar(b.site.position,player))[0];
    if(!candidate)return undefined;
    const previous=this.current;
    if(previous&&previous!==candidate&&previous.state!=='complete')previous.state='paused';
    this.activeIndex=this.totems.indexOf(candidate);
    candidate.state='charging';
    this.say(`CÁLICE ${candidate.site.index+1} ATIVO · elimine frutas próximas para coletar suco`,4);
    return candidate;
  }
  update(dt:number,player:Vec3,alive:boolean):void {
    this.messageTime=Math.max(0,this.messageTime-dt);
    if(this.phase!=='totems')return;
    const totem=this.current;
    if(totem&&totem.state!=='complete'){
      if(alive&&this.inside(totem,player)){
        totem.state='charging';
      } else totem.state='paused';
    }
    if(this.total>0&&this.completed>=this.total){this.phase='boss';this.say('A PRAGA ALFA DESPERTOU',5);}
  }
  /** Called once for each actual combat death; sequence survives pooled actor ID reuse. */
  harvest(kill:{sequence:number;kind:string;position:Vec3},player:Vec3,alive:boolean):{index:number;amount:number;complete:boolean}|undefined {
    if(!Number.isSafeInteger(kill.sequence)||kill.sequence<=this.lastHarvestSequence)return;
    this.lastHarvestSequence=kill.sequence;
    const totem=this.current,yieldUnits=FRUIT_JUICE[kill.kind];
    if(!alive||this.phase!=='totems'||!totem||totem.state==='complete'||!yieldUnits||!this.inside(totem,player))return;
    if(planar(kill.position,totem.site.position)>CHALICE_CAPTURE_RADIUS||Math.abs(kill.position.y-totem.site.position.y)>12)return;
    const amount=Math.min(totem.site.juiceTarget-totem.charged,yieldUnits*Math.max(0,this.chargeMultiplier));
    if(amount<=0)return;
    totem.charged+=amount;totem.state='charging';
    const complete=totem.charged>=totem.site.juiceTarget;
    if(complete){
      totem.state='complete';this.activeIndex=-1;this.rewardsPending++;
      this.rewardPositions.push({...kill.position});
      this.say(`CÁLICE ${totem.site.index+1} CHEIO · recolha a recompensa`,6);
      if(this.completed>=this.total){this.phase='boss';this.say('OS CÁLICES ESTÃO CHEIOS · A PRAGA ALFA DESPERTOU',6);}
    }
    return{index:totem.site.index,amount,complete};
  }
  /** O chamador informa se ainda existe rota até o chefe; sem rota por tempo demais ele é recuperado. */
  updateBoss(dt:number,reachable:boolean):void {
    if(this.phase!=='boss'||!this.bossSpawned||this.bossDefeated){this.bossUnreachable=0;return;}
    this.bossUnreachable=reachable?0:this.bossUnreachable+dt;
  }
  get needsBossRecovery():boolean {return this.bossUnreachable>=BOSS_RECOVERY_SECONDS;}
  recoveredBoss():void {this.bossUnreachable=0;this.bossRecoveries++;this.say('A PRAGA ALFA VOLTOU AO CAMPO',4);}
  onBossKilled():void {if(this.bossDefeated)return;this.bossDefeated=true;this.phase='rift';this.say('FENDA ABERTA · atravesse para avançar de estágio',8);}
  takeReward():boolean {if(this.rewardsPending<=0)return false;this.rewardsPending--;this.rewardPositions.shift();return true;}
  private say(message:string,seconds:number):void {this.message=message;this.messageTime=seconds;}
  reset():void {
    for(const totem of this.totems){totem.charged=0;totem.state='available';}
    this.activeIndex=-1;this.phase='totems';this.bossSpawned=false;this.bossDefeated=false;
    this.bossUnreachable=0;this.bossRecoveries=0;this.rewardsPending=0;this.message='';this.messageTime=0;this.chargeMultiplier=1;
    this.lastHarvestSequence=-1;this.rewardPositions.length=0;
  }
}

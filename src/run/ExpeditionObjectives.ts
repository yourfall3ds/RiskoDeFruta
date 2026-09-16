import type {Vec3} from '../core/contracts';
import type {RandomStream} from '../core/RunRNG';

/** Juice units required by each chalice, independent of elapsed time. */
export const CHALICE_JUICE_TARGETS=[40,60,80,100] as const;
export const CHALICE_CAPTURE_RADIUS=26;
export const FINAL_CHALICE_JUICE=60;
export const CHALICE_DISCOVERY_RADIUS=35;
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
/**
 * `extract` substitui a antiga fase `rift`: o cálice cheio com o chefe morto NÃO abre mais uma fenda
 * fixa no celeiro. O jogador volta ao próprio cálice, recolhe o suco com `E` e embarca na nave.
 */
export type ExpeditionPhase='totems'|'boss'|'extract';

/** Consultas mínimas de mundo; mantém a simulação testável sem Babylon. */
export interface ExpeditionTerrain {
  groundAt(x:number,z:number,maxHeight?:number,maxSlope?:number):number;
  insideSolid(p:Vec3,height?:number):boolean;
  sweepSphere(origin:Vec3,delta:Vec3,radius:number,mesh?:boolean):unknown;
}

const planar=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);

/**
 * Piso contínuo e largo o bastante para combater: descarta pontes estreitas, interiores sólidos
 * e beiradas onde o jogador cairia ao recuar. Amostra dois anéis para não aprovar um corredor.
 */
export function isOpenGround(world:ExpeditionTerrain,x:number,z:number,y:number,radius:number,samples=12):boolean {
  // Reject roofs and enclosed buildings; broad floor samples alone can jump over thin walls.
  if(world.sweepSphere({x,y:y+1,z},{x:0,y:8,z:0},.4,true))return false;
  for(let i=0;i<samples;i++){
    const angle=i/samples*Math.PI*2;
    if(world.sweepSphere({x,y:y+2.5,z},{x:Math.sin(angle)*radius,y:0,z:Math.cos(angle)*radius},.6,true))return false;
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

/** Candidatos alcançáveis e separados para escolher a arena final do estágio. */
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

/** One reachable destination per stage, beyond the arrival field whenever the map allows it. */
export function chooseChalice(sites:readonly TotemSite[],origin:Vec3,rng:RandomStream):TotemSite|undefined {
 const away=sites.filter(s=>planar(s.position,origin)>=60);
 const pool=away.length?away:sites.filter(s=>s.id!=='initial-field');
 if(!pool.length)return undefined;
 return {...rng.pick(pool),index:0,juiceTarget:FINAL_CHALICE_JUICE};
}

/**
 * One hidden chalice: activation starts the final horde and boss. Juice plus boss unlock the rift.
 * Nada aqui depende de zerar a população — o diretor continua ativo durante toda a carga.
 */
export class ExpeditionObjectives {
  readonly totems:TotemProgress[]=[];
  phase:ExpeditionPhase='totems';
  discovered=false;
  activeIndex=-1;
  bossSpawned=false;bossDefeated=false;bossRecoveries=0;
  /** O suco do cálice concluído já foi recolhido com `E`; impede um segundo embarque. */
  collected=false;
  rewardsPending=0;
  message='';messageTime=0;
  private bossUnreachable=0;
  private lastHarvestSequence=-1;
  private readonly rewardPositions:Vec3[]=[];
  get nextRewardPosition():Vec3|undefined{return this.rewardPositions[0];}
  /** Juice yield multiplier from varied combat; it never creates passive progress. */
  chargeMultiplier=1;

  setSites(sites:readonly TotemSite[]):void {
    this.reset();
    this.totems.length=0;
    for(const site of sites.slice(0,1))this.totems.push({site:{...site,index:0},charged:0,state:'available'});
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
  /** Junto ao poste: o mesmo alcance vale para ativar e, depois, para recolher o suco. */
  private atHand(totem:TotemProgress,player:Vec3):boolean {
    return planar(totem.site.position,player)<=TOTEM_ACTIVATION_RANGE&&Math.abs(player.y-totem.site.position.y)<=4;
  }
  /** Marco ao alcance do `E`, para o HUD anunciar a ação antes de o jogador apertar. */
  interactable(player:Vec3):TotemProgress|undefined {
    if(this.phase==='extract')return this.collectable(player);
    return this.phase==='totems'
      ?this.totems.filter(t=>t.state!=='complete'&&t.state!=='charging'&&this.atHand(t,player)).sort((a,b)=>planar(a.site.position,player)-planar(b.site.position,player))[0]
      :undefined;
  }
  /** Cálice concluído ao alcance do `E`, pronto para o suco ser recolhido e a viagem começar. */
  collectable(player:Vec3):TotemProgress|undefined {
    if(this.phase!=='extract'||this.collected)return undefined;
    return this.totems.filter(t=>t.state==='complete'&&this.atHand(t,player))[0];
  }
  /**
   * `E` no cálice concluído: recolhe o suco uma única vez. Quem chama inicia daí a conclusão do
   * estágio; um segundo `E` no mesmo cálice não devolve nada.
   */
  collect(player:Vec3):TotemProgress|undefined {
    const totem=this.collectable(player);
    if(!totem)return undefined;
    this.collected=true;
    this.say('SUCO RECOLHIDO · embarque para o próximo bioma',6);
    return totem;
  }
  /** `E` inicia a horda final uma única vez, junto ao cálice. */
  activate(player:Vec3):TotemProgress|undefined {
    if(this.phase!=='totems')return undefined;
    const candidate=this.totems.filter(t=>t.state!=='complete'&&planar(t.site.position,player)<=TOTEM_ACTIVATION_RANGE&&Math.abs(player.y-t.site.position.y)<=4).sort((a,b)=>planar(a.site.position,player)-planar(b.site.position,player))[0];
    if(!candidate)return undefined;
    const previous=this.current;
    if(previous&&previous!==candidate&&previous.state!=='complete')previous.state='paused';
    this.activeIndex=this.totems.indexOf(candidate);
    this.discovered=true;this.phase='boss';
    candidate.state='charging';
    this.say('HORDA FINAL · a Praga Alfa despertou! Encha o cálice e derrote o chefe.',5);
    return candidate;
  }
  update(dt:number,player:Vec3,alive:boolean):void {
    this.messageTime=Math.max(0,this.messageTime-dt);
    if(!this.discovered&&this.totems.some(t=>planar(t.site.position,player)<=CHALICE_DISCOVERY_RADIUS&&Math.abs(player.y-t.site.position.y)<16)){
      this.discovered=true;this.say('CÁLICE ENCONTRADO · prepare-se antes de ativar',5);
    }
    if(this.phase==='extract')return;
    const totem=this.current;
    if(totem&&totem.state!=='complete'){
      if(alive&&this.inside(totem,player)){
        totem.state='charging';
      } else totem.state='paused';
    }
  }
  /** Called once for each actual combat death; sequence survives pooled actor ID reuse. */
  harvest(kill:{sequence:number;kind:string;position:Vec3},player:Vec3,alive:boolean):{index:number;amount:number;complete:boolean}|undefined {
    if(!Number.isSafeInteger(kill.sequence)||kill.sequence<=this.lastHarvestSequence)return;
    this.lastHarvestSequence=kill.sequence;
    const totem=this.current,yieldUnits=FRUIT_JUICE[kill.kind];
    if(!alive||this.phase!=='boss'||!totem||totem.state==='complete'||!yieldUnits||!this.inside(totem,player))return;
    if(planar(kill.position,totem.site.position)>CHALICE_CAPTURE_RADIUS||Math.abs(kill.position.y-totem.site.position.y)>12)return;
    const amount=Math.min(totem.site.juiceTarget-totem.charged,yieldUnits*Math.max(0,this.chargeMultiplier));
    if(amount<=0)return;
    totem.charged+=amount;totem.state='charging';
    const complete=totem.charged>=totem.site.juiceTarget;
    if(complete){
      totem.state='complete';
      this.say('CÁLICE CHEIO · derrote a Praga Alfa',6);
      this.finishIfReady(kill.position);
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
  onBossKilled(position?:Vec3):void {
    if(this.bossDefeated||this.phase!=='boss')return;
    this.bossDefeated=true;
    this.say('PRAGA ALFA DERROTADA · termine de encher o cálice',6);
    this.finishIfReady(position??this.totems[0]?.site.position);
  }
  private finishIfReady(position:Vec3|undefined):void {
    if(this.phase!=='boss'||!this.bossDefeated||!this.total||this.completed<this.total||!position)return;
    // O cálice continua sendo o destino: nada de mandar o jogador atravessar o celeiro.
    this.phase='extract';this.activeIndex=-1;this.rewardsPending++;this.collected=false;
    this.rewardPositions.push({...position});
    this.say('COLHEITA CONCLUÍDA · recolha a recompensa e volte ao cálice para embarcar',8);
  }
  takeReward():boolean {if(this.rewardsPending<=0)return false;this.rewardsPending--;this.rewardPositions.shift();return true;}
  private say(message:string,seconds:number):void {this.message=message;this.messageTime=seconds;}
  reset():void {
    for(const totem of this.totems){totem.charged=0;totem.state='available';}
    this.activeIndex=-1;this.phase='totems';this.discovered=false;this.bossSpawned=false;this.bossDefeated=false;this.collected=false;
    this.bossUnreachable=0;this.bossRecoveries=0;this.rewardsPending=0;this.message='';this.messageTime=0;this.chargeMultiplier=1;
    this.lastHarvestSequence=-1;this.rewardPositions.length=0;
  }
}

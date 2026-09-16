import type {Vec3} from '../core/contracts';
import type {RandomStream} from '../core/RunRNG';
import type {SurfaceFrame} from '../physics/SurfaceFrame';

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

export interface TotemAnchor {id:string;name:string;x:number;y:number;z:number;width?:number;depth?:number}
export interface TotemSite {id:string;name:string;index:number;position:Vec3;radius:number;juiceTarget:number}
export type TotemState='available'|'charging'|'paused'|'complete';
export interface TotemProgress {site:TotemSite;charged:number;state:TotemState}
/**
 * `extract` substitui a antiga fase `rift`: o cálice cheio com o chefe morto NÃO abre mais uma fenda
 * fixa no celeiro. O jogador volta ao próprio cálice, recolhe o suco com `E` e embarca na nave.
 */
export type ExpeditionPhase='totems'|'boss'|'extract';

/**
 * Consultas mínimas de mundo; mantém a simulação testável sem Babylon.
 *
 * É o `SurfaceFrame` da física, estreitado ao que a expedição realmente usa. Continua sendo uma
 * interface estrutural: um dublê de teste satisfaz isto com cinco funções e nenhum Babylon.
 */
export type ExpeditionTerrain=Pick<SurfaceFrame,
  'up'|'support'|'insideSolid'|'sweep'|'walk'|'basis'|'planarDistance'|'heightGap'>;

/**
 * Métrica do mapa: distância CAMINHANDO e desnível.
 *
 * Existe porque toda esta simulação compara "está perto do cálice?" e "está na mesma laje?", e as
 * duas perguntas mudam de fórmula num mundo curvo — mas nenhuma REGRA muda. Separando a métrica do
 * resto, o raio de captura, o alcance do `E`, o raio de descoberta e os limites de altura seguem
 * sendo exatamente os mesmos números de sempre.
 *
 * O padrão é o mundo plano, bit a bit: `hypot(dx,dz)` e `a.y − b.y`.
 */
export interface ExpeditionMetric {
  planar(a:Vec3,b:Vec3):number;
  /** Desnível de `a` em relação a `b`, ao longo da vertical local de `b`. */
  heightGap(a:Vec3,b:Vec3):number;
}

export const FLAT_METRIC:ExpeditionMetric={
  planar:(a,b)=>Math.hypot(a.x-b.x,a.z-b.z),
  heightGap:(a,b)=>a.y-b.y,
};

/** Métrica tirada de um referencial de superfície — é o que o planeta usa. */
export const metricOf=(surface:ExpeditionTerrain):ExpeditionMetric=>({
  planar:(a,b)=>surface.planarDistance(a,b),
  heightGap:(a,b)=>surface.heightGap(a,b),
});


/**
 * Piso contínuo e largo o bastante para combater: descarta pontes estreitas, interiores sólidos
 * e beiradas onde o jogador cairia ao recuar. Amostra dois anéis para não aprovar um corredor.
 */
export function isOpenGround(world:ExpeditionTerrain,centre:Vec3,radius:number,samples=12):boolean {
  const up=world.up(centre),basis=world.basis(centre,{x:0,y:0,z:1});
  const along=(sin:number,cos:number,r:number):Vec3=>({
    x:(basis.right.x*sin+basis.forward.x*cos)*r,
    y:(basis.right.y*sin+basis.forward.y*cos)*r,
    z:(basis.right.z*sin+basis.forward.z*cos)*r,
  });
  // Reject roofs and enclosed buildings; broad floor samples alone can jump over thin walls.
  if(world.sweep(lift(centre,up,1),{x:up.x*8,y:up.y*8,z:up.z*8},.4))return false;
  for(let i=0;i<samples;i++){
    const angle=i/samples*Math.PI*2,sin=Math.sin(angle),cos=Math.cos(angle);
    if(world.sweep(lift(centre,up,2.5),along(sin,cos,radius),.6))return false;
    for(const r of [radius*.45,radius]){
      const probe=world.walk(centre,along(sin,cos,r));
      const support=world.support(probe,2.4,Infinity);
      if(!support||Math.abs(world.heightGap(support.point,centre))>3.5)return false;
      if(world.insideSolid(support.point,1.8))return false;
    }
  }
  return true;
}

const lift=(p:Vec3,up:Vec3,metres:number):Vec3=>
  ({x:p.x+up.x*metres,y:p.y+up.y*metres,z:p.z+up.z*metres});

/** Procura um centro válido em anéis crescentes ao redor da âncora do distrito. */
export function findTotemSite(world:ExpeditionTerrain,anchor:TotemAnchor,radius:number,reachable:(p:Vec3)=>boolean):Vec3|undefined {
  const centre:Vec3={x:anchor.x,y:anchor.y,z:anchor.z};
  const basis=world.basis(centre,{x:0,y:0,z:1});
  for(const ring of [0,7,14,21]){
    for(let i=0;i<(ring?12:1);i++){
      const angle=i*Math.PI/6,side=Math.sin(angle)*ring,ahead=Math.cos(angle)*ring;
      // Os limites da autoria valem nas componentes LOCAIS da ilha. No mundo plano `right`/`forward`
      // são `+X`/`+Z`, então isto continua sendo exatamente o recorte em `x`/`z` de antes.
      if(anchor.width!==undefined&&Math.abs(side)>anchor.width/2-2.5)continue;
      if(anchor.depth!==undefined&&Math.abs(ahead)>anchor.depth/2-2.5)continue;
      const probe=world.walk(centre,{
        x:basis.right.x*side+basis.forward.x*ahead,
        y:basis.right.y*side+basis.forward.y*ahead,
        z:basis.right.z*side+basis.forward.z*ahead,
      });
      const support=world.support(probe,3.5,Infinity);
      if(!support)continue;
      const drop=world.heightGap(support.point,centre);
      if(Math.abs(drop)>9)continue;
      if(anchor.width!==undefined&&drop<-1.5)continue;
      if(world.insideSolid(support.point,1.8))continue;
      if(!isOpenGround(world,support.point,radius))continue;
      if(!reachable(support.point))continue;
      return support.point;
    }
  }
  return undefined;
}

/** Candidatos alcançáveis e separados para escolher a arena final do estágio. */
export function planExpedition(world:ExpeditionTerrain,anchors:readonly TotemAnchor[],origin:Vec3,reachable:(p:Vec3)=>boolean,count=4,radius=TOTEM_RADIUS,metric:ExpeditionMetric=FLAT_METRIC):TotemSite[] {
  const distance=(a:{x:number;y:number;z:number})=>metric.planar({x:a.x,y:a.y,z:a.z},origin);
  const sorted=[...anchors].sort((a,b)=>distance(a)-distance(b));
  const sites:TotemSite[]=[];
  for(const anchor of sorted){
    if(sites.length>=count)break;
    const position=findTotemSite(world,anchor,radius,reachable);
    if(!position)continue;
    if(sites.some(site=>metric.planar(site.position,position)<radius*2.2))continue;
    sites.push({id:anchor.id,name:anchor.name,index:sites.length,position,radius,juiceTarget:CHALICE_JUICE_TARGETS[sites.length]??CHALICE_JUICE_TARGETS[CHALICE_JUICE_TARGETS.length-1]!});
  }
  return sites;
}

/** One reachable destination per stage, beyond the arrival field whenever the map allows it. */
export function chooseChalice(sites:readonly TotemSite[],origin:Vec3,rng:RandomStream,metric:ExpeditionMetric=FLAT_METRIC):TotemSite|undefined {
 const away=sites.filter(s=>metric.planar(s.position,origin)>=60);
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
  /**
   * Métrica do mapa. Padrão plano; a cena troca por `metricOf(surface)` no planeta.
   * Nenhum raio, alcance ou limite de altura muda junto — só a fórmula da distância.
   */
  metric:ExpeditionMetric=FLAT_METRIC;
  private near(a:Vec3,b:Vec3):number {return this.metric.planar(a,b);}
  private drop(a:Vec3,b:Vec3):number {return Math.abs(this.metric.heightGap(a,b));}

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
    return this.near(totem.site.position,player)<=totem.site.radius&&this.drop(player,totem.site.position)<=8;
  }
  /** Marco mais próximo ainda pendente; é ele que o HUD aponta. */
  nearestPending(player:Vec3):{totem:TotemProgress;distance:number}|undefined {
    const pending=this.totems.filter(t=>t.state!=='complete');
    if(!pending.length)return undefined;
    const active=this.current;
    const totem=active&&active.state!=='complete'?active:pending.reduce((a,b)=>this.near(a.site.position,player)<=this.near(b.site.position,player)?a:b);
    return {totem,distance:this.near(totem.site.position,player)};
  }
  /** Junto ao poste: o mesmo alcance vale para ativar e, depois, para recolher o suco. */
  private atHand(totem:TotemProgress,player:Vec3):boolean {
    return this.near(totem.site.position,player)<=TOTEM_ACTIVATION_RANGE&&this.drop(player,totem.site.position)<=4;
  }
  /** Marco ao alcance do `E`, para o HUD anunciar a ação antes de o jogador apertar. */
  interactable(player:Vec3):TotemProgress|undefined {
    if(this.phase==='extract')return this.collectable(player);
    return this.phase==='totems'
      ?this.totems.filter(t=>t.state!=='complete'&&t.state!=='charging'&&this.atHand(t,player)).sort((a,b)=>this.near(a.site.position,player)-this.near(b.site.position,player))[0]
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
    const candidate=this.totems.filter(t=>t.state!=='complete'&&this.near(t.site.position,player)<=TOTEM_ACTIVATION_RANGE&&this.drop(player,t.site.position)<=4).sort((a,b)=>this.near(a.site.position,player)-this.near(b.site.position,player))[0];
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
    if(!this.discovered&&this.totems.some(t=>this.near(t.site.position,player)<=CHALICE_DISCOVERY_RADIUS&&this.drop(player,t.site.position)<16)){
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
    if(this.near(kill.position,totem.site.position)>CHALICE_CAPTURE_RADIUS||this.drop(kill.position,totem.site.position)>12)return;
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

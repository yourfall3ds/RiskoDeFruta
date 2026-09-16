import {init,Crowd,NavMeshQuery,importNavMesh,type CrowdAgent,type NavMesh} from '@recast-navigation/core';
import {generateTiledNavMesh} from '@recast-navigation/generators';
import {NavigationTileResidency} from './NavigationTileResidency';
import {IslandChartSet,type IslandChart,type IslandChartSetSource} from './IslandChart';
import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
let initialization:Promise<void>|undefined;
export function navigationGeometry(world:CollisionWorld):{positions:number[];indices:number[]} {
  const positions:number[]=[],indices:number[]=[];
  // Smooth authored floors keep bridges and stairs connected even with sub-centimetre visual gaps.
  for(const s of world.surfaces){const base=positions.length/3,steps=s.ellipse?64:4;positions.push(s.x,s.height,s.z);
    for(let i=0;i<steps;i++){const a=i/steps*Math.PI*2,x=s.ellipse?Math.cos(a)*s.width/2:[-1,1,1,-1][i]!*s.width/2,z=s.ellipse?Math.sin(a)*s.depth/2:[-1,-1,1,1][i]!*s.depth/2;positions.push(s.x+x,s.height+x*(s.slopeX??0)+z*(s.slopeZ??0),s.z+z);}
    for(let i=0;i<steps;i++)indices.push(base,base+1+(i+1)%steps,base+1+i);
  }
  for(const link of world.walkableLinks??[]){const dx=link.b.x-link.a.x,dz=link.b.z-link.a.z,length=Math.hypot(dx,dz);if(length<.01)continue;const rx=-dz/length*link.width/2,rz=dx/length*link.width/2,base=positions.length/3;
    for(const [p,side] of [[link.a,-1],[link.a,1],[link.b,1],[link.b,-1]] as const)positions.push(p.x+rx*side,p.y,p.z+rz*side);
    indices.push(base,base+1,base+2,base,base+2,base+3);
  }
  for(const patch of world.navigationPatches??[]){const offset=positions.length/3;for(const value of patch.positions)positions.push(value);for(const index of patch.indices)indices.push(index+offset);}
  for(const box of world.boxes){const b=positions.length/3;
    // Reward crates are obstacles for the crowd, never stair steps. Physics keeps the authored height.
    const crate=/^(interactive|city|frontier|highland|rootwood)-chest-/.test(box.id??''),top=crate?Math.max(box.max.y,box.min.y+1.8):box.max.y;for(const [x,y,z] of [[0,0,0],[1,0,0],[1,0,1],[0,0,1],[0,1,0],[1,1,0],[1,1,1],[0,1,1]])positions.push(x?box.max.x:box.min.x,y?top:box.min.y,z?box.max.z:box.min.z);
    for(const i of [4,7,6,4,6,5,0,1,2,0,2,3,0,4,5,0,5,1,1,5,6,1,6,2,2,6,7,2,7,3,3,7,4,3,4,0])indices.push(b+i);
  }
  return{positions,indices};
}

/**
 * Parâmetros do Recast usados pela fazenda. As cartas de ilha usam EXATAMENTE os mesmos números —
 * é o que garante que largura de corredor, degrau e raio de agente produzam a mesma tática nos dois
 * mundos, em vez de duas afinações que divergem com o tempo.
 */
const RECAST_TUNING={
  tileSize:128,cs:.2,ch:.1,walkableSlopeAngle:49,walkableHeight:18,
  // The suspended west bridge drops 0.52 m at its island landing.
  walkableClimb:6,walkableRadius:3,minRegionArea:8,mergeRegionArea:20,
  maxSimplificationError:1.1,detailSampleDist:6,detailSampleMaxError:1,
} as const;

function alignedBounds(positions:ArrayLike<number>):{low:[number,number,number];high:[number,number,number]} {
  const low:[number,number,number]=[Infinity,Infinity,Infinity],high:[number,number,number]=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i++){
    const axis=i%3;low[axis]=Math.min(low[axis]!,positions[i]!);high[axis]=Math.max(high[axis]!,positions[i]!);
  }
  // Keep the raster grid aligned as new districts extend the world bounds.
  for(let axis=0;axis<3;axis++){
    const cell=axis===1?.1:25.6;
    low[axis]=Math.floor((low[axis]!-2)/cell)*cell;high[axis]=Math.ceil((high[axis]!+2)/cell)*cell;
  }
  return{low,high};
}

/** Uma carta viva: malha, consulta e multidão próprias. A fazenda é uma só, com carta identidade. */
interface NavRegion {
  readonly id:string;
  /** `undefined` = carta identidade (mundo plano): nenhuma conversão acontece. */
  readonly chart:IslandChart|undefined;
  readonly mesh:NavMesh;
  readonly query:NavMeshQuery;
  readonly crowd:Crowd;
  playerAgent:CrowdAgent|undefined;
  residency:NavigationTileResidency|undefined;
  residencyClock:number;
  residencyPosition:Vec3|undefined;
  agents:number;
}

interface AgentEntry {agent:CrowdAgent;region:NavRegion;radius:number;speed:number}

/** Onde `scripts/bake-island-navmeshes.mjs` escreve as 38 cartas. */
export const ISLAND_NAVMESH_URL=(id:string):string=>`/models/island-navmesh/${id}.bin`;
/**
 * Carregador padrão do assado. Ausência do arquivo NÃO é erro: devolve `undefined` e a carta é
 * assada em runtime na primeira vez que a ilha for usada.
 */
export const fetchIslandNavmesh=async(id:string):Promise<Uint8Array|undefined>=>{
  try{
    const response=await fetch(ISLAND_NAVMESH_URL(id));
    if(!response.ok)return undefined;
    return new Uint8Array(await response.arrayBuffer());
  }catch{return undefined;}
};

export interface IslandNavigationSource extends IslandChartSetSource {
  /** Malha de colisão do planeta em espaço de MUNDO, como vem do manifesto. */
  readonly positions:ArrayLike<number>;
  readonly indices:ArrayLike<number>;
  /**
   * Navmesh assada offline por `scripts/bake-island-navmeshes.mjs`, que escreve em
   * `public/models/island-navmesh/<id>.bin`. **Use `fetchIslandNavmesh` — ele já sabe a URL.**
   */
  readonly baked?:(id:string)=>Promise<Uint8Array|undefined>;
  /** Ponto de partida: a carta desta região é preparada antes de `createIslands` resolver. */
  readonly origin?:Vec3;
  /**
   * Permitir assar carta em tempo de execução.
   *
   * Assar é CPU **SÍNCRONA** de ~780 ms por carta (medido: recorte de 1,75 M triângulos + Recast
   * sobre o manifesto real). `await` não devolve a thread no meio de um Recast, então 38 cartas são
   * ~30 s de aba congelada — e era exatamente esse o travamento relatado.
   *
   * Default: **`false` quando `baked` foi passado**. Um `.bin` que não chega vira carta AUSENTE,
   * listada em `missingCharts`, e a horda joga em perseguição local — nunca meia dúzia de segundos
   * de thread principal parada. `true` só quando não há `baked` nenhum (modo de desenvolvimento),
   * e ainda assim uma carta por vez e sob demanda.
   */
  readonly allowRuntimeBake?:boolean;
}

/** Recast polygon mesh, Detour crowd avoidance, and stable attack slots around the player. */
export class TacticalNavigation {
  private readonly regions:NavRegion[]=[];
  private readonly regionsById=new Map<string,NavRegion>();
  private primary:NavRegion|undefined;
  private charts:IslandChartSet|undefined;
  private geometry:{positions:ArrayLike<number>;indices:ArrayLike<number>}|undefined;
  private baked:((id:string)=>Promise<Uint8Array|undefined>)|undefined;
  /** Assar em runtime é permitido? Falso por padrão quando existe assado offline. */
  private allowRuntimeBake=true;
  /** Um Recast de cada vez em toda a instância: dois no mesmo quadro seriam 1,5 s de travamento. */
  private baking=false;
  private bakedAtRuntime=0;
  /** Cartas que já falharam: não são tentadas de novo, para não virar 60 requisições por segundo. */
  private readonly failed=new Set<string>();
  /** Cartas em preparo, para não assar a mesma ilha duas vezes ao mesmo tempo. */
  private readonly preparing=new Map<string,Promise<NavRegion|undefined>>();
  private disposed=false;
  private agents=new Map<number,AgentEntry>();
  private playerRegionId:string|undefined;
  private readonly slots=new Map<number,{rank:number;ranged:boolean}>();private readonly goals=new Map<number,Vec3>();
  private readonly takenRanks:boolean[]=[];
  private constructor(){}

  /** Multidão e consulta da carta corrente. No mundo plano é a única que existe. */
  get crowd():Crowd {return (this.playerRegion()??this.primary!).crowd;}
  get query():NavMeshQuery {return (this.playerRegion()??this.primary!).query;}
  /** `true` quando a navegação trabalha com cartas rígidas por ilha. */
  get charted():boolean {return this.charts!==undefined;}
  /** Cartas já assadas e prontas para receber agentes. */
  get readyCharts():readonly string[] {return this.regions.map(r=>r.id);}

  private playerRegion():NavRegion|undefined {
    return this.playerRegionId?this.regionsById.get(this.playerRegionId):this.primary;
  }

  private static register(navigation:TacticalNavigation,id:string,chart:IslandChart|undefined,mesh:NavMesh):NavRegion {
    const region:NavRegion={
      id,chart,mesh,
      query:new NavMeshQuery(mesh,{maxNodes:8192}),
      crowd:new Crowd(mesh,{maxAgents:162,maxAgentRadius:3}),
      playerAgent:undefined,residency:undefined,residencyClock:0,residencyPosition:undefined,agents:0,
    };
    region.query.defaultQueryHalfExtents={x:2,y:3,z:2};
    navigation.regions.push(region);navigation.regionsById.set(id,region);
    navigation.primary??=region;
    return region;
  }

  static async create(world:CollisionWorld,baked=false):Promise<TacticalNavigation>{
    initialization??=init();await initialization;
    const navigation=new TacticalNavigation();
    if(baked){
      const response=await fetch('/models/farm-navmesh.bin');
      if(!response.ok)throw Error('Falha ao carregar navmesh');
      const region=TacticalNavigation.register(navigation,'farm',undefined,importNavMesh(new Uint8Array(await response.arrayBuffer())).navMesh);
      region.residency=new NavigationTileResidency(region.mesh);return navigation;
    }
    const data=navigationGeometry(world);
    const {low,high}=alignedBounds(data.positions);
    const result=generateTiledNavMesh(data.positions,data.indices,{...RECAST_TUNING,bounds:[low,high]});
    if(!result.success)throw Error('Falha no navmesh: '+result.error);
    TacticalNavigation.register(navigation,'farm',undefined,result.navMesh);
    return navigation;
  }

  /**
   * Planeta: uma carta rígida por ilha, cada uma com a sua própria multidão Detour.
   *
   * Os SLOTS de ataque continuam globais (o `Map` de slots é da instância, não da região), então
   * dois perseguidores em ilhas diferentes nunca recebem o mesmo setor. A evasão do `Crowd`, que só
   * existe dentro de uma malha, fica por ilha — que é onde ela importa.
   */
  static async createIslands(source:IslandNavigationSource):Promise<TacticalNavigation>{
    initialization??=init();await initialization;
    const navigation=new TacticalNavigation();
    navigation.charts=new IslandChartSet(source);
    navigation.geometry={positions:source.positions,indices:source.indices};
    navigation.baked=source.baked;
    // Com assado, assar em runtime é PROIBIDO por padrão. Medido no manifesto real: 780 ms por
    // carta, 38 cartas ≈ 30 s de thread principal parada. Um `.bin` que não chega tem de virar
    // carta ausente e degradação anunciada, nunca uma aba congelada.
    navigation.allowRuntimeBake=source.allowRuntimeBake??!source.baked;
    const over=navigation.charts.overSloped;
    if(over.length)throw Error('Carta de ilha acima do limite do Recast: '+over.map(c=>`${c.id} ${c.edgeSlopeDegrees.toFixed(1)}°`).join(', '));
    if(source.baked){
      // Só CARREGAR: `importNavMesh` de 38 arquivos custou 24 ms com os assados reais.
      await Promise.all(navigation.charts.charts.map(chart=>navigation.ensureRegion(chart.id)));
      if(!navigation.regions.length)
        throw Error(`Nenhuma das ${navigation.charts.charts.length} cartas de ilha pôde ser carregada. `
          +'Confira a URL do assado — `fetchIslandNavmesh` lê /models/island-navmesh/<id>.bin, '
          +'que é onde `scripts/bake-island-navmeshes.mjs` escreve.');
      return navigation;
    }
    // Sem assado: prepara só a ilha de partida; as outras entram sob demanda, uma de cada vez.
    const first=source.origin?navigation.charts.chartFor(source.origin):navigation.charts.charts[0];
    if(!first)throw Error('O manifesto não traz nenhuma ilha');
    if(!await navigation.ensureRegion(first.id))throw Error('Falha ao preparar a carta da ilha '+first.id);
    return navigation;
  }

  /** Cartas que o manifesto pede mas que não estão prontas — para o HUD dizer o porquê. */
  get missingCharts():readonly string[] {
    return this.charts?this.charts.charts.filter(c=>!this.regionsById.has(c.id)).map(c=>c.id):[];
  }
  /** Quantas cartas foram assadas em tempo de execução nesta sessão. Deve ser 0 em produção. */
  get runtimeBakes():number {return this.bakedAtRuntime;}

  /**
   * Garante que a carta de uma ilha existe. Carrega o assado quando há; senão assa a partir do
   * recorte de triângulos da ilha, que é onde mora o custo — por isso uma de cada vez.
   */
  async ensureRegion(id:string):Promise<NavRegion|undefined> {
    const existing=this.regionsById.get(id);
    if(existing)return existing;
    const pending=this.preparing.get(id);
    if(pending)return pending;
    // Uma carta que já falhou não é tentada de novo nesta sessão.
    //
    // `regionFor` chama isto por QUADRO enquanto um agente estiver perto de uma ilha sem carta. Sem
    // esta lista, um `.bin` em 404 vira sessenta requisições por segundo para sempre — e uma
    // promessa nova por quadro junto. O estado "faltando" é estável: ou o arquivo existe, ou não.
    if(this.failed.has(id))return undefined;
    const chart=this.charts?.get(id);
    if(!chart||!this.geometry)return undefined;
    const work=(async()=>{
      let deferred=false;
      try{
        let mesh:NavMesh|undefined;
        if(this.baked){
          const bytes=await this.baked(id);
          if(bytes)mesh=importNavMesh(bytes).navMesh;
        }
        if(!mesh){
          // É AQUI que a aba congelava. Sem permissão explícita o assado que faltou vira carta
          // ausente (a horda cai na perseguição local, que continua matando e morrendo) em vez de
          // ~780 ms de CPU síncrona por ilha, multiplicados por quantas ilhas o jogador encostar.
          if(!this.allowRuntimeBake||!this.geometry!.indices.length)return undefined;
          // Uma de cada vez em toda a instância: duas cartas assando no mesmo quadro seriam 1,5 s.
          // Isto é ADIAMENTO, não falha — a carta continua elegível na próxima tentativa.
          if(this.baking){deferred=true;return undefined;}
          this.baking=true;
          try{
            const slice=this.charts!.slice(chart,this.geometry!.positions,this.geometry!.indices);
            if(!slice.triangles)return undefined;
            const {low,high}=alignedBounds(slice.positions);
            const result=generateTiledNavMesh(slice.positions,slice.indices,{...RECAST_TUNING,bounds:[low,high]});
            if(!result.success)return undefined;
            mesh=result.navMesh;this.bakedAtRuntime++;
          }finally{this.baking=false;}
        }
        if(this.disposed){mesh.destroy();return undefined;}
        return TacticalNavigation.register(this,id,chart,mesh);
      }catch{return undefined;}
      finally{
        this.preparing.delete(id);
        if(!deferred&&!this.regionsById.has(id))this.failed.add(id);
      }
    })();
    this.preparing.set(id,work);
    return work;
  }

  /**
   * Prepara as cartas ao alcance pedido em torno de um ponto.
   *
   * `budget` limita quantas podem ser ASSADAS (não carregadas) nesta chamada. Carregar assado custa
   * menos de um milissegundo por carta; assar custa ~780 ms de CPU síncrona, e trinta e oito delas
   * em sequência são os ~30 s que congelavam a aba. As mais próximas vêm primeiro, que é a ordem em
   * que o jogador vai precisar delas.
   */
  async prepareNear(p:Vec3,arc=140,budget=2):Promise<void> {
    if(!this.charts)return;
    const near=this.charts.charts.filter(c=>c.arcTo(p)<=arc).sort((a,b)=>a.arcTo(p)-b.arcTo(p));
    for(const chart of near){
      const before=this.bakedAtRuntime;
      await this.ensureRegion(chart.id);
      if(this.bakedAtRuntime>before&&--budget<=0)return;
    }
  }

  private toChart(region:NavRegion,p:Vec3):Vec3 {return region.chart?region.chart.toChart(p):p;}
  private toWorld(region:NavRegion,p:Vec3):Vec3 {return region.chart?region.chart.toWorld(p):p;}

  /** Região de um ponto de mundo, com histerese; `undefined` quando a carta ainda não está pronta. */
  private regionFor(p:Vec3,previous?:string):NavRegion|undefined {
    if(!this.charts)return this.primary;
    const chart=this.charts.chartFor(p,previous);
    if(!chart)return undefined;
    const region=this.regionsById.get(chart.id);
    if(region)return region;
    void this.ensureRegion(chart.id);
    return previous?this.regionsById.get(previous):undefined;
  }

  private closestIn(region:NavRegion,p:Vec3):Vec3|undefined {
    const r=region.query.findClosestPoint(this.toChart(region,p));
    return r.success?this.toWorld(region,r.point):undefined;
  }

  closest(p:Vec3):Vec3|undefined{
    const region=this.regionFor(p,this.playerRegionId);
    return region?this.closestIn(region,p):undefined;
  }

  /**
   * Existe rota até o alvo?
   *
   * Numa carta só, é exatamente o teste de antes. Entre cartas diferentes o A* não pode atravessar
   * duas malhas, então a pergunta é decomposta: o perseguidor alcança a entrada da PRIMEIRA ponte
   * do caminho de ilhas, e o grafo de pontes liga as duas ilhas. É a mesma pergunta que o jogo faz
   * ("dá para chegar?"), respondida no único espaço onde o Detour existe.
   */
  reachable(p:Vec3,target:Vec3):boolean {
    const region=this.regionFor(p);
    if(!region)return false;
    const destination=this.regionFor(target,this.playerRegionId);
    if(!destination)return false;
    if(region===destination)return this.reachableWithin(region,p,target);
    const hop=this.charts?.firstHop(region.id,destination.id);
    if(!hop)return false;
    return this.reachableWithin(region,p,hop.entry);
  }

  private reachableWithin(region:NavRegion,p:Vec3,target:Vec3):boolean {
    const nearest=this.closestIn(region,p);
    if(!nearest||Math.hypot(p.x-nearest.x,p.z-nearest.z,region.chart?p.y-nearest.y:0)>1.4)return false;
    const path=region.query.computePath(this.toChart(region,nearest),this.toChart(region,target),{maxPathPolys:2048,maxStraightPathPoints:2048});
    if(!(path.success&&path.path.length>0))return false;
    const end=this.toWorld(region,path.path.at(-1)!);
    return Math.hypot(end.x-target.x,end.z-target.z,region.chart?end.y-target.y:0)<3;
  }

  add(id:number,p:Vec3,radius:number,speed:number):boolean {
    this.remove(id);
    const region=this.regionFor(p,this.playerRegionId);
    if(!region)return false;
    const nearest=this.closestIn(region,p);if(!nearest)return false;
    const agent=region.crowd.addAgent(this.toChart(region,nearest),{radius,height:1.8,maxSpeed:speed,maxAcceleration:16,collisionQueryRange:radius*10,pathOptimizationRange:12,separationWeight:3.5,updateFlags:31,obstacleAvoidanceType:0});
    if(agent.state()===0){region.crowd.removeAgent(agent);return false;}
    this.agents.set(id,{agent,region,radius,speed});region.agents++;return true;
  }
  remove(id:number):void {
    const entry=this.agents.get(id);
    if(entry){entry.region.crowd.removeAgent(entry.agent);entry.region.agents--;}
    this.agents.delete(id);this.slots.delete(id);this.goals.delete(id);
  }
  /**
   * Menor sector livre da classe, sem montar lista/`Set` novos a cada chamada. `target` roda uma vez
   * por ator por tique, então as três listas intermediárias de antes eram O(agentes) de lixo por ator.
   * Só interessam ranks abaixo do total de ocupantes — acima disso o primeiro buraco já apareceu.
   */
  private freeRank(id:number,ranged:boolean):number {
    const taken=this.takenRanks,limit=this.slots.size+1;
    if(taken.length<limit)taken.length=limit;
    taken.fill(false,0,limit);
    this.slots.forEach((slot,other)=>{if(other!==id&&slot.ranged===ranged&&slot.rank>=0&&slot.rank<limit)taken[slot.rank]=true;});
    let free=0;while(free<limit&&taken[free])free++;
    return free;
  }
  /** Each attacker owns a sector. Further ranks wait outside the inner attack circle. */
  target(id:number,player:Vec3,rank:number,ranged:boolean,speed:number):void {const entry=this.agents.get(id);if(!entry)return;const a=entry.agent;const free=this.freeRank(id,ranged);const previous=this.slots.get(id);rank=previous?Math.min(previous.rank,free):free;this.slots.set(id,{rank,ranged});const slots=ranged?10:7,ring=Math.floor(rank/slots),angle=(rank%slots)/slots*Math.PI*2+(ranged?.31:0),radius=ranged?9+ring*2.1:2.0+ring*1.6;
    // Perseguidor noutra ilha persegue a entrada da ponte, que a carta dele cobre — o setor de
    // ataque em volta do jogador só passa a existir quando ele chega à mesma carta.
    const bridge=this.crossing(entry,player);
    const wanted=bridge??this.slotAround(entry.region,player,angle,radius);
    const near=this.closestIn(entry.region,wanted);a.updateFlags=31;a.maxAcceleration=16;a.maxSpeed=speed;const goal=this.goals.get(id);if(goal&&Math.hypot(goal.x-wanted.x,goal.y-wanted.y,goal.z-wanted.z)<.6)return;this.goals.set(id,wanted);if(near)a.requestMoveTarget(this.toChart(entry.region,near));else a.requestMoveTarget(this.toChart(entry.region,this.closestIn(entry.region,player)??player));
  }
  /**
   * Setor de ataque em volta do jogador. No plano é o mesmo `x+sin·r, z+cos·r` de sempre; na
   * esfera o anel é desenhado na base tangente do jogador, senão o setor vazaria para dentro
   * do globo quando a ilha não estiver no polo norte.
   */
  private slotAround(region:NavRegion,player:Vec3,angle:number,radius:number):Vec3 {
    if(!region.chart)return{x:player.x+Math.sin(angle)*radius,y:player.y,z:player.z+Math.cos(angle)*radius};
    const local=region.chart.toChart(player);
    return region.chart.toWorld({x:local.x+Math.sin(angle)*radius,y:local.y,z:local.z+Math.cos(angle)*radius});
  }
  /**
   * Para onde caminha quem está noutra ilha: o DESEMBARQUE do outro lado da primeira ponte do
   * caminho, não a cabeceira desta.
   *
   * A cabeceira pararia a horda na beira do vão — ela é o alvo alcançado, e o agente ficaria lá
   * esperando uma troca de carta que nunca vem. Cada carta cobre a ponte INTEIRA (medido: pior caso
   * 38° de inclinação de borda contra o limite de 49°), então o desembarque é um ponto válido da
   * malha desta carta. O agente atravessa, cruza a faixa de sobreposição e só então migra.
   */
  private crossing(entry:AgentEntry,player:Vec3):Vec3|undefined {
    if(!this.charts||!entry.region.chart)return undefined;
    const destination=this.charts.chartFor(player,this.playerRegionId);
    if(!destination||destination.id===entry.region.id)return undefined;
    return this.charts.firstHop(entry.region.id,destination.id)?.exit;
  }
  velocity(id:number,velocity:Vec3,maxSpeed:number,committed=false):void {const entry=this.agents.get(id);if(entry){const a=entry.agent;this.goals.delete(id);a.updateFlags=committed?0:31;a.maxAcceleration=committed?45:16;a.maxSpeed=maxSpeed;a.requestMoveVelocity(entry.region.chart?entry.region.chart.rotateToChart(velocity):velocity);}}
  private updateResidency(region:NavRegion,dt:number,player:Vec3):void {
    if(!region.residency)return;
    region.residencyClock-=dt;
    const moved=!region.residencyPosition||Math.hypot(player.x-region.residencyPosition.x,player.z-region.residencyPosition.z)>25;
    if(region.residencyClock>0&&!moved)return;
    region.residencyClock=.5;region.residencyPosition={...player};
    const agents=[...this.agents.values()].filter(e=>e.region===region).map(e=>e.agent),points=[player,...agents.map(a=>a.position())];
    region.residency.ensureNear(points);
    const protectedTiles=new Set<number>();
    const protectPath=(from:Vec3,to:Vec3):boolean=>{
      const a=region.query.findNearestPoly(from),b=region.query.findNearestPoly(to);
      if(!a.nearestRef||!b.nearestRef)return false;
      const route=region.query.findPath(a.nearestRef,b.nearestRef,a.nearestPoint,b.nearestPoint,{maxPathPolys:2048});
      try{
        if(!route.success||!route.polys.size||route.polys.get(route.polys.size-1)!==b.nearestRef)return false;
        for(let i=0;i<route.polys.size;i++)protectedTiles.add(region.mesh.decodePolyId(route.polys.get(i)).tileIndex);
        return true;
      }finally{route.polys.destroy();}
    };
    for(const agent of agents){
      const from=agent.position();
      // Retain both the existing request and the next pursuit destination.
      for(const destination of [agent.target(),player]){
        if(protectPath(from,destination))continue;
        region.residency.restoreAll();
        if(!protectPath(from,destination))return; // Disconnected actor: retain safely until it is retired.
      }
    }
    region.residency.prune(points,protectedTiles);
  }
  /**
   * Devolve TODOS os tiles à malha antes de validar uma rota longa.
   *
   * `updateResidency` poda tudo a mais de 155 m do jogador e dos agentes. Uma rota entre duas ilhas
   * a 250 m atravessa exatamente os tiles podados, e `reachable` responderia "sem rota" por um
   * motivo de streaming, não de mapa. A poda volta a acontecer no `step` seguinte.
   */
  restoreNavigation():void {for(const region of this.regions)region.residency?.restoreAll();}
  get navigationResidency(){return this.primary?.residency?.stats;}
  get residencyDescription():string {
    if(this.charts){
      const missing=this.charts.charts.length-this.regions.length;
      return `Cartas ${this.regions.length}/${this.charts.charts.length} · ${this.agents.size} agentes`
        +(missing?` · ${missing} SEM ASSADO`:'')+(this.bakedAtRuntime?` · ${this.bakedAtRuntime} assadas em runtime`:'');
    }
    const s=this.primary?.residency?.stats;return s?`Tiles ${s.resident}/${s.total} · Detour ${(s.residentBytes/1024).toFixed(0)} KiB · cache ${(s.cachedBytes/1024).toFixed(0)} KiB`:'Tiles sem streaming';
  }
  /**
   * Um agente que atravessou a ponte muda de multidão. Rank, meta e velocidade são da INSTÂNCIA,
   * não da região, então a troca não perde o setor de ataque nem o compromisso da investida.
   */
  private migrate(id:number,entry:AgentEntry):void {
    if(!this.charts||!entry.region.chart)return;
    const world=entry.region.chart.toWorld(entry.agent.position());
    const chart=this.charts.chartFor(world,entry.region.id);
    if(!chart||chart.id===entry.region.id)return;
    const next=this.regionsById.get(chart.id);
    if(!next){void this.ensureRegion(chart.id);return;}
    const nearest=this.closestIn(next,world);
    if(!nearest)return;
    const worldVelocity=entry.region.chart.rotateToWorld(entry.agent.velocity());
    entry.region.crowd.removeAgent(entry.agent);entry.region.agents--;
    const agent=next.crowd.addAgent(next.chart!.toChart(nearest),{radius:entry.radius,height:1.8,maxSpeed:entry.speed,maxAcceleration:16,collisionQueryRange:entry.radius*10,pathOptimizationRange:12,separationWeight:3.5,updateFlags:31,obstacleAvoidanceType:0});
    if(agent.state()===0){next.crowd.removeAgent(agent);this.agents.delete(id);this.slots.delete(id);this.goals.delete(id);return;}
    agent.requestMoveVelocity(next.chart!.rotateToChart(worldVelocity));
    entry.agent=agent;entry.region=next;next.agents++;this.goals.delete(id);
  }
  step(dt:number,player:Vec3):void {
    const region=this.regionFor(player,this.playerRegionId);
    if(region)this.playerRegionId=region.id;
    for(const [id,entry] of this.agents)this.migrate(id,entry);
    for(const current of this.regions){
      if(current!==region&&current.agents===0){
        // Multidão sem ninguém não precisa de passo: no planeta são 38 cartas e só uma ou duas vivem.
        if(current.playerAgent){current.crowd.removeAgent(current.playerAgent);current.playerAgent=undefined;}
        continue;
      }
      this.updateResidency(current,dt,player);
      const p=current===region?this.closestIn(current,player):undefined;
      if(p){const local=this.toChart(current,p);if(!current.playerAgent)current.playerAgent=current.crowd.addAgent(local,{radius:.32,height:1.8,maxSpeed:0,separationWeight:0});else current.playerAgent.teleport(local);}
      else if(current.playerAgent){current.crowd.removeAgent(current.playerAgent);current.playerAgent=undefined;}
      current.crowd.update(dt);
    }
  }
  position(id:number):Vec3|undefined{const entry=this.agents.get(id);return entry?this.toWorld(entry.region,entry.agent.position()):undefined;}
  motion(id:number):Vec3|undefined{const entry=this.agents.get(id);if(!entry)return undefined;const v=entry.agent.velocity();return entry.region.chart?entry.region.chart.rotateToWorld(v):v;}
  get count():number{return this.agents.size;}
  clear():void{for(const id of [...this.agents.keys()])this.remove(id);}
  dispose():void{
    this.disposed=true;this.clear();
    for(const region of this.regions){region.crowd.destroy();region.query.destroy();region.residency?.dispose();region.mesh.destroy();}
    this.regions.length=0;this.regionsById.clear();this.primary=undefined;
  }
}

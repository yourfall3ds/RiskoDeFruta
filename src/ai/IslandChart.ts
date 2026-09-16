import type {Vec3} from '../core/contracts';
import {transport} from '../planet/PlanetFrame';

/**
 * Carta RÍGIDA por ilha.
 *
 * O Recast voxeliza sempre em `+Y` absoluto: num globo inteiro só a calota norte sobreviveria ao
 * `walkableSlopeAngle`. A saída não é projetar (que deforma) e sim GIRAR: uma rotação rígida `R`
 * que leva a vertical da ilha em `+Y`, com origem no centro do convés.
 *
 *   carta  = R · (mundo − centro)          mundo = Rᵀ · carta + centro
 *
 * Rígida ⇒ **exata**: distância, ângulo e área são preservados, não é aproximação nenhuma. O que
 * a carta introduz é só o fato de o convés curvo virar uma bacia — a arco `s` a inclinação vista
 * pelo Recast é `s / R_planeta`, e é isso que precisa caber no limite de 49°.
 *
 * Medido no manifesto real (R = 180 m, 38 ilhas, 48 pontes): a carta mais exigente é a da `front`,
 * que precisa alcançar 107,5 m para cobrir as pontes inteiras — 34,2°. Com a margem usada aqui o
 * pior caso do arquipélago é 38°, contra o limite de 49°. Cada carta cobre a ilha, as pontes
 * INTEIRAS e o desembarque vizinho, então a troca de carta acontece numa faixa larga de
 * sobreposição em vez de num ponto.
 */

export interface IslandRegionRecord {
  readonly id:string;
  /** Centro do convés em espaço de mundo. */
  readonly centre:Vec3;
  /** Direção unitária do centro do planeta até o convés. */
  readonly up:Vec3;
  /** Raio da pegada caminhável, em metros. */
  readonly radius:number;
}

export interface BridgeRecord {readonly a:string;readonly b:string;readonly waypoints:readonly Vec3[]}

/** Folga em metros de arco somada ao alcance necessário de cada carta. */
export const CHART_MARGIN = 12;
/** Histerese da troca de carta, em metros de arco. */
export const CHART_HYSTERESIS = 8;
/** Limite do Recast usado pelo jogo. A carta é recusada se a borda passar disto. */
export const CHART_SLOPE_LIMIT_DEGREES = 49;

const dot=(a:Vec3,b:Vec3)=>a.x*b.x+a.y*b.y+a.z*b.z;
const norm=(v:Vec3):Vec3=>{const l=Math.hypot(v.x,v.y,v.z)||1;return{x:v.x/l,y:v.y/l,z:v.z/l};};

export class IslandChart {
  readonly id:string;
  readonly centre:Vec3;
  readonly up:Vec3;
  readonly radius:number;
  /** Alcance da carta em metros de ARCO, já com margem. */
  readonly reach:number;
  /** Corda equivalente a `reach` — o teste barato usado no recorte de triângulos. */
  readonly reachChord:number;
  /** Inclinação que o Recast vê na borda da carta, em graus. */
  readonly edgeSlopeDegrees:number;
  private readonly planetRadius:number;
  private readonly planetCentre:Vec3;
  /** Colunas de `R`: imagens de `e_x`, `e_y`, `e_z`. `Rᵀ` sai de graça como produto escalar. */
  private readonly cx:Vec3;private readonly cy:Vec3;private readonly cz:Vec3;

  constructor(record:IslandRegionRecord,reachArc:number,planetCentre:Vec3,planetRadius:number){
    this.id=record.id;
    this.centre={...record.centre};
    this.up=norm(record.up);
    this.radius=record.radius;
    this.planetCentre={...planetCentre};
    this.planetRadius=planetRadius;
    this.reach=reachArc;
    this.reachChord=2*planetRadius*Math.sin(Math.min(Math.PI,reachArc/planetRadius)/2);
    this.edgeSlopeDegrees=reachArc/planetRadius*180/Math.PI;
    const y={x:0,y:1,z:0};
    this.cx=transport({x:1,y:0,z:0},this.up,y);
    this.cy=transport({x:0,y:1,z:0},this.up,y);
    this.cz=transport({x:0,y:0,z:1},this.up,y);
  }

  /** `R · v` — só rotação, sem translação (velocidades e direções). */
  rotateToChart(v:Vec3):Vec3 {
    return{
      x:this.cx.x*v.x+this.cy.x*v.y+this.cz.x*v.z,
      y:this.cx.y*v.x+this.cy.y*v.y+this.cz.y*v.z,
      z:this.cx.z*v.x+this.cy.z*v.y+this.cz.z*v.z,
    };
  }
  /** `Rᵀ · v` — inversa EXATA da anterior, por transposição. */
  rotateToWorld(v:Vec3):Vec3 {
    return{x:dot(this.cx,v),y:dot(this.cy,v),z:dot(this.cz,v)};
  }
  toChart(p:Vec3):Vec3 {
    return this.rotateToChart({x:p.x-this.centre.x,y:p.y-this.centre.y,z:p.z-this.centre.z});
  }
  toWorld(p:Vec3):Vec3 {
    const v=this.rotateToWorld(p);
    return{x:v.x+this.centre.x,y:v.y+this.centre.y,z:v.z+this.centre.z};
  }
  /** Distância de arco no convés nominal entre o centro da ilha e `p`. */
  arcTo(p:Vec3):number {
    const a=norm({x:this.centre.x-this.planetCentre.x,y:this.centre.y-this.planetCentre.y,z:this.centre.z-this.planetCentre.z});
    const b=norm({x:p.x-this.planetCentre.x,y:p.y-this.planetCentre.y,z:p.z-this.planetCentre.z});
    const c={x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};
    return Math.atan2(Math.hypot(c.x,c.y,c.z),dot(a,b))*this.planetRadius;
  }
  covers(p:Vec3):boolean {return this.arcTo(p)<=this.reach;}
}

/** Recorte de triângulos de uma carta, já em coordenadas de carta e pronto para o Recast. */
export interface ChartGeometry {positions:Float32Array;indices:Uint32Array;triangles:number}

export interface IslandChartSetSource {
  readonly centre:Vec3;
  readonly radius:number;
  readonly islands:readonly IslandRegionRecord[];
  readonly bridges:readonly BridgeRecord[];
}

/**
 * O conjunto de cartas do arquipélago: alcance por ilha derivado das pontes REAIS, escolha de
 * carta com histerese e o grafo de ilhas usado quando perseguidor e alvo estão em cartas
 * diferentes.
 */
export class IslandChartSet {
  readonly charts:readonly IslandChart[];
  readonly planetCentre:Vec3;
  readonly planetRadius:number;
  private readonly byId=new Map<string,IslandChart>();
  /** Ilhas vizinhas e, para cada par, os pontos da ponte que as ligam. */
  private readonly links=new Map<string,{to:string;entry:Vec3;exit:Vec3}[]>();

  constructor(source:IslandChartSetSource){
    this.planetCentre={...source.centre};
    this.planetRadius=source.radius;
    const arc=(a:Vec3,b:Vec3)=>{
      const ua=norm({x:a.x-this.planetCentre.x,y:a.y-this.planetCentre.y,z:a.z-this.planetCentre.z});
      const ub=norm({x:b.x-this.planetCentre.x,y:b.y-this.planetCentre.y,z:b.z-this.planetCentre.z});
      const c={x:ua.y*ub.z-ua.z*ub.y,y:ua.z*ub.x-ua.x*ub.z,z:ua.x*ub.y-ua.y*ub.x};
      return Math.atan2(Math.hypot(c.x,c.y,c.z),dot(ua,ub))*this.planetRadius;
    };
    const charts:IslandChart[]=[];
    for(const island of source.islands){
      // Alcance NECESSÁRIO: a pegada da ilha e o ponto mais distante de qualquer ponte dela — a
      // ponte inteira, incluindo o desembarque na vizinha, e não só o meio do vão.
      let reach=island.radius;
      for(const bridge of source.bridges){
        if(bridge.a!==island.id&&bridge.b!==island.id)continue;
        for(const point of bridge.waypoints)reach=Math.max(reach,arc(island.centre,point));
      }
      charts.push(new IslandChart(island,reach+CHART_MARGIN,this.planetCentre,this.planetRadius));
    }
    this.charts=charts;
    for(const chart of charts)this.byId.set(chart.id,chart);
    for(const bridge of source.bridges){
      const first=bridge.waypoints[0]!,last=bridge.waypoints[bridge.waypoints.length-1]!;
      (this.links.get(bridge.a)??this.links.set(bridge.a,[]).get(bridge.a)!).push({to:bridge.b,entry:first,exit:last});
      (this.links.get(bridge.b)??this.links.set(bridge.b,[]).get(bridge.b)!).push({to:bridge.a,entry:last,exit:first});
    }
  }

  get(id:string):IslandChart|undefined {return this.byId.get(id);}

  /** Cartas cuja inclinação de borda passa do limite do Recast — vazio no arquipélago atual. */
  get overSloped():readonly IslandChart[] {
    return this.charts.filter(c=>c.edgeSlopeDegrees>CHART_SLOPE_LIMIT_DEGREES);
  }

  /**
   * Carta de um ponto. `previous` mantém a carta anterior enquanto a nova não for melhor por mais
   * de `CHART_HYSTERESIS` metros de arco: sem isso um agente exatamente no meio da ponte trocaria
   * de multidão a cada quadro.
   */
  chartFor(p:Vec3,previous?:string):IslandChart|undefined {
    let best:IslandChart|undefined,bestArc=Infinity;
    for(const chart of this.charts){
      const d=chart.arcTo(p);
      if(d<bestArc){bestArc=d;best=chart;}
    }
    if(!previous)return best;
    const held=this.byId.get(previous);
    if(!held||!best||held===best)return best??held;
    return held.arcTo(p)<=bestArc+CHART_HYSTERESIS&&held.covers(p)?held:best;
  }

  /** Ilhas ligadas por ponte a `id`. */
  neighbours(id:string):readonly {to:string;entry:Vec3;exit:Vec3}[] {return this.links.get(id)??[];}

  /**
   * Primeiro salto de ponte no caminho de ilhas entre `from` e `to`. Devolve o ponto de entrada da
   * ponte — um ponto de MUNDO que a carta `from` cobre com folga. É o alvo que um perseguidor de
   * outra ilha persegue enquanto o jogador não estiver na carta dele.
   */
  firstHop(from:string,to:string):{to:string;entry:Vec3;exit:Vec3}|undefined {
    if(from===to)return undefined;
    const previous=new Map<string,{island:string;link:{to:string;entry:Vec3;exit:Vec3}}>();
    const queue=[from];const seen=new Set([from]);
    for(let head=0;head<queue.length;head++){
      const current=queue[head]!;
      if(current===to)break;
      for(const link of this.neighbours(current)){
        if(seen.has(link.to))continue;
        seen.add(link.to);previous.set(link.to,{island:current,link});queue.push(link.to);
      }
    }
    if(!seen.has(to))return undefined;
    let cursor=to,step=previous.get(cursor);
    while(step&&step.island!==from){cursor=step.island;step=previous.get(cursor);}
    return step?.link;
  }

  /** Existe caminho de pontes entre as duas ilhas. */
  connected(from:string,to:string):boolean {return from===to||Boolean(this.firstHop(from,to));}

  /**
   * Recorte da malha para uma carta, já girado para coordenadas de carta.
   *
   * O critério é o centroide do triângulo dentro da corda equivalente ao alcance — corda em vez de
   * arco porque são 1,75 milhão de triângulos por carta e `acos` custaria dez vezes mais para
   * responder a mesma coisa dentro de milímetros.
   */
  slice(chart:IslandChart,positions:ArrayLike<number>,indices:ArrayLike<number>):ChartGeometry {
    const limit=chart.reachChord*chart.reachChord,cx=chart.centre.x,cy=chart.centre.y,cz=chart.centre.z;
    const remap=new Int32Array(positions.length/3).fill(-1);
    const out:number[]=[],tri:number[]=[];
    for(let t=0;t<indices.length;t+=3){
      const i0=indices[t]!*3,i1=indices[t+1]!*3,i2=indices[t+2]!*3;
      const mx=(positions[i0]!+positions[i1]!+positions[i2]!)/3-cx;
      const my=(positions[i0+1]!+positions[i1+1]!+positions[i2+1]!)/3-cy;
      const mz=(positions[i0+2]!+positions[i1+2]!+positions[i2+2]!)/3-cz;
      if(mx*mx+my*my+mz*mz>limit)continue;
      for(const base of [i0,i1,i2]){
        const vertex=base/3;
        let mapped=remap[vertex]!;
        if(mapped<0){
          const q=chart.toChart({x:positions[base]!,y:positions[base+1]!,z:positions[base+2]!});
          mapped=out.length/3;remap[vertex]=mapped;out.push(q.x,q.y,q.z);
        }
        tri.push(mapped);
      }
    }
    return{positions:Float32Array.from(out),indices:Uint32Array.from(tri),triangles:tri.length/3};
  }
}

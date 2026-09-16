/**
 * Onde a chuva encosta no mundo.
 *
 * O problema real é custo: um respingo por gota exigiria um raycast por partícula, centenas por
 * quadro. Aqui o respingo é **amostrado**, não derivado das gotas. Um orçamento fixo de consultas
 * por segundo sorteia colunas em volta da câmera, pergunta ao mundo qual é a superfície mais alta
 * daquela coluna e põe o respingo lá. Consequências que o QA vai notar:
 *
 * - O respingo cai no TELHADO, não no piso debaixo dele, porque a consulta devolve o topo da
 *   coluna. É por isso que não se vê chuva batendo dentro de um interior coberto.
 * - Superfície inclinada não ganha coroa: água escorre, não espirra. Só piso quase horizontal.
 * - Sem `RainWorldQuery` ligada, não há respingo nenhum. **Não** inventamos um plano de chão falso.
 *
 * Tudo aqui é puro e determinístico (gerador próprio), então o teste consegue conferir posição,
 * limite de consultas e reciclagem sem precisar de Babylon.
 */

export interface RainSurfaceSample {
  height:number;
  normal:{x:number;y:number;z:number};
  slopeDegrees?:number;
}

/**
 * Consulta de mundo OPCIONAL, satisfeita estruturalmente pelo `CollisionWorld` do jogo.
 *
 * O dono da cena liga com uma linha (`weatherView.world = collision`) quando puder; até lá a chuva
 * roda inteira, só sem respingo e sem supressão sob cobertura.
 */
export interface RainWorldQuery {
  /** Superfície real mais alta da coluna — chão, laje, telhado. `undefined` quando é vazio. */
  surfaceAt(x:number,z:number,maxHeight?:number):RainSurfaceSample|undefined;
  /** Opcional: ponto dentro de volume sólido. Reforça a detecção de cobertura. */
  insideSolid?(p:{x:number;y:number;z:number},height?:number):boolean;
}

export interface SplashPlacement {
  x:number;y:number;z:number;
  /** Normal da superfície atingida; a coroa deita nela. */
  normal:{x:number;y:number;z:number};
  /** 0..1 — respingos mais longe da câmera nascem menores. */
  scale:number;
}

/** Raio em que os respingos são sorteados, em metros. */
export const SPLASH_RADIUS=14;
/** Respingos por segundo com chuva cheia. Teto duro do efeito. */
export const SPLASH_PER_SECOND=24;
/** Teto de respingos vivos ao mesmo tempo. */
export const SPLASH_CAPACITY=56;
/**
 * Orçamento de consultas ao mundo por segundo. É a defesa contra o raycast por partícula:
 * mesmo com chuva cheia e 60 quadros por segundo, o mundo é perguntado no máximo isto.
 */
export const QUERY_BUDGET_PER_SECOND=46;
/** Folga acima da cabeça para considerar que a coluna tem cobertura. */
export const SHELTER_HEAD_ROOM=1.6;
/** Acima disto o respingo cairia num telhado fora de quadro; não vale gastar o efeito. */
export const SPLASH_ABOVE_VIEWER=9;
/** Abaixo disto a gota caiu no vazio entre ilhas; sem respingo. */
export const SPLASH_BELOW_VIEWER=26;
/** Inclinação máxima que ainda forma coroa. Acima disso a água escorre. */
export const SPLASH_MAX_NORMAL_TILT=.82;
/** Intervalo entre checagens de cobertura da própria câmera. */
export const COVER_CHECK_SECONDS=.28;

/** Gerador próprio: reprodutível no teste e independente de `Math.random`. */
function stream(seed:number){
  let state=seed>>>0||1;
  return ()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};
}

export class RainSurfaceSampler {
  /** Consultas feitas ao mundo desde a criação. O teste confere o orçamento contra isto. */
  queries=0;
  /** `true` quando a própria câmera está sob cobertura: as gotas de perto somem. */
  viewerCovered=false;
  /** 0..1 — fração das colunas sorteadas recentemente que estavam cobertas. */
  shelter=0;
  /** Respingos recusados por cair no vazio, em telhado alto ou em rampa. */
  rejected=0;
  private budget=0;
  private pending=0;
  private coverClock=0;
  private readonly recent:boolean[]=[];
  private readonly random=stream(0x5ea17);

  reset():void {
    this.queries=0;this.viewerCovered=false;this.shelter=0;this.rejected=0;
    this.budget=0;this.pending=0;this.coverClock=0;this.recent.length=0;
  }

  /**
   * Avança o amostrador e devolve os respingos deste quadro (lista vazia é o caso normal).
   * `world` ausente desliga o efeito por completo — de propósito.
   */
  update(dt:number,viewer:{x:number;y:number;z:number},rain:number,world:RainWorldQuery|undefined):SplashPlacement[] {
    const step=Number.isFinite(dt)&&dt>0?Math.min(dt,.25):0;
    const intensity=Math.max(0,Math.min(1,Number.isFinite(rain)?rain:0));
    if(!world||step===0){
      if(!world){this.viewerCovered=false;this.shelter=0;}
      return [];
    }
    // Orçamento de consultas: acumula no tempo e nunca guarda mais de meio segundo de crédito.
    this.budget=Math.min(this.budget+step*QUERY_BUDGET_PER_SECOND,QUERY_BUDGET_PER_SECOND*.5);

    this.coverClock-=step;
    if(this.coverClock<=0&&this.budget>=1){
      this.coverClock=COVER_CHECK_SECONDS;
      this.budget-=1;this.queries++;
      const above=world.surfaceAt(viewer.x,viewer.z);
      const roof=above!==undefined&&above.height>viewer.y+SHELTER_HEAD_ROOM;
      this.viewerCovered=roof||(world.insideSolid?.({x:viewer.x,y:viewer.y,z:viewer.z},1.8)??false);
    }

    // A chuva só respinga onde ela chega; sob cobertura o efeito cessa junto com as gotas de perto.
    const exposure=this.viewerCovered?0:1;
    this.pending+=step*SPLASH_PER_SECOND*intensity*exposure;
    const placements:SplashPlacement[]=[];
    while(this.pending>=1&&this.budget>=1&&placements.length<SPLASH_CAPACITY){
      this.pending-=1;this.budget-=1;this.queries++;
      const placement=this.sample(viewer,world);
      if(placement)placements.push(placement);
    }
    // Sem orçamento não adianta acumular pedidos para o quadro seguinte.
    if(this.budget<1)this.pending=Math.min(this.pending,2);
    return placements;
  }

  private sample(viewer:{x:number;y:number;z:number},world:RainWorldQuery):SplashPlacement|undefined {
    // Sorteio por raiz da uniforme: mais respingos perto, onde eles realmente são lidos.
    const angle=this.random()*Math.PI*2;
    const distance=Math.sqrt(this.random())*SPLASH_RADIUS;
    const x=viewer.x+Math.sin(angle)*distance,z=viewer.z+Math.cos(angle)*distance;
    const surface=world.surfaceAt(x,z);
    const covered=surface!==undefined&&surface.height>viewer.y+SHELTER_HEAD_ROOM;
    this.remember(covered||surface===undefined);
    if(!surface){this.rejected++;return undefined;}
    if(surface.height>viewer.y+SPLASH_ABOVE_VIEWER||surface.height<viewer.y-SPLASH_BELOW_VIEWER){this.rejected++;return undefined;}
    // Rampa íngreme não faz coroa; a água escorre.
    if(!(surface.normal.y>=SPLASH_MAX_NORMAL_TILT)){this.rejected++;return undefined;}
    return {
      x,y:surface.height,z,
      normal:{x:surface.normal.x,y:surface.normal.y,z:surface.normal.z},
      scale:1-.45*(distance/SPLASH_RADIUS),
    };
  }

  private remember(covered:boolean):void {
    this.recent.push(covered);
    if(this.recent.length>48)this.recent.shift();
    this.shelter=this.recent.filter(Boolean).length/this.recent.length;
  }
}

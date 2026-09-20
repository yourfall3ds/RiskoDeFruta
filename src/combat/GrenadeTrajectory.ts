import type {Vec3} from '../core/contracts';
import {launchVelocity,stepGrenade,type GrenadeBody,type GrenadeWorld} from './PrismGrenades';
import {PRISM_GRENADE} from './PrismTuning';

/**
 * Passo da prévia. É o passo do laço fixo do jogo (`FixedLoop`, 60 Hz), de propósito: com qualquer
 * outro valor a integração semi-implícita divergiria da cápsula real e o indicador de queda
 * apontaria para um metro ao lado do buraco. Ver `tests/grenade-trajectory.test.ts`.
 */
export const TRAJECTORY_STEP=1/60;

/** Teto de pontos do desenho. O arco é decimado até caber; o último ponto NUNCA é descartado. */
export const TRAJECTORY_MAX_POINTS=48;

/**
 * Teto de passos por consulta. Cobre o estopim inteiro (`fuseSeconds` a 60 Hz) e nada além — é o
 * que impede uma prévia sobre céu aberto virar um laço sem fim.
 */
export const TRAJECTORY_MAX_STEPS=Math.ceil(PRISM_GRENADE.fuseSeconds/TRAJECTORY_STEP)+1;

/** Contato previsto: onde a cápsula bate e com que normal. */
export interface TrajectoryContact {readonly point:Vec3;readonly normal:Vec3}

export interface GrenadePrediction {
  /** Polilinha do arco, do cano ao fim. Sempre com ao menos o ponto de origem. */
  readonly points:readonly Vec3[];
  /**
   * Onde a cápsula bate. `undefined` quando o estopim estoura NO AR ou quando a integração foi
   * truncada — nos dois casos não existe ponto de queda para marcar, e inventar um seria mentir.
   */
  readonly impact:TrajectoryContact|undefined;
  /** O estopim acabou com a cápsula ainda voando: explosão aérea, sem marcador de chão. */
  readonly airburst:boolean;
  /** O teto de passos foi atingido antes de qualquer desfecho. */
  readonly truncated:boolean;
  /** Passos realmente integrados; entra no diagnóstico de custo. */
  readonly steps:number;
}

export interface TrajectoryOptions {
  readonly step?:number;
  readonly speed?:number;
  readonly maxSteps?:number;
  readonly maxPoints?:number;
}

/**
 * Para onde a cápsula vai, ANTES de ela existir.
 *
 * Roda a MESMA física da granada viva (`stepGrenade`): gravidade pela vertical local — que num
 * planeta não é `+Y` —, passo fixo, teste de segmento varrido e o mesmo estopim. Não é um marcador
 * a uma distância fixa: o arco é integrado de verdade, então ele sobe atrás de uma mureta, some
 * dentro de um vão e para no primeiro corpo que aparecer na frente.
 *
 * É uma função PURA sobre a porta `GrenadeWorld`: nenhum dano, nenhuma munição, nenhum áudio,
 * nenhum sorteio e nenhum tranco de câmera saem daqui. O corpo integrado é descartável e nunca
 * entra na lista viva de `PrismGrenades`.
 */
export function predictGrenadeFlight(
  world:GrenadeWorld,
  origin:Vec3,
  direction:Vec3,
  options:TrajectoryOptions={},
):GrenadePrediction {
  const step=options.step??TRAJECTORY_STEP;
  const maxSteps=Math.max(1,Math.floor(options.maxSteps??TRAJECTORY_MAX_STEPS));
  const maxPoints=Math.max(2,Math.floor(options.maxPoints??TRAJECTORY_MAX_POINTS));
  const body:GrenadeBody={
    position:{x:origin.x,y:origin.y,z:origin.z},
    velocity:launchVelocity(direction,options.speed??PRISM_GRENADE.speed),
    fuse:PRISM_GRENADE.fuseSeconds,
    travelled:0,
  };
  const points:Vec3[]=[{x:origin.x,y:origin.y,z:origin.z}];
  // Decimação progressiva: a cada estouro do teto o arco perde um ponto sim, um não, e o
  // espaçamento dobra. O custo continua linear no número de passos e a memória fica limitada.
  let stride=1,pending=0;
  const record=(at:Vec3):void=>{
    if(++pending<stride)return;
    pending=0;
    points.push({x:at.x,y:at.y,z:at.z});
    if(points.length<=maxPoints)return;
    const kept:Vec3[]=[points[0]!];
    for(let i=2;i<points.length;i+=2)kept.push(points[i]!);
    points.length=0;
    for(const point of kept)points.push(point);
    stride*=2;
  };
  for(let i=0;i<maxSteps;i++){
    const result=stepGrenade(world,body,step);
    if(result.state==='contact'){
      const contact=result.contact!;
      points.push({x:contact.point.x,y:contact.point.y,z:contact.point.z});
      return {points:limitPoints(points,maxPoints),impact:{point:{...contact.point},normal:{...contact.normal}},airburst:false,truncated:false,steps:i+1};
    }
    record(body.position);
    if(result.state==='expired'){
      // Estopim no ar: a explosão acontece, mas NÃO existe chão para marcar.
      closeAt(points,body.position);
      return {points:limitPoints(points,maxPoints),impact:undefined,airburst:true,truncated:false,steps:i+1};
    }
  }
  closeAt(points,body.position);
  return {points:limitPoints(points,maxPoints),impact:undefined,airburst:false,truncated:true,steps:maxSteps};
}

/** Teto de atualizações da prévia, por segundo. */
export const TRAJECTORY_REFRESH_HZ=10;

/**
 * O porteiro do custo da prévia.
 *
 * Integrar o arco custa até `TRAJECTORY_MAX_STEPS` varreduras contra mundo E horda. Fazer isso a
 * cada quadro com sessenta inimigos em cena é desperdício visível no orçamento de quadro, e o
 * desenho não fica melhor por isso. Duas travas, as duas necessárias:
 *
 * - tempo: no máximo `TRAJECTORY_REFRESH_HZ` recálculos por segundo;
 * - movimento: parado (cano e mira praticamente iguais aos da última vez) nem o relógio libera,
 *   porque o arco seria idêntico ponto a ponto.
 */
export class TrajectoryRefreshGate {
  private clock=Number.POSITIVE_INFINITY;
  private origin:Vec3|undefined;
  private direction:Vec3|undefined;
  constructor(
    private readonly hz=TRAJECTORY_REFRESH_HZ,
    /** Deslocamento do cano que já obriga recálculo, em metros. */
    private readonly moveEpsilon=0.05,
    /** Variação de mira que já obriga recálculo (co-seno; ~0,5°). */
    private readonly turnEpsilon=1-Math.cos(0.5*Math.PI/180),
  ) {}
  /** Reinicia: a próxima consulta recalcula sem esperar o relógio. */
  reset():void {this.clock=Number.POSITIVE_INFINITY;this.origin=undefined;this.direction=undefined;}
  due(dt:number,origin:Vec3,direction:Vec3):boolean {
    this.clock+=Math.max(0,dt);
    if(this.clock<1/this.hz)return false;
    const moved=!this.origin||Math.hypot(origin.x-this.origin.x,origin.y-this.origin.y,origin.z-this.origin.z)>this.moveEpsilon;
    const turned=!this.direction||dot(unit(direction),this.direction)<1-this.turnEpsilon;
    // Moving actors and destroyed cover can change the contact even with a stationary camera.
    if(!moved&&!turned&&this.clock<.35)return false;
    this.clock=0;
    this.origin={x:origin.x,y:origin.y,z:origin.z};
    this.direction=unit(direction);
    return true;
  }
}

const dot=(a:Vec3,b:Vec3):number=>a.x*b.x+a.y*b.y+a.z*b.z;
const unit=(v:Vec3):Vec3=>{
  const length=Math.hypot(v.x,v.y,v.z)||1;
  return {x:v.x/length,y:v.y/length,z:v.z/length};
};

/** Garante que a ponta desenhada é a posição final, mesmo depois da decimação. */
function closeAt(points:Vec3[],at:Vec3):void {
  const last=points[points.length-1];
  if(last&&Math.abs(last.x-at.x)<1e-9&&Math.abs(last.y-at.y)<1e-9&&Math.abs(last.z-at.z)<1e-9)return;
  points.push({x:at.x,y:at.y,z:at.z});
}

/** Preserve the final contact while keeping the fixed GPU buffer within capacity. */
function limitPoints(points:Vec3[],limit:number):Vec3[]{if(points.length>limit)points.splice(limit-1,points.length-limit);return points;}

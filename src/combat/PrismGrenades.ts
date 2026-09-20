import type {Vec3} from '../core/contracts';
import {PRISM_GRENADE} from './PrismTuning';

/** Contato de uma cápsula com o mundo ou com um corpo. */
export interface GrenadeContact {
  readonly point: Vec3;
  readonly normal: Vec3;
  /** Id do ator atingido em cheio; ausente quando o contato foi cenário. */
  readonly targetId?: number | undefined;
  /** Triângulo de colisão do mundo, quando o backend radial o conhece (destruição). */
  readonly triangle?: number | undefined;
}

/**
 * O mundo visto pela balística. Duas perguntas, nada mais — é o que deixa o teste rodar sem cena.
 */
export interface GrenadeWorld {
  /** Vertical local no ponto. No mapa plano é `+Y` em qualquer lugar; no planeta é a radial. */
  up(point: Vec3): Vec3;
  /**
   * Primeiro contato do SEGMENTO `from → to`, considerando uma cápsula de raio `radius`.
   * `undefined` quando o trecho está livre. É o teste que impede a granada atravessar parede.
   */
  segment(from: Vec3, to: Vec3, radius: number): GrenadeContact | undefined;
}

/**
 * O ESTADO de voo de uma cápsula, sem identidade.
 *
 * Existe separado de `Grenade` porque a PRÉVIA da mira (ver `GrenadeTrajectory`) integra um corpo
 * descartável com exatamente a mesma física — e um corpo de prévia não tem id, não entra na lista
 * viva e nunca detona. Compartilhar o estado é o que garante que o indicador de queda e a granada
 * de verdade não possam divergir.
 */
export interface GrenadeBody {
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Segundos restantes de estopim. */
  fuse: number;
  /** Distância já percorrida, em metros — usada só pela apresentação. */
  travelled: number;
}

/**
 * Carga de UMA cápsula, quando ela não é a comum.
 *
 * Existe para as habilidades do soldado (leque e salva incendiária) poderem mudar a explosão SEM
 * uma segunda física de granada: a balística é a mesma, o que muda é o que a detonação significa.
 * Ausente = cápsula comum, com os números de `PRISM_GRENADE`.
 */
export interface GrenadePayload {
  /** A explosão acende o chão onde bate. Ver `src/combat/GroundFire.ts`. */
  readonly groundFire?: boolean;
  /** Multiplicador do raio da explosão. Quem lança é responsável por já aplicar o teto. */
  readonly radiusScale: number;
  /** Multiplicador do dano de contato direto e do estilhaço. */
  readonly damageScale: number;
  /** `true` acende o alvo com a queimadura limitada que o jogo já tem. */
  readonly incendiary: boolean;
  /** Id do ataque; entra no dano e no diagnóstico. */
  readonly attackId: string;
}

export interface Grenade extends GrenadeBody {
  readonly id: number;
  /** `undefined` na cápsula comum do disparo normal. */
  readonly payload?: GrenadePayload | undefined;
}

/** Resultado de UM passo de voo. `up` é a vertical local usada naquele passo. */
export interface GrenadeStep {
  readonly state: 'flying' | 'contact' | 'expired';
  readonly up: Vec3;
  /** Só em `contact`. */
  readonly contact?: GrenadeContact | undefined;
}

/**
 * UM passo de integração da cápsula — a única cópia desta física no projeto.
 *
 * Semi-implícito: primeiro a queda pela vertical LOCAL, depois o deslocamento, e o teste de
 * SEGMENTO no trecho inteiro (é ele que impede a cápsula atravessar parede a 34 m/s). Muta `body`
 * no lugar, como o laço original fazia, para não alocar por passo numa horda.
 *
 * `PrismGrenades.update` e a prévia da mira chamam ESTA função. Com o mesmo `dt`, o mesmo mundo e
 * a mesma velocidade inicial, os dois percorrem exatamente os mesmos pontos — é o que o teste de
 * paridade trava.
 */
export function stepGrenade(world: GrenadeWorld, body: GrenadeBody, dt: number): GrenadeStep {
  const up=world.up(body.position);
  const drop=PRISM_GRENADE.gravity*dt;
  body.velocity.x-=up.x*drop;body.velocity.y-=up.y*drop;body.velocity.z-=up.z*drop;
  const to={x:body.position.x+body.velocity.x*dt,y:body.position.y+body.velocity.y*dt,z:body.position.z+body.velocity.z*dt};
  const contact=world.segment(body.position,to,PRISM_GRENADE.probeRadius);
  if(contact)return {state:'contact',up,contact};
  body.travelled+=Math.hypot(to.x-body.position.x,to.y-body.position.y,to.z-body.position.z);
  body.position.x=to.x;body.position.y=to.y;body.position.z=to.z;
  body.fuse-=dt;
  if(body.fuse<=0)return {state:'expired',up};
  return {state:'flying',up};
}

/**
 * Velocidade inicial de um lançamento, na mira. Pura e compartilhada com a prévia: uma cápsula
 * prevista tem de nascer com EXATAMENTE a mesma velocidade da que sai do cano.
 */
export function launchVelocity(direction: Vec3, speed: number = PRISM_GRENADE.speed): Vec3 {
  const length=Math.hypot(direction.x,direction.y,direction.z)||1;
  return {x:direction.x/length*speed,y:direction.y/length*speed,z:direction.z/length*speed};
}

/**
 * Cápsulas em voo do lança-granadas.
 *
 * Voo BALÍSTICO de verdade: velocidade inicial na mira, queda pela vertical LOCAL (que num planeta
 * não é `+Y`) e um teste de segmento por passo. O segmento é o ponto inteiro do módulo — com ele a
 * cápsula NUNCA atravessa cenário, mesmo a 34 m/s num quadro de 60 Hz, porque o contato é procurado
 * no trecho todo e não só na posição de chegada.
 *
 * A detonação é delegada: este módulo decide ONDE e QUANDO, e quem pediu decide o que isso
 * significa em dano, destruição e efeito. Assim a física fica testável sem Babylon e sem inimigos.
 *
 * O teto `PRISM_GRENADE.maxLive` existe como barreira de vazamento: quando ele estoura, a cápsula
 * mais antiga DETONA (não some), então munição gasta sempre vira explosão.
 */
export class PrismGrenades {
  private readonly bullets: Grenade[] = [];
  private nextId = 1;
  constructor(
    private readonly world: GrenadeWorld,
    /** Chamado no ponto final do voo, com a cápsula já removida. `contact` ausente = estopim no ar. */
    private readonly onDetonate: (grenade: Grenade, at: Vec3, normal: Vec3, contact: GrenadeContact | undefined) => void,
  ) {}
  get live(): readonly Grenade[] {return this.bullets;}
  get count(): number {return this.bullets.length;}
  launch(origin: Vec3, direction: Vec3, speed = PRISM_GRENADE.speed, payload?: GrenadePayload): Grenade {
    const grenade: Grenade = {
      id:this.nextId++,
      position:{x:origin.x,y:origin.y,z:origin.z},
      velocity:launchVelocity(direction,speed),
      fuse:PRISM_GRENADE.fuseSeconds,
      travelled:0,
      payload,
    };
    this.bullets.push(grenade);
    // Teto estourado: a MAIS ANTIGA explode no lugar em que está, em vez de sumir calada.
    while(this.bullets.length>PRISM_GRENADE.maxLive){
      const oldest=this.bullets.shift()!;
      this.onDetonate(oldest,oldest.position,this.world.up(oldest.position),undefined);
    }
    return grenade;
  }
  update(dt: number): void {
    if(dt<=0||this.bullets.length===0)return;
    for(let i=this.bullets.length-1;i>=0;i--){
      const grenade=this.bullets[i]!;
      const step=stepGrenade(this.world,grenade,dt);
      if(step.state==='contact'){
        this.bullets.splice(i,1);
        this.onDetonate(grenade,step.contact!.point,step.contact!.normal,step.contact);
        continue;
      }
      if(step.state==='expired'){
        this.bullets.splice(i,1);
        this.onDetonate(grenade,grenade.position,step.up,undefined);
      }
    }
  }
  /** Some com o que está em voo SEM detonar. Morte, reinício e descarte — nunca jogo normal. */
  clear(): void {this.bullets.length=0;}
}

/**
 * Fração do dano da explosão a uma distância do centro.
 *
 * Linear do centro (`1`) até a borda (`PRISM_GRENADE.edgeFactor`), e `0` fora do raio. Função pura
 * e exportada porque é ela que o teste de área trava: fora do raio não existe dano nenhum.
 */
export function blastFalloff(distance: number, radius: number = PRISM_GRENADE.blastRadius): number {
  if(!(distance>=0)||distance>=radius)return 0;
  const t=distance/radius;
  return 1+(PRISM_GRENADE.edgeFactor-1)*t;
}

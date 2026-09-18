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

export interface Grenade {
  readonly id: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Segundos restantes de estopim. */
  fuse: number;
  /** Distância já percorrida, em metros — usada só pela apresentação. */
  travelled: number;
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
  launch(origin: Vec3, direction: Vec3, speed = PRISM_GRENADE.speed): Grenade {
    const length=Math.hypot(direction.x,direction.y,direction.z)||1;
    const grenade: Grenade = {
      id:this.nextId++,
      position:{x:origin.x,y:origin.y,z:origin.z},
      velocity:{x:direction.x/length*speed,y:direction.y/length*speed,z:direction.z/length*speed},
      fuse:PRISM_GRENADE.fuseSeconds,
      travelled:0,
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
      const up=this.world.up(grenade.position);
      const drop=PRISM_GRENADE.gravity*dt;
      grenade.velocity.x-=up.x*drop;grenade.velocity.y-=up.y*drop;grenade.velocity.z-=up.z*drop;
      const to={x:grenade.position.x+grenade.velocity.x*dt,y:grenade.position.y+grenade.velocity.y*dt,z:grenade.position.z+grenade.velocity.z*dt};
      const contact=this.world.segment(grenade.position,to,PRISM_GRENADE.probeRadius);
      if(contact){
        this.bullets.splice(i,1);
        this.onDetonate(grenade,contact.point,contact.normal,contact);
        continue;
      }
      grenade.travelled+=Math.hypot(to.x-grenade.position.x,to.y-grenade.position.y,to.z-grenade.position.z);
      grenade.position.x=to.x;grenade.position.y=to.y;grenade.position.z=to.z;
      grenade.fuse-=dt;
      if(grenade.fuse<=0){
        this.bullets.splice(i,1);
        this.onDetonate(grenade,grenade.position,up,undefined);
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
export function blastFalloff(distance: number, radius = PRISM_GRENADE.blastRadius): number {
  if(!(distance>=0)||distance>=radius)return 0;
  const t=distance/radius;
  return 1+(PRISM_GRENADE.edgeFactor-1)*t;
}

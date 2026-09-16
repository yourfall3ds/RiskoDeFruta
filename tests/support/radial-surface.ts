import {PlanetFrame,normalize} from '../../src/planet/PlanetFrame';
import {PlanetCollision} from '../../src/planet/PlanetCollision';
import {SphereSurface} from '../../src/physics/SphereSurface';
import type {Vec3} from '../../src/core/contracts';
import type {EnemySurface} from '../../src/enemies/EnemySpace';

/**
 * A superfície radial DE PRODUÇÃO (`src/physics/SphereSurface.ts`, dona: a física), servida aos
 * testes da horda.
 *
 * Não existe dublê aqui de propósito: o valor do teste é justamente provar que o `EnemySwarm`
 * ORIGINAL roda contra a implementação real que o jogo vai usar, e não contra uma imitação
 * conveniente. O `EnemySurface` do porto é satisfeito por tipagem estrutural, sem import cruzado.
 */
export const radialSurface=(frame:PlanetFrame,collision:PlanetCollision):EnemySurface=>
  new SphereSurface(frame,collision);

/**
 * Casca esférica triangulada de raio `radius`. Serve de "convés" contínuo para os testes: com 256
 * meridianos a aresta mede ~4,4 m e a flecha da faceta ~1,3 cm, muito abaixo de qualquer tolerância
 * de apoio usada pela horda.
 */
export function sphereShell(radius:number,segments=256,rings=128):{positions:number[];indices:number[]} {
  const positions:number[]=[],indices:number[]=[];
  for(let ring=0;ring<=rings;ring++){
    const phi=ring/rings*Math.PI,sin=Math.sin(phi),cos=Math.cos(phi);
    for(let seg=0;seg<=segments;seg++){
      const theta=seg/segments*Math.PI*2;
      positions.push(radius*sin*Math.sin(theta),radius*cos,radius*sin*Math.cos(theta));
    }
  }
  const stride=segments+1;
  for(let ring=0;ring<rings;ring++)for(let seg=0;seg<segments;seg++){
    const a=ring*stride+seg,b=a+stride;
    indices.push(a,b,a+1,a+1,b,b+1);
  }
  return{positions,indices};
}

/** As seis direções de teste: dois polos e os quatro pontos do equador alinhados aos eixos. */
export const SIX_POLES:readonly {name:string;direction:Vec3}[]=[
  {name:'+Y (polo norte)',direction:{x:0,y:1,z:0}},
  {name:'-Y (polo sul)',direction:{x:0,y:-1,z:0}},
  {name:'+X',direction:{x:1,y:0,z:0}},
  {name:'-X',direction:{x:-1,y:0,z:0}},
  {name:'+Z',direction:{x:0,y:0,z:1}},
  {name:'-Z',direction:{x:0,y:0,z:-1}},
];

/** Ponto do convés na direção dada, `altitude` metros acima do raio nominal. */
export const onDeck=(frame:PlanetFrame,direction:Vec3,altitude=0):Vec3=>frame.fromDirection(normalize(direction),altitude);

import type {Vec3} from '../core/contracts';
import type {ExpeditionTerrain} from '../run/ExpeditionObjectives';

/**
 * Ponto de pouso seguro numa ilha.
 *
 * O corpo cai de ~900 m e precisa parar em piso de TOPO: nada de nascer dentro de um celeiro, sob
 * uma laje ou numa beirada de onde o primeiro passo cai no vazio. As checagens são as mesmas que o
 * resto do projeto já usa (`groundAt`, `insideSolid`, `sweepSphere`), só combinadas para a chegada.
 *
 * Módulo puro: recebe a consulta de terreno por interface, então roda igual no jogo e no teste.
 */

/** Altura livre exigida acima do piso, em metros. A cápsula do jogador tem 1,8 m. */
export const SPAWN_HEADROOM=2.6;
/**
 * Onde a varredura de espaço livre começa, acima do piso.
 *
 * Partir da própria cota do piso faria a esfera tocar a laje em que o corpo está DE PÉ — um telhado
 * plano recusaria a si mesmo. O mesmo deslocamento de um metro já é usado por `isOpenGround`.
 */
const HEADROOM_START=1;
/** Raio de piso contínuo exigido ao redor do pouso. */
export const SPAWN_FOOTING_RADIUS=2.5;
/** Desnível tolerado no anel de apoio. Acima disso o ponto é uma beirada, não um pátio. */
export const SPAWN_FOOTING_STEP=1.5;
/** Anéis de busca ao redor da âncora da ilha, em metros. */
const SPAWN_RINGS=[0,6,12,18] as const;

/**
 * `true` quando o ponto sustenta um corpo de pé: piso de topo, sem teto colado, sem interior sólido
 * e com um anel de piso contínuo em volta.
 */
export function isSafeSpawnGround(world:ExpeditionTerrain,x:number,z:number,y:number):boolean {
  if(!Number.isFinite(y))return false;
  if(world.insideSolid({x,y,z},1.8))return false;
  // Teto logo acima: o pouso ficaria preso entre o piso e a laje.
  if(world.sweepSphere({x,y:y+HEADROOM_START,z},{x:0,y:SPAWN_HEADROOM-HEADROOM_START,z:0},.4,true))return false;
  for(let i=0;i<8;i++){
    const angle=i*Math.PI/4,px=x+Math.sin(angle)*SPAWN_FOOTING_RADIUS,pz=z+Math.cos(angle)*SPAWN_FOOTING_RADIUS;
    const py=world.groundAt(px,pz,y+SPAWN_FOOTING_STEP);
    if(!Number.isFinite(py)||Math.abs(py-y)>SPAWN_FOOTING_STEP)return false;
    if(world.insideSolid({x:px,y:py,z:pz},1.8))return false;
  }
  return true;
}

/**
 * Procura o pouso na ilha, do centro para fora. Sem ponto válido devolve `undefined` — quem chama
 * tenta OUTRA ilha; nunca existe um recuo para perto do cálice.
 */
export function findSpawnPoint(world:ExpeditionTerrain,anchor:{x:number;y:number;z:number}):Vec3|undefined {
  for(const ring of SPAWN_RINGS){
    for(let i=0;i<(ring?12:1);i++){
      const angle=i*Math.PI/6,x=anchor.x+Math.sin(angle)*ring,z=anchor.z+Math.cos(angle)*ring;
      // Sem teto de altura: queremos o piso MAIS ALTO da coluna, que é onde a queda termina.
      const y=world.groundAt(x,z);
      if(!Number.isFinite(y)||Math.abs(y-anchor.y)>14)continue;
      if(!isSafeSpawnGround(world,x,z,y))continue;
      return {x,y,z};
    }
  }
  return undefined;
}

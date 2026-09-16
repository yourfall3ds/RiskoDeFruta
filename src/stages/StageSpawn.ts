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

/** Âncora da ilha; `width`/`depth` limitam a busca ao corpo dela quando a autoria os informa. */
type SpawnAnchor={x:number;y:number;z:number;width?:number;depth?:number};

/**
 * `true` quando o ponto sustenta um corpo de pé: piso de topo, sem teto colado, sem interior sólido
 * e com um anel de piso contínuo em volta.
 */
export function isSafeSpawnGround(world:ExpeditionTerrain,ground:Vec3):boolean {
  if(!Number.isFinite(ground.x)||!Number.isFinite(ground.y)||!Number.isFinite(ground.z))return false;
  if(world.insideSolid(ground,1.8))return false;
  const up=world.up(ground),basis=world.basis(ground,{x:0,y:0,z:1});
  // Teto logo acima: o pouso ficaria preso entre o piso e a laje.
  const clearance=SPAWN_HEADROOM-HEADROOM_START;
  if(world.sweep(
    {x:ground.x+up.x*HEADROOM_START,y:ground.y+up.y*HEADROOM_START,z:ground.z+up.z*HEADROOM_START},
    {x:up.x*clearance,y:up.y*clearance,z:up.z*clearance},.4))return false;
  for(let i=0;i<8;i++){
    const angle=i*Math.PI/4,sin=Math.sin(angle),cos=Math.cos(angle),r=SPAWN_FOOTING_RADIUS;
    const probe=world.walk(ground,{
      x:(basis.right.x*sin+basis.forward.x*cos)*r,
      y:(basis.right.y*sin+basis.forward.y*cos)*r,
      z:(basis.right.z*sin+basis.forward.z*cos)*r,
    });
    const support=world.support(probe,SPAWN_FOOTING_STEP,Infinity);
    if(!support||Math.abs(world.heightGap(support.point,ground))>SPAWN_FOOTING_STEP)return false;
    if(world.insideSolid(support.point,1.8))return false;
  }
  return true;
}

/**
 * Procura o pouso na ilha, do centro para fora. Sem ponto válido devolve `undefined` — quem chama
 * tenta OUTRA ilha; nunca existe um recuo para perto do cálice.
 *
 * A varredura é determinística de propósito. Sortear o ângulo aqui parecia dar variedade de graça,
 * mas muda os PONTOS testados, não só a ordem: um ponto sorteado pode cair fora da malha de
 * navegação assada, e aí a ilha inteira perde a rota até o cálice e o plano do estágio falha. A
 * variedade entre tentativas vem do par de ILHAS, que `planStage` embaralha pela semente. Variar o
 * canto do pouso dentro da ilha exige uma busca que saiba consultar a navegação — ainda não existe.
 */
export function findSpawnPoint(world:ExpeditionTerrain,anchor:SpawnAnchor):Vec3|undefined {
  return scanRings(world,anchor,SPAWN_RINGS,0);
}

/** Uma varredura completa: cada anel, doze direções a partir de `offset`. */
function scanRings(world:ExpeditionTerrain,anchor:SpawnAnchor,rings:readonly number[],offset:number):Vec3|undefined {
  const centre:Vec3={x:anchor.x,y:anchor.y,z:anchor.z};
  const basis=world.basis(centre,{x:0,y:0,z:1});
  for(const ring of rings){
    for(let i=0;i<(ring?12:1);i++){
      const angle=offset+i*Math.PI/6,side=Math.sin(angle)*ring,ahead=Math.cos(angle)*ring;
      // Do not label a neighboring island or the lower arrival field as this island's spawn.
      // As componentes são LOCAIS da ilha; no mundo plano `right`/`forward` são `+X`/`+Z`.
      if(anchor.width!==undefined&&Math.abs(side)>anchor.width/2-SPAWN_FOOTING_RADIUS)continue;
      if(anchor.depth!==undefined&&Math.abs(ahead)>anchor.depth/2-SPAWN_FOOTING_RADIUS)continue;
      const probe=world.walk(centre,{
        x:basis.right.x*side+basis.forward.x*ahead,
        y:basis.right.y*side+basis.forward.y*ahead,
        z:basis.right.z*side+basis.forward.z*ahead,
      });
      // Sem teto de altura: queremos o piso MAIS ALTO da coluna, que é onde a queda termina.
      const support=world.support(probe,Infinity,Infinity);
      if(!support)continue;
      const drop=world.heightGap(support.point,centre);
      if(Math.abs(drop)>14)continue;
      if(anchor.width!==undefined&&drop<-SPAWN_FOOTING_STEP)continue;
      if(!isSafeSpawnGround(world,support.point))continue;
      return support.point;
    }
  }
  return undefined;
}

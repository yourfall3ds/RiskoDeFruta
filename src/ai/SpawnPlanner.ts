import type {RandomStream} from '../core/RunRNG';
import type {Vec3} from '../core/contracts';
export interface SpawnTerrain {
 groundAt(x:number,z:number,maxHeight:number):number;
 insideSolid?(p:Vec3,height?:number):boolean;
}
/** Anel pedido em 15/09: perto o bastante para o combate continuar durante o deslocamento. */
export const SPAWN_RING_MIN=15;
export const SPAWN_RING_MAX=35;
/** Meia-largura mínima de piso contínuo sob o ponto; barra pontes estreitas e beiradas. */
export const SPAWN_FOOTING=2.4;

/**
 * Piso real, contínuo e fora de interior sólido. Sem isto o diretor podia entregar
 * um ponto no vazio, dentro de uma construção fechada ou na laje de uma ponte de dois metros.
 */
export function validSpawnGround(terrain:SpawnTerrain,x:number,z:number,y:number,footing=SPAWN_FOOTING):boolean {
 if(!Number.isFinite(y))return false;
 if(terrain.insideSolid?.({x,y,z},1.8))return false;
 for(const [dx,dz] of [[footing,0],[-footing,0],[0,footing],[0,-footing]]){
  const py=terrain.groundAt(x+dx!,z+dz!,y+1.2);
  if(!Number.isFinite(py)||Math.abs(py-y)>1.2)return false;
 }
 return true;
}

/** Bounded work per director attempt, relative to the current arena instead of a hard-coded map rectangle. */
export function chooseSpawnAround(player:Vec3,rng:RandomStream,terrain:SpawnTerrain,reachable:(p:Vec3)=>boolean,occupied:(p:Vec3)=>boolean,minRadius=SPAWN_RING_MIN,maxRadius=SPAWN_RING_MAX):Vec3|undefined {
 for(let attempt=0;attempt<24;attempt++){
  const angle=rng.range(0,Math.PI*2),radius=rng.range(minRadius,maxRadius);
  const p={x:player.x+Math.sin(angle)*radius,y:0,z:player.z+Math.cos(angle)*radius};
  p.y=terrain.groundAt(p.x,p.z,player.y+6);
  // Nunca no corpo do jogador, nem numa laje que não sustenta um inimigo.
  if(Math.hypot(p.x-player.x,p.z-player.z)<minRadius)continue;
  if(!validSpawnGround(terrain,p.x,p.z,p.y))continue;
  if(!reachable(p)||occupied(p))continue;
  return p;
 }
 return;
}

import type {RandomStream} from '../core/RunRNG';
import type {Vec3} from '../core/contracts';
import type {EnemySurface} from '../enemies/EnemySpace';
export interface SpawnTerrain {
 groundAt(x:number,z:number,maxHeight:number):number;
 insideSolid?(p:Vec3,height?:number):boolean;
}
/** Anel pedido em 15/09: perto o bastante para o combate continuar durante o deslocamento. */
export const SPAWN_RING_MIN=15;
export const SPAWN_RING_MAX=35;
/** Meia-largura mínima de piso contínuo sob o ponto; barra pontes estreitas e beiradas. */
export const SPAWN_FOOTING=2.4;
/** Quanto o sondador radial procura acima e abaixo do anel antes de declarar vazio. */
const RADIAL_ABOVE=6,RADIAL_BELOW=12;

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

/**
 * Versão radial do mesmo teste: o piso contínuo é medido nas QUATRO direções tangentes do ponto,
 * em vez de ±X/±Z, e a diferença de cota é a vertical local. É o mesmo critério — "cabe um corpo
 * inteiro aqui e o chão não termina a dois metros" — expresso num referencial que não supõe `+Y`.
 */
export function validRadialSpawnGround(surface:EnemySurface,p:Vec3,footing=SPAWN_FOOTING):boolean {
 const basis=surface.basis(p,{x:0,y:0,z:1});
 for(const [right,forward] of [[footing,0],[-footing,0],[0,footing],[0,-footing]]){
  const probe={
   x:p.x+basis.right.x*right!+basis.forward.x*forward!,
   y:p.y+basis.right.y*right!+basis.forward.y*forward!,
   z:p.z+basis.right.z*right!+basis.forward.z*forward!,
  };
  const support=surface.support(probe,1.2,RADIAL_BELOW);
  if(!support||Math.abs(surface.heightGap(support.point,p))>1.2)return false;
 }
 return true;
}

/**
 * Bounded work per director attempt, relative to the current arena instead of a hard-coded map rectangle.
 *
 * `surface` opcional: sem ele o anel é o mesmo círculo em XZ de hoje, com `groundAt`. Com ele, o
 * anel é geodésico — traçado na base tangente do jogador, com o apoio medido pela radial — e o
 * raio pedido continua sendo a distância CAMINHÁVEL até o jogador, não uma corda que corta o globo.
 */
export function chooseSpawnAround(player:Vec3,rng:RandomStream,terrain:SpawnTerrain,reachable:(p:Vec3)=>boolean,occupied:(p:Vec3)=>boolean,minRadius=SPAWN_RING_MIN,maxRadius=SPAWN_RING_MAX,surface?:EnemySurface):Vec3|undefined {
 for(let attempt=0;attempt<24;attempt++){
  const angle=rng.range(0,Math.PI*2),radius=rng.range(minRadius,maxRadius);
  if(surface){
   const basis=surface.basis(player,{x:0,y:0,z:1});
   const s=Math.sin(angle)*radius,c=Math.cos(angle)*radius;
   const guess={
    x:player.x+basis.right.x*s+basis.forward.x*c,
    y:player.y+basis.right.y*s+basis.forward.y*c,
    z:player.z+basis.right.z*s+basis.forward.z*c,
   };
   const support=surface.support(guess,RADIAL_ABOVE,RADIAL_BELOW);
   if(!support)continue;
   const p={x:support.point.x,y:support.point.y,z:support.point.z};
   if(surface.planarDistance(p,player)<minRadius)continue;
   if(!validRadialSpawnGround(surface,p))continue;
   if(!reachable(p)||occupied(p))continue;
   return p;
  }
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

import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';

export type RewardSource='kill'|'objective'|'field';
export interface RewardPlacement {position:Vec3;source:RewardSource}

/** Espaço reservado para a ejeção e para a cápsula do jogador ao recolher. */
const CLEARANCE:readonly (readonly [number,number])[]=[[0,0],[2.3,0],[-2.3,0],[0,2.3],[0,-2.3],[1.65,1.65],[-1.65,1.65],[1.65,-1.65],[-1.65,-1.65]];

/** Piso seguro e desobstruído em torno de um ponto; anéis crescentes, trabalho limitado. */
export function safeRewardGround(world:CollisionWorld,anchor:Vec3,maxRings=4):Vec3|undefined {
  for(let ring=0;ring<=maxRings;ring++){
    const radius=ring*3.5;
    for(let i=0;i<(ring?12:1);i++){
      const angle=i*Math.PI/6,x=anchor.x+Math.sin(angle)*radius,z=anchor.z+Math.cos(angle)*radius;
      // Morte no ar ou na borda: aceita piso vários metros abaixo do ponto do abate.
      const y=world.groundAt(x,z,anchor.y+1.5);
      if(!Number.isFinite(y)||y<anchor.y-14)continue;
      let clear=true;
      for(const [dx,dz] of CLEARANCE){
        const px=x+dx,pz=z+dz,py=world.groundAt(px,pz,y+.5);
        if(!Number.isFinite(py)||Math.abs(py-y)>.5||world.insideSolid({x:px,y:py,z:pz},1.8)||world.sweepSphere({x:px,y:py+.8,z:pz},{x:0,y:.6,z:0},.35,true)){clear=false;break;}
      }
      if(clear)return {x,y,z};
    }
  }
  return undefined;
}

/**
 * Onde a recompensa cai, na ordem pedida pelo usuário:
 * 1. onde morreu o monstro que concluiu o evento;
 * 2. o último abate válido da área;
 * 3. o próprio objetivo (totem/campo) como último recurso.
 *
 * Cada candidato só é aceito se tiver piso seguro em volta — morte no ar ou em beirada
 * escorrega para o anel seguro mais próximo em vez de deixar o item inalcançável.
 */
export function resolveRewardPlacement(world:CollisionWorld,candidates:{position:Vec3|undefined;source:RewardSource}[]):RewardPlacement|undefined {
  for(const candidate of candidates){
    if(!candidate.position)continue;
    const ground=safeRewardGround(world,candidate.position);
    if(ground)return {position:ground,source:candidate.source};
  }
  return undefined;
}

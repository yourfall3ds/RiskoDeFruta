import type { Vec3 } from '../core/contracts';
import { ENEMIES,type EnemyKind } from '../run/MonsterDirector';
import type { CombatPresentation } from '../vfx/CombatPresentation';

export interface AttackingEnemy {id:number;attack:number;locked:Vec3;direction:{x:number;z:number};root:{position:Vec3};time:number}
export interface AttackContext {actor:AttackingEnemy;player:Vec3;effects:CombatPresentation;hurt:(damage:number,source:string,knockback?:number)=>void;spawn:(kind:EnemyKind,position:Vec3)=>boolean;nearby:number;laser?:(damage:number)=>void}
/**
 * Aviso do ataque que realmente vai sair, escolhido por ataque concreto e não por espécie.
 * `none` = só animação/som (mordida); `aim` = direção do disparo, sem área; `band` = trajeto
 * varrido pela investida (largura de contato real); `beam` = linha real do laser; `cone` =
 * varredura; `circle` = área de dano real (fogo/ácido/raízes). Nada de anel genérico por windup.
 */
export type TelegraphPlan={shape:'none'}|{shape:'aim';width:number;length:number}|{shape:'band';width:number;reach:number}|{shape:'beam';width:number}|{shape:'cone';radius:number}|{shape:'circle';radius:number;kind:string};
interface EnemyBehavior {windup:number;ranged?:boolean;zigzag?:boolean;perform:(context:AttackContext)=>void;recoverySpeed:(actor:AttackingEnemy)=>number;hover?:(actor:AttackingEnemy,time:number)=>number;roll?:(actor:AttackingEnemy)=>number;contactDamage:number;telegraph:(actor:AttackingEnemy)=>TelegraphPlan}
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.z-b.z);
const stop=()=>0;
const aimRush=(a:AttackingEnemy,angle=0)=>{const dx=a.locked.x-a.root.position.x,dz=a.locked.z-a.root.position.z,len=Math.hypot(dx,dz)||1;a.direction={x:(dx*Math.cos(angle)-dz*Math.sin(angle))/len,z:(dx*Math.sin(angle)+dz*Math.cos(angle))/len};};
const origin=(a:AttackingEnemy,height=1.3):Vec3=>({x:a.root.position.x,y:a.root.position.y+height,z:a.root.position.z});
const target=(a:AttackingEnemy):Vec3=>({...a.locked,y:a.locked.y+.9});
const bite=(c:AttackContext,range:number,damage:number,name:string)=>{if(distance(c.actor.root.position,c.player)<range)c.hurt(damage,name);};
/** Largura de contato real da investida: o mesmo raio usado pelo teste de dano do `recover`. */
const contactWidth=(kind:EnemyKind)=>(ENEMIES[kind].radius+.55)*2;
/** Decisão travada no alvo do windup, para aviso e execução escolherem sempre o mesmo ramo. */
const lunges=(a:AttackingEnemy,range:number)=>distance(a.root.position,a.locked)>range;
const AIM:TelegraphPlan={shape:'aim',width:.6,length:3.2};
const NONE:TelegraphPlan={shape:'none'};

/** Species supply decisions and attack recipes; the swarm only advances shared states. */
export const ENEMY_BEHAVIORS:Record<EnemyKind,EnemyBehavior>={
  eggplant:{windup:.9,contactDamage:24,recoverySpeed:a=>a.time<.95&&Math.hypot(a.direction.x,a.direction.z)>.1?10:0,
    telegraph:a=>lunges(a,2.3)?{shape:'band',width:contactWidth('eggplant'),reach:9.5}:NONE,
    perform:c=>{if(lunges(c.actor,2.3))aimRush(c.actor);else bite(c,2.6,16,'eggplant_bite');}},
  corn:{windup:1.05,ranged:true,contactDamage:0,recoverySpeed:stop,telegraph:()=>AIM,
    perform:c=>{const a=c.actor,o=origin(a),t=target(a),count=a.attack%2?3:5;
      for(let i=0;i<count;i++){const angle=count===3?0:(i-2)*.12,dx=t.x-o.x,dz=t.z-o.z;c.effects.projectile(o,{x:o.x+dx*Math.cos(angle)-dz*Math.sin(angle),y:t.y,z:o.z+dx*Math.sin(angle)+dz*Math.cos(angle)},9+i*.7,11,a.id,0,undefined,count===3?i*.16:0);}}},
  watermelon:{windup:1.05,contactDamage:26,recoverySpeed:a=>a.attack%3===1&&a.time<.85?11:0,
    telegraph:a=>a.attack%3===1||(a.attack%3===0&&lunges(a,3.4))?{shape:'band',width:contactWidth('watermelon'),reach:9.35}:a.attack%3===2?AIM:NONE,
    perform:c=>{const a=c.actor;if(a.attack%3===1)aimRush(a);else if(a.attack%3===2){for(let i=0;i<5;i++)c.effects.projectile(origin(a,.8),target(a),14,12,a.id,1,{seed:true},i*.13);}else if(!lunges(a,3.4))bite(c,3.4,30,'watermelon_bite');else{aimRush(a);a.attack++;}},
    roll:a=>a.attack%3===1?Math.min(1,a.time/.85)*Math.PI*4:0},
  tomato:{windup:1.1,ranged:true,contactDamage:22,recoverySpeed:stop,
    telegraph:()=>({shape:'circle',radius:2.3,kind:'fire-intent'}),
    perform:c=>{const a=c.actor;c.effects.projectile(origin(a,3.5),target(a),11,18,a.id,0,{zone:'fire'});},
    hover:(_a,time)=>2.0+Math.sin(time*2.5)*.16},
  carrot:{windup:1.15,ranged:true,contactDamage:0,recoverySpeed:stop,telegraph:()=>({shape:'beam',width:1}),perform:c=>{c.laser?.(24);}},
  boss:{windup:1.4,contactDamage:35,recoverySpeed:stop,
    telegraph:a=>a.attack%5===4?{shape:'cone',radius:7}:NONE,
    perform:c=>BOSS_ATTACKS[c.actor.attack%5]!(c)},
};

/**
 * Auditoria de avisos: 0 invoca (anel de invocação onde o bicho nasce), 1 raízes (dano real 26),
 * 2 ácido (círculo de raio 4, o mesmo da poça criada no impacto), 3 barragem direta (só marca os
 * três projéteis que invocam; os outros não têm área), 4 varredura (cone desenhado no windup).
 */
const BOSS_ATTACKS:readonly ((c:AttackContext)=>void)[]=[
  c=>{const a=c.actor;for(let i=0;i<6;i++){const t={x:a.root.position.x+Math.sin(i*Math.PI/3)*5,y:a.root.position.y,z:a.root.position.z+Math.cos(i*Math.PI/3)*5};c.effects.warning(t,1,.8,0,a.id,'summon');c.effects.projectile(origin(a,5.5),t,9,0,a.id,8,{summon:i%2?'carrot':'eggplant'});}},
  c=>{const a=c.actor;for(let i=0;i<5;i++)c.effects.warning({x:a.locked.x+(i-2)*2.1,y:a.locked.y,z:a.locked.z+Math.sin(i)*3},2.1,.8+i*.18,26,a.id,'root');},
  c=>{const a=c.actor;c.effects.warning(a.locked,4,1.1,0,a.id,'acid-intent');c.effects.projectile(origin(a,5.5),target(a),13,32,a.id,5,{zone:'acid'});},
  c=>{const a=c.actor;for(let i=0;i<7;i++){const t={x:a.locked.x+(i-3)*2,y:a.locked.y,z:a.locked.z+Math.cos(i)*2},summons=i%3===0;if(summons)c.effects.warning(t,1,1.5,0,a.id,'summon');c.effects.projectile(origin(a,7),t,11,24,a.id,7,summons?{summon:'eggplant'}:undefined);}},
  c=>{const a=c.actor,dx=c.player.x-a.root.position.x,dz=c.player.z-a.root.position.z,lx=a.locked.x-a.root.position.x,lz=a.locked.z-a.root.position.z;const cosine=(dx*lx+dz*lz)/(Math.hypot(dx,dz)*Math.hypot(lx,lz)||1);if(Math.hypot(dx,dz)<7&&cosine>.5){c.hurt(35,'massive_swipe',9);c.effects.burst(c.player,'juice',2);}},
];


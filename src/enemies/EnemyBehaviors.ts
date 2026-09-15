import type { Vec3 } from '../core/contracts';
import type { EnemyKind } from '../run/MonsterDirector';
import type { CombatPresentation } from '../vfx/CombatPresentation';

export interface AttackingEnemy {id:number;attack:number;locked:Vec3;direction:{x:number;z:number};root:{position:Vec3};time:number}
export interface AttackContext {actor:AttackingEnemy;player:Vec3;effects:CombatPresentation;hurt:(damage:number,source:string,knockback?:number)=>void;spawn:(kind:EnemyKind,position:Vec3)=>boolean;nearby:number;laser?:(damage:number)=>void}
interface EnemyBehavior {windup:number;warningRadius:number;ranged?:boolean;zigzag?:boolean;perform:(context:AttackContext)=>void;recoverySpeed:(actor:AttackingEnemy)=>number;hover?:(actor:AttackingEnemy,time:number)=>number;roll?:(actor:AttackingEnemy)=>number;contactDamage:number;warningShape?:'line'|'cone'}
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.z-b.z);
const stop=()=>0;
const aimRush=(a:AttackingEnemy,angle=0)=>{const dx=a.locked.x-a.root.position.x,dz=a.locked.z-a.root.position.z,len=Math.hypot(dx,dz)||1;a.direction={x:(dx*Math.cos(angle)-dz*Math.sin(angle))/len,z:(dx*Math.sin(angle)+dz*Math.cos(angle))/len};};
const origin=(a:AttackingEnemy,height=1.3):Vec3=>({x:a.root.position.x,y:a.root.position.y+height,z:a.root.position.z});
const target=(a:AttackingEnemy):Vec3=>({...a.locked,y:a.locked.y+.9});
const bite=(c:AttackContext,range:number,damage:number,name:string)=>{if(distance(c.actor.root.position,c.player)<range)c.hurt(damage,name);};

/** Species supply decisions and attack recipes; the swarm only advances shared states. */
export const ENEMY_BEHAVIORS:Record<EnemyKind,EnemyBehavior>={
  eggplant:{windup:.9,warningRadius:1.4,warningShape:'line',contactDamage:24,recoverySpeed:a=>a.time<.95&&Math.hypot(a.direction.x,a.direction.z)>.1?10:0,
    perform:c=>{if(distance(c.actor.root.position,c.player)>2.3)aimRush(c.actor);else bite(c,2.6,16,'eggplant_bite');}},
  corn:{windup:1.05,warningRadius:1.3,ranged:true,contactDamage:0,recoverySpeed:stop,
    perform:c=>{const a=c.actor,o=origin(a),t=target(a),count=a.attack%2?3:5;
      for(let i=0;i<count;i++){const angle=count===3?0:(i-2)*.12,dx=t.x-o.x,dz=t.z-o.z;c.effects.projectile(o,{x:o.x+dx*Math.cos(angle)-dz*Math.sin(angle),y:t.y,z:o.z+dx*Math.sin(angle)+dz*Math.cos(angle)},9+i*.7,11,a.id,0,undefined,count===3?i*.16:0);}}},
  watermelon:{windup:1.05,warningRadius:2.6,contactDamage:26,warningShape:'line',recoverySpeed:a=>a.attack%3===1&&a.time<.85?11:0,
    perform:c=>{const a=c.actor;if(a.attack%3===1)aimRush(a);else if(a.attack%3===2){for(let i=0;i<5;i++)c.effects.projectile(origin(a,.8),target(a),14,12,a.id,1,{seed:true},i*.13);}else if(distance(a.root.position,c.player)<3.4)bite(c,3.4,30,'watermelon_bite');else{aimRush(a);a.attack++;}},
    roll:a=>a.attack%3===1?Math.min(1,a.time/.85)*Math.PI*4:0},
  tomato:{windup:1.1,warningRadius:2.2,ranged:true,contactDamage:22,recoverySpeed:stop,
    perform:c=>{const a=c.actor;c.effects.projectile(origin(a,3.5),target(a),11,18,a.id,0,{zone:'fire'});},
    hover:(_a,time)=>2.0+Math.sin(time*2.5)*.16},
  carrot:{windup:1.15,warningRadius:1,ranged:true,warningShape:'line',contactDamage:0,recoverySpeed:stop,perform:c=>{c.laser?.(24);}},
  boss:{windup:1.4,warningRadius:4,contactDamage:35,warningShape:'cone',recoverySpeed:stop,
    perform:c=>BOSS_ATTACKS[c.actor.attack%5]!(c)},
};

const BOSS_ATTACKS:readonly ((c:AttackContext)=>void)[]=[
  c=>{const a=c.actor;for(let i=0;i<6;i++){const t={x:a.root.position.x+Math.sin(i*Math.PI/3)*5,y:a.root.position.y,z:a.root.position.z+Math.cos(i*Math.PI/3)*5};c.effects.warning(t,1,.8,0,a.id,'summon');c.effects.projectile(origin(a,5.5),t,9,0,a.id,8,{summon:i%2?'carrot':'eggplant'});}},
  c=>{const a=c.actor;for(let i=0;i<5;i++)c.effects.warning({x:a.locked.x+(i-2)*2.1,y:a.locked.y,z:a.locked.z+Math.sin(i)*3},2.1,.8+i*.18,26,a.id,'root');},
  c=>{const a=c.actor;c.effects.warning(a.locked,4,1.1,0,a.id,'intent');c.effects.projectile(origin(a,5.5),target(a),13,32,a.id,5,{zone:'acid'});},
  c=>{const a=c.actor;for(let i=0;i<7;i++){const t={x:a.locked.x+(i-3)*2,y:a.locked.y,z:a.locked.z+Math.cos(i)*2};c.effects.warning(t,1.5,1.5,0,a.id,'intent');c.effects.projectile(origin(a,7),t,11,24,a.id,7,i%3===0?{summon:'eggplant'}:undefined);}},
  c=>{const a=c.actor,dx=c.player.x-a.root.position.x,dz=c.player.z-a.root.position.z,lx=a.locked.x-a.root.position.x,lz=a.locked.z-a.root.position.z;const cosine=(dx*lx+dz*lz)/(Math.hypot(dx,dz)*Math.hypot(lx,lz)||1);if(Math.hypot(dx,dz)<7&&cosine>.5){c.hurt(35,'massive_swipe',9);c.effects.burst(c.player,'juice',2);}},
];


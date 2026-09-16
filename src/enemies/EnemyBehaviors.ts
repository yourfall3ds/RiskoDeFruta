import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Vec3 } from '../core/contracts';
import { ENEMIES,type EnemyKind } from '../run/MonsterDirector';
import type { CombatPresentation } from '../vfx/CombatPresentation';
import type { EnemySpace,Heading } from './EnemySpace';

export interface AttackingEnemy {id:number;attack:number;locked:Vec3;direction:Heading;root:{position:Vec3};time:number}
/**
 * `space` é OPCIONAL: sem ele tudo mede em XZ e sobe em `+Y`, que é a fazenda de hoje. Com ele
 * (planeta) as mesmas receitas medem arco, saem da altura certa na vertical local e miram tangente.
 * Nenhuma receita, número, contagem ou aviso muda.
 */
export interface AttackContext {actor:AttackingEnemy;player:Vec3;effects:CombatPresentation;hurt:(damage:number,source:string,knockback?:number)=>void;spawn:(kind:EnemyKind,position:Vec3)=>boolean;nearby:number;laser?:(damage:number)=>void;space?:EnemySpace}
/**
 * Aviso do ataque que realmente vai sair, escolhido por ataque concreto e não por espécie.
 * `none` = só animação/som (mordida); `aim` = direção do disparo, sem área; `band` = trajeto
 * varrido pela investida (largura de contato real); `beam` = linha real do laser; `cone` =
 * varredura; `circle` = área de dano real (fogo/ácido/raízes). Nada de anel genérico por windup.
 */
/** Rascunho único das receitas: nenhuma delas guarda o vetor, todas copiam com `vec`. */
const rush=new Vector3();
const vec=(v:Vector3):Vec3=>({x:v.x,y:v.y,z:v.z});
export type TelegraphPlan={shape:'none'}|{shape:'aim';width:number;length:number}|{shape:'band';width:number;reach:number}|{shape:'beam';width:number}|{shape:'cone';radius:number}|{shape:'circle';radius:number;kind:string};
interface EnemyBehavior {windup:number;ranged?:boolean;zigzag?:boolean;perform:(context:AttackContext)=>void;recoverySpeed:(actor:AttackingEnemy)=>number;hover?:(actor:AttackingEnemy,time:number)=>number;roll?:(actor:AttackingEnemy)=>number;contactDamage:number;telegraph:(actor:AttackingEnemy,space?:EnemySpace)=>TelegraphPlan}
const flat=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.z-b.z);
const distance=(a:Vec3,b:Vec3,space?:EnemySpace)=>space?space.distance(a,b):flat(a,b);
const stop=()=>0;
/**
 * Direção travada da investida. No plano é o mesmo `(dx,dz)` normalizado e girado de `angle`; no
 * planeta a direção sai tangente ao convés e o giro acontece em torno da vertical local — a
 * investida continua sendo uma reta no chão, não uma corda que entra no globo.
 */
const aimRush=(a:AttackingEnemy,angle=0,space?:EnemySpace)=>{
  if(!space){const dx=a.locked.x-a.root.position.x,dz=a.locked.z-a.root.position.z,len=Math.hypot(dx,dz)||1;a.direction={x:(dx*Math.cos(angle)-dz*Math.sin(angle))/len,z:(dx*Math.sin(angle)+dz*Math.cos(angle))/len};return;}
  space.towardInto(a.root.position,a.locked,rush);
  a.direction={x:rush.x,y:rush.y,z:rush.z};
  if(angle)space.rotateHeading(a.root.position,a.direction,angle);
};
const origin=(a:AttackingEnemy,height=1.3,space?:EnemySpace):Vec3=>
  space?vec(space.lift(a.root.position,height,rush)):{x:a.root.position.x,y:a.root.position.y+height,z:a.root.position.z};
const target=(a:AttackingEnemy,space?:EnemySpace):Vec3=>
  space?vec(space.lift(a.locked,.9,rush)):{...a.locked,y:a.locked.y+.9};
const bite=(c:AttackContext,range:number,damage:number,name:string)=>{if(distance(c.actor.root.position,c.player,c.space)<range)c.hurt(damage,name);};
/** Largura de contato real da investida: o mesmo raio usado pelo teste de dano do `recover`. */
const contactWidth=(kind:EnemyKind)=>(ENEMIES[kind].radius+.55)*2;
/** Decisão travada no alvo do windup, para aviso e execução escolherem sempre o mesmo ramo. */
const lunges=(a:AttackingEnemy,range:number,space?:EnemySpace)=>distance(a.root.position,a.locked,space)>range;
const AIM:TelegraphPlan={shape:'aim',width:.6,length:3.2};
const NONE:TelegraphPlan={shape:'none'};

/** Species supply decisions and attack recipes; the swarm only advances shared states. */
export const ENEMY_BEHAVIORS:Record<EnemyKind,EnemyBehavior>={
  // `hypot` em três eixos: no plano `y` nunca é escrito e o número é idêntico ao de antes; no
  // planeta, perto de um polo a componente tangente pode ser quase toda em `y`, e medir só XZ
  // cancelaria a investida comprometida.
  eggplant:{windup:.9,contactDamage:24,recoverySpeed:a=>a.time<.95&&Math.hypot(a.direction.x,a.direction.y??0,a.direction.z)>.1?10:0,
    telegraph:(a,space)=>lunges(a,2.3,space)?{shape:'band',width:contactWidth('eggplant'),reach:9.5}:NONE,
    perform:c=>{if(lunges(c.actor,2.3,c.space))aimRush(c.actor,0,c.space);else bite(c,2.6,16,'eggplant_bite');}},
  corn:{windup:1.05,ranged:true,contactDamage:0,recoverySpeed:stop,telegraph:()=>AIM,
    perform:c=>{const a=c.actor,o=origin(a,1.3,c.space),t=target(a,c.space),count=a.attack%2?3:5;
      for(let i=0;i<count;i++){const angle=count===3?0:(i-2)*.12;c.effects.projectile(o,spread(o,t,angle,c.space),9+i*.7,11,a.id,0,undefined,count===3?i*.16:0);}}},
  watermelon:{windup:1.05,contactDamage:26,recoverySpeed:a=>a.attack%3===1&&a.time<.85?11:0,
    telegraph:(a,space)=>a.attack%3===1||(a.attack%3===0&&lunges(a,3.4,space))?{shape:'band',width:contactWidth('watermelon'),reach:9.35}:a.attack%3===2?AIM:NONE,
    perform:c=>{const a=c.actor;if(a.attack%3===1)aimRush(a,0,c.space);else if(a.attack%3===2){for(let i=0;i<5;i++)c.effects.projectile(origin(a,.8,c.space),target(a,c.space),14,12,a.id,1,{seed:true},i*.13);}else if(!lunges(a,3.4,c.space))bite(c,3.4,30,'watermelon_bite');else{aimRush(a,0,c.space);a.attack++;}},
    roll:a=>a.attack%3===1?Math.min(1,a.time/.85)*Math.PI*4:0},
  tomato:{windup:1.1,ranged:true,contactDamage:22,recoverySpeed:stop,
    telegraph:()=>({shape:'circle',radius:2.3,kind:'fire-intent'}),
    perform:c=>{const a=c.actor;c.effects.projectile(origin(a,3.5,c.space),target(a,c.space),11,18,a.id,0,{zone:'fire'});},
    hover:(_a,time)=>2.0+Math.sin(time*2.5)*.16},
  carrot:{windup:1.15,ranged:true,contactDamage:0,recoverySpeed:stop,telegraph:()=>({shape:'beam',width:1}),perform:c=>{c.laser?.(24);}},
  boss:{windup:1.4,contactDamage:35,recoverySpeed:stop,
    telegraph:a=>a.attack%5===4?{shape:'cone',radius:7}:NONE,
    perform:c=>BOSS_ATTACKS[c.actor.attack%5]!(c)},
};

/** Um tiro do leque: o alvo girado de `angle` em torno da vertical local da origem. */
function spread(o:Vec3,t:Vec3,angle:number,space?:EnemySpace):Vec3 {
  const dx=t.x-o.x,dy=t.y-o.y,dz=t.z-o.z;
  if(!space)return{x:o.x+dx*Math.cos(angle)-dz*Math.sin(angle),y:t.y,z:o.z+dx*Math.sin(angle)+dz*Math.cos(angle)};
  const spun={x:dx,y:dy,z:dz};
  space.rotateHeading(o,spun,angle);
  return{x:o.x+spun.x,y:o.y+(spun.y??0),z:o.z+spun.z};
}

/** Ponto deslocado `right`/`forward` metros no plano tangente de `centre`. */
function offset(centre:Vec3,right:number,forward:number,space?:EnemySpace):Vec3 {
  if(!space)return{x:centre.x+right,y:centre.y,z:centre.z+forward};
  const angle=Math.atan2(right,forward),radius=Math.hypot(right,forward);
  return vec(space.ringPoint(centre,angle,radius,0,rush));
}

/**
 * Auditoria de avisos: 0 invoca (anel de invocação onde o bicho nasce), 1 raízes (dano real 26),
 * 2 ácido (círculo de raio 4, o mesmo da poça criada no impacto), 3 barragem direta (só marca os
 * três projéteis que invocam; os outros não têm área), 4 varredura (cone desenhado no windup).
 */
const BOSS_ATTACKS:readonly ((c:AttackContext)=>void)[]=[
  c=>{const a=c.actor;for(let i=0;i<6;i++){const t=offset(a.root.position,Math.sin(i*Math.PI/3)*5,Math.cos(i*Math.PI/3)*5,c.space);c.effects.warning(t,1,.8,0,a.id,'summon');c.effects.projectile(origin(a,5.5,c.space),t,9,0,a.id,8,{summon:i%2?'carrot':'eggplant'});}},
  c=>{const a=c.actor;for(let i=0;i<5;i++)c.effects.warning(offset(a.locked,(i-2)*2.1,Math.sin(i)*3,c.space),2.1,.8+i*.18,26,a.id,'root');},
  c=>{const a=c.actor;c.effects.warning(a.locked,4,1.1,0,a.id,'acid-intent');c.effects.projectile(origin(a,5.5,c.space),target(a,c.space),13,32,a.id,5,{zone:'acid'});},
  c=>{const a=c.actor;for(let i=0;i<7;i++){const t=offset(a.locked,(i-3)*2,Math.cos(i)*2,c.space),summons=i%3===0;if(summons)c.effects.warning(t,1,1.5,0,a.id,'summon');c.effects.projectile(origin(a,7,c.space),t,11,24,a.id,7,summons?{summon:'eggplant'}:undefined);}},
  // Varredura: mesmo setor de 120° do cone desenhado, medido na base tangente do corpo. O cosseno
  // entre "para onde travou" e "onde o jogador está" vale em qualquer vertical, sem eixo fixo.
  c=>{const a=c.actor,reach=distance(a.root.position,c.player,c.space);
    const now=sweepDirection(a.root.position,c.player,c.space),locked=sweepDirection(a.root.position,a.locked,c.space);
    const cosine=now.x*locked.x+now.y*locked.y+now.z*locked.z;
    if(reach<7&&cosine>.5){c.hurt(35,'massive_swipe',9);c.effects.burst(c.player,'juice',2);}},
];

/** Direção tangente unitária usada pela varredura do chefe; no plano é `(dx,0,dz)` normalizado. */
function sweepDirection(from:Vec3,to:Vec3,space?:EnemySpace):Vec3 {
  if(space){space.towardInto(from,to,rush);return{x:rush.x,y:rush.y,z:rush.z};}
  const dx=to.x-from.x,dz=to.z-from.z,length=Math.hypot(dx,dz)||1;
  return{x:dx/length,y:0,z:dz/length};
}


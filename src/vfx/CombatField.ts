import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Vec3} from '../core/contracts';
import type {EnemyKind} from '../run/MonsterDirector';
import {radialSurfaceOf,type EnemySurface} from '../enemies/EnemySpace';

/**
 * O lado de GAMEPLAY dos avisos e projéteis da horda, sem uma única malha.
 *
 * `CombatPresentation` faz as duas coisas hoje: decide onde a poça de ácido machuca E instancia o
 * torus que a desenha. O servidor precisa da primeira metade e não pode ter a segunda — ele não tem
 * cena, material nem pool de GPU. Este arquivo é essa primeira metade, com os MESMOS campos e as
 * mesmas fórmulas (inclusive a elevação balística), para que o número que o servidor resolve seja o
 * número que o cliente desenharia.
 *
 * Não é uma segunda simulação de efeitos: é o dono único dos avisos/projéteis do servidor. O cliente
 * em rede não resolve nenhum deles — ele recebe o resultado.
 */

export interface ProjectileImpact {zone?:'fire'|'acid';summon?:EnemyKind;seed?:boolean;
  /**
   * O projétil é uma ESPIGA arremessada, não um grão.
   *
   * Só apresentação: muda a malha e o tamanho desenhados. Dano, gravidade, raio de contato e
   * colisão continuam vindo dos mesmos campos de `projectile` — a espiga não é um caminho novo
   * de física, é o grão de sempre com outro corpo.
   */
  cob?:boolean}

/** Mesmos campos de `GroundWarning`, menos `mesh`/`circle`. `stretch` só vale para faixas. */
export interface FieldWarning {
  remaining:number;duration:number;radius:number;position:Vec3;active:boolean;
  damage:number;owner:number;kind:string;pulses:number;stretch:number;
}

/** Mesmos campos de `EnemyProjectile`, menos `mesh`. */
export interface FieldProjectile {
  active:boolean;remaining:number;position:Vector3;velocity:Vector3;
  gravity:number;damage:number;owner:number;radius:number;delay:number;impact:ProjectileImpact|undefined;
}

/**
 * O que uma receita de ataque (`ENEMY_BEHAVIORS`) precisa pedir.
 *
 * Declarado como INTERFACE e não como a classe concreta de apresentação: era exatamente esse
 * acoplamento (`effects:CombatPresentation`) que prendia as receitas ao Babylon e impedia o
 * servidor de executá-las. `CombatPresentation` e `CombatField` satisfazem os dois estruturalmente,
 * então nenhuma receita, número, contagem ou aviso muda de lado nenhum.
 */
export interface EffectsSink {
  warning(position:Vec3,radius:number,seconds:number,damage:number,owner:number,kind?:string):{pulses:number}|undefined;
  cone(from:Vec3,to:Vec3,radius:number,seconds:number,owner:number):void;
  line(from:Vec3,to:Vec3,width:number,seconds:number,owner:number,kind?:'band'|'aim'):void;
  /**
   * `preAimed`: a direcao recebida JA e a solucao do arco, entao nao acrescente elevacao.
   *
   * Sem isto, quem resolve a balistica por fora (o arremesso do milho) leva a elevacao duas vezes
   * e o projetil passa por cima do alvo. Quem mira reto continua sem passar nada.
   */
  projectile(origin:Vec3,target:Vec3,speed:number,damage:number,owner:number,gravity?:number,impact?:ProjectileImpact,delay?:number,preAimed?:boolean):void;
  burst(position:Vec3,color?:'energy'|'juice'|'seed'|'soil',scale?:number):void;
}

/**
 * Tetos idênticos aos pools da apresentação (48 avisos, 128 projéteis). Sem malha eles poderiam ser
 * infinitos — mas então o servidor aceitaria uma barragem que o cliente não consegue desenhar, e o
 * dano existiria sem o aviso correspondente na tela. O teto é parte da regra, não do render.
 */
export const FIELD_WARNINGS=48,FIELD_PROJECTILES=128;

export class CombatField implements EffectsSink {
  readonly warnings:FieldWarning[]=[];
  readonly projectiles:FieldProjectile[]=[];
  private surface:EnemySurface|undefined;

  constructor(){
    for(let i=0;i<FIELD_WARNINGS;i++)
      this.warnings.push({remaining:0,duration:1,radius:1,position:{x:0,y:0,z:0},active:false,damage:0,owner:0,kind:'',pulses:0,stretch:1});
    for(let i=0;i<FIELD_PROJECTILES;i++)
      this.projectiles.push({active:false,remaining:0,position:Vector3.Zero(),velocity:Vector3.Zero(),gravity:0,damage:0,owner:0,radius:.18,delay:0,impact:undefined});
  }

  useSurface(surface:EnemySurface|undefined):void {this.surface=radialSurfaceOf(surface);}

  /** Comprimento CAMINHÁVEL — a mesma expressão de `CombatPresentation.span`. */
  private span(from:Vec3,to:Vec3):number {
    return this.surface?this.surface.planarDistance(from,to):Math.hypot(to.x-from.x,to.z-from.z);
  }

  warning(position:Vec3,radius:number,seconds:number,damage:number,owner:number,kind='impact'):FieldWarning|undefined {
    const w=this.warnings.find(x=>!x.active);
    if(!w)return;
    Object.assign(w,{active:true,position:{x:position.x,y:position.y,z:position.z},radius,remaining:seconds,duration:seconds,damage,owner,kind,pulses:kind==='acid'?8:kind==='fire'?5:0,stretch:1});
    return w;
  }

  /**
   * Cone e faixa ocupam um slot de aviso SEM dano, exatamente como na apresentação: eles contam
   * para a lotação do pool, e é isso que mantém servidor e cliente com a mesma capacidade.
   */
  cone(from:Vec3,to:Vec3,radius:number,seconds:number,owner:number):void {
    const w=this.warnings.find(x=>!x.active);
    if(!w)return;
    Object.assign(w,{active:true,position:{x:from.x,y:from.y,z:from.z},radius,remaining:seconds,duration:seconds,damage:0,owner,kind:'cone',pulses:0,stretch:1});
    void to;
  }

  line(from:Vec3,to:Vec3,width:number,seconds:number,owner:number,kind:'band'|'aim'='band'):void {
    const length=this.span(from,to);
    if(length<.05)return;
    const w=this.warnings.find(x=>!x.active);
    if(!w)return;
    Object.assign(w,{active:true,position:{x:(from.x+to.x)/2,y:(from.y+to.y)/2,z:(from.z+to.z)/2},radius:width,remaining:seconds,duration:seconds,damage:0,owner,kind,pulses:0,stretch:length});
  }

  projectile(origin:Vec3,target:Vec3,speed:number,damage:number,owner:number,gravity=0,impact?:ProjectileImpact,delay=0,preAimed=false):void {
    const p=this.projectiles.find(x=>!x.active);
    if(!p)return;
    p.active=true;p.remaining=6;p.damage=damage;p.owner=owner;p.gravity=gravity;p.impact=impact;p.delay=delay;
    p.radius=impact?.zone==='fire'?.3:impact?.seed?.12:.18;
    p.position.copyFromFloats(origin.x,origin.y,origin.z);
    p.velocity.copyFromFloats(target.x-origin.x,target.y-origin.y,target.z-origin.z).normalize().scaleInPlace(speed);
    // Mesma elevação balística da apresentação, pela vertical LOCAL da origem — e a MESMA dispensa
    // por `preAimed`. Se só um dos dois lados honrasse a bandeira, servidor e cliente desenhariam
    // trajetórias diferentes para o mesmo tiro, que é o pior defeito possível num jogo em rede.
    if(gravity&&!preAimed){
      const lead=this.span(origin,target)/speed*gravity*.5,up=this.surface?.up(origin);
      if(up)p.velocity.addInPlaceFromFloats(up.x*lead,up.y*lead,up.z*lead);
      else p.velocity.y+=lead;
    }
  }

  /** Estilhaço é 100% cosmético: no servidor ele não existe, e ignorar aqui é a decisão certa. */
  burst(_position:Vec3,_color:'energy'|'juice'|'seed'|'soil'='juice',_scale=1):void {}

  clear():void {
    for(const w of this.warnings)Object.assign(w,{active:false,remaining:0,damage:0,pulses:0,stretch:1,kind:''});
    for(const p of this.projectiles){p.active=false;p.delay=0;p.impact=undefined;}
  }

  /** Quem pertence a um corpo que saiu de campo. Mesmo protocolo de `EnemySwarm.cancelEffectsOf`. */
  cancelOwner(owner:number):void {
    for(const w of this.warnings)if(w.active&&w.owner===owner){w.active=false;w.remaining=0;w.damage=0;w.pulses=0;}
    for(const p of this.projectiles)if(p.active&&p.owner===owner)p.active=false;
  }

  get active():number {
    return this.warnings.filter(w=>w.active).length+this.projectiles.filter(p=>p.active).length;
  }
}

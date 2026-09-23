import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {nearestContact,type CombatServices} from './CombatServices';
import {WORLD_SPACE,type CombatCamera,type CombatSpace} from './DualPistols';
import {PrismMagazine} from './PrismArsenal';
import {PrismTrigger} from './PrismTrigger';
import {fanAngles} from './PrismSkills';
import {
  MARIJUANO_SMG,SMG_SHOT_TAGS,SMG_SKILL_TAGS,marijuanoSkill,
  type SmgSkillPlan,type SmgSkillTier,type SmgTuning,
} from './SmgTuning';

/**
 * O rig autoral da submetralhadora, visto pelo backend.
 *
 * É exatamente o contrato publicado por `src/combat/SmgRig.ts` e nada além dele. Declarado por
 * ESTRUTURA para o teste fechar todo o fluxo (equipar, disparar, recarregar, soltar habilidade)
 * com um duplo — sem cena, sem GLB e sem áudio.
 */
export interface SmgRigPort {
  readonly ready: boolean;
  enabled: boolean;
  /** A pose do tronco segue a mira enquanto o gatilho está preso ou uma rajada está tocando. */
  firing?: boolean;
  /** Boca do cano em MUNDO. `undefined` antes da carga ou com o rig escondido. */
  readonly muzzle: Vector3 | undefined;
  update(dt: number): void;
  fire(): void;
  /** Amostra o clipe de recarga; `-1` restaura a pose. */
  reload(progress: number): void;
  reset(): void;
}

/** Os buds desenhados. Opcional: sem eles o combate usa o rastro genérico do `ShotEffects`. */
export interface BudVisualsPort {
  readonly ready: boolean;
  spawn(from: Vector3, to: Vector3, speed: number, scale?: number): void;
  update(dt: number): void;
  clear(): void;
}

/** O mínimo de áudio que a arma usa. `WeaponAudio` satisfaz por estrutura. */
export interface SmgAudioPort {
  shot(hit: boolean): void;
  reload?(): void;
}

/** Sorteio da abertura do tiro. `RandomStream` satisfaz por estrutura. */
export interface SmgRandom {range(min: number, max: number): number}

/** Intenção do quadro, já resolvida pela cena (bordas de tecla incluídas). */
export interface SmgCommand {
  readonly fire: boolean;
  /** `R` */
  readonly reload: boolean;
  /** `false` congela a arma: esquiva, carga de MP, morte, viagem, revisão. */
  readonly canAct: boolean;
}

export interface MarijuanoWeaponPorts {
  readonly services: CombatServices;
  readonly rig: SmgRigPort;
  readonly camera: CombatCamera;
  readonly rng: SmgRandom;
  /** Corpo do jogador em MUNDO; só serve de âncora quando o rig ainda não publicou a boca. */
  readonly body: () => Vector3;
  readonly visuals?: BudVisualsPort | undefined;
  readonly space?: CombatSpace | undefined;
  readonly audio?: SmgAudioPort | undefined;
  readonly tuning?: SmgTuning | undefined;
}

/** O que UM disparo entrega, já resolvido. O comum e os das habilidades passam pelo MESMO caminho. */
interface SmgShotProfile {
  readonly damage: number;
  readonly attackId: string;
  readonly tags: readonly string[];
  readonly procCoefficient: number;
  readonly force: number;
}

/**
 * O MARIJUANO em jogo: uma submetralhadora de seda que cospe buds, sobre a física de tiro que já
 * existia.
 *
 * O que ela NÃO faz, de propósito:
 *
 * - não refaz mira, colisão, destruição, crítico, ponto fraco nem MP — tudo isso entra por
 *   `CombatServices`, que é a porta do combate original (ver `DualPistols`);
 * - não toca no rig por dentro: pose, clipes e alinhamento são do `SmgRig`;
 * - não inventa projétil com física própria: o bud é DESENHO (`BudShots`), e o dano é o mesmo
 *   hitscan do assalto da PRISM. Uma terceira balística seria a terceira cópia da mesma regra.
 *
 * As três habilidades do `Q` são variações do mesmo disparo (ver `SmgTuning`): uma rajada certeira,
 * um leque largo e uma janela que reescreve o gatilho. Nenhuma abre caminho de dano novo.
 */
export class MarijuanoWeapon {
  readonly tuning: SmgTuning;
  readonly magazine: PrismMagazine;
  readonly trigger = new PrismTrigger();
  private readonly services: CombatServices;
  private readonly rig: SmgRigPort;
  private readonly camera: CombatCamera;
  private readonly rng: SmgRandom;
  private readonly bodyAt: () => Vector3;
  private readonly visuals: BudVisualsPort | undefined;
  private readonly space: CombatSpace;
  private readonly audio: SmgAudioPort | undefined;
  private readonly scratchUp = new Vector3(0, 1, 0);

  /** `true` quando a submetralhadora é a arma nas mãos (a alternativa são as pistolas). */
  equipped = false;
  /** Armas guardadas (tecla `V`): nada dispara. */
  holstered = false;
  /** Apresentação retida pela cena: entrada pela nave, viagem, morte, revisão. */
  suppressed = false;
  /** Botão direito preso NESTE quadro — aperta o leque, nunca o zera. */
  aiming = false;
  /** Disparos efetivamente saídos, por tentativa — entra no diagnóstico do F1. */
  shots = 0;
  /** Habilidades efetivamente soltas nesta tentativa; diagnóstico do F1. */
  skillReleases = 0;

  /** A habilidade no ar. `undefined` quando não há nenhuma. */
  private plan: SmgSkillPlan | undefined;
  /** Emissões já cuspidas pela habilidade no ar. */
  private emitted = 0;
  /** Relógio das emissões, em segundos desde a última. */
  private emissionClock = 0;
  /** Segundos restantes da janela de sobrecarga; `0` fora dela. */
  private overdrive = 0;
  /** O clipe de recarga está sendo amostrado; usado para mandar `-1` uma única vez no fim. */
  private reloadShown = false;

  constructor(ports: MarijuanoWeaponPorts) {
    this.tuning=ports.tuning??MARIJUANO_SMG;
    this.services=ports.services;this.rig=ports.rig;this.camera=ports.camera;this.rng=ports.rng;
    this.bodyAt=ports.body;this.visuals=ports.visuals;this.space=ports.space??WORLD_SPACE;
    this.audio=ports.audio;
    this.magazine=new PrismMagazine(this.tuning.capacity,this.tuning.reloadSeconds);
  }

  /** `true` quando o rig autoral subiu; sem ele a arma nem chega a ser equipável. */
  get ready(): boolean {return this.rig.ready;}
  get reloading(): boolean {return this.magazine.reloading;}
  /** A submetralhadora não se transforma: nunca está ocupada. Existe pela simetria das portas. */
  get busy(): boolean {return false;}
  /** Cadência da progressão (`stats.attackSpeed`), igual à das pistolas. */
  set rateMultiplier(value: number) {this.trigger.rateMultiplier=value;}
  get rateMultiplier(): number {return this.trigger.rateMultiplier;}
  /** `true` quando a arma pode agir: equipada, sacada, carregada e não suprimida. */
  get live(): boolean {return this.equipped&&!this.holstered&&!this.suppressed&&this.ready;}

  /** `true` enquanto qualquer habilidade está no ar (emissões ou janela de sobrecarga). */
  get skillActive(): boolean {return this.plan!==undefined;}
  /** Nome na tela da habilidade no ar; `''` quando não há nenhuma. */
  get skillLabel(): string {return this.plan?.name??'';}
  /** Segundos restantes da sobrecarga; `0` fora dela. */
  get overdriveRemaining(): number {return this.overdrive;}
  /** `true` enquanto há emissões pendentes — o gatilho comum fica travado. */
  get emitting(): boolean {return this.plan!==undefined&&this.plan.emissions>this.emitted;}

  /** A habilidade que o `Q` solta NESTE instante. Não depende de estado: a arma tem forma única. */
  skillFor(tier: SmgSkillTier): SmgSkillPlan {return marijuanoSkill(tier);}

  /**
   * Equipa ou guarda a submetralhadora. Trocar de arma CANCELA a recarga em curso sem devolver
   * munição — é o que impede "recarrego, troco, volto" virar uma recarga instantânea.
   */
  setEquipped(value: boolean): boolean {
    if(value&&!this.ready)return false;
    if(value===this.equipped)return false;
    this.equipped=value;
    this.magazine.cancel();
    this.trigger.release();
    if(!value)this.endReloadClip();
    return true;
  }

  /** `R`: recarrega. Recusa com o carregador cheio e no meio de uma rajada de habilidade. */
  requestReload(): boolean {
    if(!this.live)return false;
    // Recarregar no meio de uma rajada roubaria a munição que a habilidade JÁ cobrou. A
    // sobrecarga é a exceção escrita: ela come o carregador em tempo real e precisa poder repor.
    if(this.emitting)return false;
    const requested=this.magazine.request();
    if(requested)this.audio?.reload?.();
    return requested;
  }

  /**
   * `Q` níveis I, II e III: solta a habilidade.
   *
   * `false` quando ela não pode sair — e aí quem chamou devolve o MP, porque a barra é descontada
   * na SOLTURA do `Q` e cobrar por uma habilidade que não aconteceu seria roubar o jogador. As
   * recusas são todas de estado real: arma fora das mãos, recarga em curso, outra habilidade no ar
   * e — a que importa — munição insuficiente.
   */
  releaseSkill(tier: SmgSkillTier): boolean {
    if(!this.live||this.magazine.reloading||this.skillActive)return false;
    const plan=this.skillFor(tier);
    if(this.magazine.ammo<plan.ammoRequired)return false;
    for(let i=0;i<plan.ammoCost;i++)if(!this.magazine.consume())return false;
    this.trigger.release();
    this.plan=plan;this.emitted=0;this.emissionClock=plan.interval;
    this.overdrive=plan.seconds;
    this.skillReleases++;
    return true;
  }

  fixedUpdate(dt: number, command: SmgCommand): void {
    this.magazine.update(dt);
    if(!this.live){
      this.rig.firing=false;
      // Uma habilidade não sobrevive à arma sair das mãos: a munição já foi cobrada, mas o resto
      // das emissões seria disparado por um cano que não está mais lá.
      this.cancelSkill();
      this.trigger.release();
      return;
    }
    if(command.reload)this.requestReload();
    // As emissões da habilidade rodam ANTES do gatilho comum e o travam neste passo: os dois
    // caminhos não cospem juntos, e a rajada não perde um tiro para a cadência normal.
    const wasEmitting=this.emitting;
    this.advanceSkill(dt);
    // Carregador vazio recarrega sozinho, como a pistola já fazia — nunca no meio de uma rajada.
    if(this.magazine.ammo===0&&!this.magazine.reloading&&!this.emitting)this.magazine.request();
    const overdrive=this.overdrive>0;
    const rate=this.tuning.rate*(overdrive?(this.plan?.rateScale??1):1);
    const firing=command.fire&&command.canAct&&!this.magazine.reloading
      &&this.magazine.ammo>0&&!wasEmitting&&!this.emitting;
    this.rig.firing=command.canAct&&(firing||wasEmitting||this.emitting);
    this.trigger.update(dt,firing,rate,true,()=>this.shoot());
  }

  /**
   * Apresentação: pose do rig, clipe de recarga e buds desenhados.
   * Roda no relógio de quadro, nunca no passo fixo — é aqui que a arma existe visualmente.
   */
  updatePresentation(dt: number): void {
    const live=this.live;
    if(!live)this.rig.firing=false;
    this.rig.enabled=live;
    if(live){
      if(this.magazine.reloading){this.rig.reload(this.magazine.progress);this.reloadShown=true;}
      else this.endReloadClip();
      this.rig.update(dt);
    } else this.endReloadClip();
    this.visuals?.update(dt);
  }

  /** Morte, pausa dura, viagem: solta o gatilho, apaga o que está no ar e restaura a pose. */
  cancel(): void {
    this.trigger.release();
    this.magazine.cancel();
    this.cancelSkill();
    this.visuals?.clear();
    this.endReloadClip();
  }

  /** Reinício de tentativa: carregador cheio, nada no ar. */
  resetAttempt(): void {
    this.cancel();
    this.magazine.refill();
    this.trigger.reset();
    this.shots=0;this.skillReleases=0;
    this.rig.reset();
    this.equipped=this.ready;
  }

  dispose(): void {this.cancel();this.rig.enabled=false;}

  // ------------------------------------------------------------------ habilidades

  private cancelSkill(): void {this.plan=undefined;this.emitted=0;this.emissionClock=0;this.overdrive=0;}

  /**
   * O relógio da habilidade no ar.
   *
   * Duas formas e só duas: ou ela tem EMISSÕES (e some quando a última sai), ou ela tem uma JANELA
   * (e some quando o tempo acaba). Nada aqui dispara pela cadência normal — a janela só muda os
   * números que `shoot` lê.
   */
  private advanceSkill(dt: number): void {
    const plan=this.plan;
    if(!plan)return;
    if(plan.emissions>0){
      this.emissionClock+=Math.max(0,dt);
      while(this.emitted<plan.emissions&&this.emissionClock>=plan.interval){
        this.emissionClock-=plan.interval;
        this.emit(plan,this.emitted);
        this.emitted++;
      }
      if(this.emitted>=plan.emissions)this.plan=undefined;
      return;
    }
    this.overdrive=Math.max(0,this.overdrive-Math.max(0,dt));
    if(this.overdrive===0)this.plan=undefined;
  }

  /** UMA emissão de habilidade. A munição já foi cobrada em `releaseSkill`. */
  private emit(plan: SmgSkillPlan, index: number): void {
    const origin=this.muzzle().clone();
    const direction=plan.fanDegrees>0
      ? this.fanDirection(origin,plan,index)
      : this.aim(origin,plan.spreadDegrees);
    this.shots++;
    this.rig.fire();
    this.camera.impulse(this.tuning.impulse);
    this.hitscan(origin,direction,this.skillProfile(plan));
  }

  /**
   * O leque da CHUVA DE BUDS gira em torno da vertical LOCAL, não do `+Y` do mundo.
   *
   * Sem isso ele abriria na horizontal do polo norte e torto em toda a outra casca do planeta — o
   * mesmo defeito que o leque de cápsulas do Soldado teve de corrigir.
   */
  private fanDirection(origin: Vector3, plan: SmgSkillPlan, index: number): Vector3 {
    const base=this.aim(origin,0);
    const degrees=fanAngles(plan.emissions,plan.fanDegrees)[index]??0;
    const up=this.space.upAt(origin,this.scratchUp);
    return rotateAround(base,new Vector3(up.x,up.y,up.z).normalize(),degrees*Math.PI/180);
  }

  // ------------------------------------------------------------------ disparo

  private endReloadClip(): void {if(!this.reloadShown)return;this.reloadShown=false;this.rig.reload(-1);}

  /** Boca do cano; sem rig visível cai numa âncora à frente do peito. */
  private muzzle(): Vector3 {
    const authored=this.rig.muzzle;
    if(authored)return authored;
    const body=this.bodyAt();
    const up=this.space.upAt(body,this.scratchUp);
    return body.add(up.scale(1.35)).addInPlace(this.camera.forward.scale(.45));
  }

  /**
   * Um disparo. `false` quando não saiu — e então o gatilho não cobra cadência.
   *
   * A mira é a MESMA das pistolas: o olho da câmera escolhe o ponto visado, e o bud sai do cano em
   * direção a ele. Sem isso ele sairia paralelo à visão e erraria por um palmo a três metros.
   */
  private shoot(): boolean {
    if(!this.magazine.consume())return false;
    const plan=this.overdrive>0?this.plan:undefined;
    const origin=this.muzzle().clone();
    const spread=plan?plan.spreadDegrees:(this.aiming?this.tuning.aimedSpreadDegrees:this.tuning.spreadDegrees);
    const direction=this.aim(origin,spread);
    this.shots++;
    this.rig.fire();
    this.camera.impulse(this.tuning.impulse);
    // A sobrecarga não emite tiro próprio: ela reescreve o tiro NORMAL enquanto a janela dura.
    this.hitscan(origin,direction,plan?this.skillProfile(plan):this.shotProfile());
    return true;
  }

  private aim(origin: Vector3, degrees: number): Vector3 {
    const spread=degrees>0?Math.tan(degrees*Math.PI/180):0;
    const look=this.camera.forward.clone();
    if(spread>0){
      const right=Vector3.Cross(this.space.upAt(origin,this.scratchUp),look).normalize();
      const up=Vector3.Cross(look,right).normalize();
      look.addInPlace(right.scale(this.rng.range(-spread,spread))).addInPlace(up.scale(this.rng.range(-spread,spread)));
    }
    look.normalize();
    const eye=this.camera.camera.position;
    const aimed=nearestContact(this.services.sweep(eye,look,this.tuning.range));
    const point=aimed?aimed.point:eye.add(look.scale(this.tuning.range));
    const travel=point.subtract(origin);
    const length=travel.length();
    return length>1e-4?travel.scale(1/length):look;
  }

  /** O bud comum. `bullet` é o que dá direito a ponto fraco e a MP por acerto. */
  private shotProfile(): SmgShotProfile {
    return {damage:this.tuning.damage,attackId:'bud',tags:SMG_SHOT_TAGS,
      procCoefficient:.45,force:this.tuning.force};
  }

  /** O disparo de uma HABILIDADE. `skill` desliga o MP por acerto e escala o dano por `stats.mp`. */
  private skillProfile(plan: SmgSkillPlan): SmgShotProfile {
    return {damage:this.tuning.damage*plan.damageScale,attackId:plan.id,tags:SMG_SKILL_TAGS,
      procCoefficient:.45,force:this.tuning.force};
  }

  private hitscan(origin: Vector3, direction: Vector3, profile: SmgShotProfile): void {
    const sweep=this.services.sweep(origin,direction,this.tuning.range);
    // A submetralhadora nunca perfura: o primeiro corpo para o bud. É o preço do volume.
    const contact=sweep.actors[0];
    const force=this.camera.forward;
    if(contact?.target){
      this.services.applyHit(contact.target,{
        point:contact.point,force,ray:direction,damage:profile.damage,
        sourceId:this.tuning.id,attackId:profile.attackId,
        tags:profile.tags,procCoefficient:profile.procCoefficient,forceMagnitude:profile.force,
      });
      this.services.effects.impact(contact.point,direction.negate());
    }
    const world=sweep.world;
    // Cenário só leva dano quando NENHUM ator ficou na frente — `sweep.actors` já vem recortado
    // pela parede, então o teste é o mesmo que decide onde sai a marca de bala no tiro comum.
    if(world&&!contact){
      if(!this.services.damageScenery(world.point,world.normal,direction,profile.damage,world.triangle))
        this.services.effects.mark(world.point,world.normal);
      this.services.effects.impact(world.point,world.normal);
    }
    const stop=contact?contact.point:world?world.point:origin.add(direction.scale(this.tuning.range));
    this.services.effects.muzzle(origin);
    // O bud autoral substitui o rastro genérico; sem ele o rastro de sempre continua valendo.
    if(this.visuals?.ready)this.visuals.spawn(origin,stop,this.tuning.budSpeed,this.tuning.budScale);
    else this.services.effects.tracer(origin,stop);
    this.audio?.shot(Boolean(contact?.target));
  }
}

/** Gira `direction` em torno de `axis` por `radians`. Rodrigues, sem alocar quaternion. */
function rotateAround(direction: Vector3, axis: Vector3, radians: number): Vector3 {
  if(radians===0)return direction;
  const cos=Math.cos(radians),sin=Math.sin(radians);
  const dot=Vector3.Dot(axis,direction);
  const cross=Vector3.Cross(axis,direction);
  return new Vector3(
    direction.x*cos+cross.x*sin+axis.x*dot*(1-cos),
    direction.y*cos+cross.y*sin+axis.y*dot*(1-cos),
    direction.z*cos+cross.z*sin+axis.z*dot*(1-cos),
  ).normalize();
}

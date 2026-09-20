import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Vec3} from '../core/contracts';
import type {TrainingTarget} from '../world/TrainingYard';
import {nearestContact,type CombatServices} from './CombatServices';
import {WORLD_SPACE,type CombatCamera,type CombatSpace} from './DualPistols';
import {PrismArsenal,type PrismMagazine} from './PrismArsenal';
import {PrismTrigger} from './PrismTrigger';
import {PrismGrenades,blastFalloff,type Grenade,type GrenadeContact,type GrenadePayload,type GrenadeWorld} from './PrismGrenades';
import {predictGrenadeFlight,type GrenadePrediction,type TrajectoryOptions} from './GrenadeTrajectory';
import {PRISM_GRENADE,PRISM_MODES,type PrismMode,type PrismModeTuning} from './PrismTuning';
import {
  INCENDIARY_TAG,PRISM_SKILL_BLAST_CAP,PRISM_SKILL_BLAST_TAGS,PRISM_SKILL_TAGS,
  PrismSkillRunner,fanAngles,markStrikeTargets,prismSkill,prismSkillDamage,
  type PrismSkillPlan,type PrismSkillTier,
} from './PrismSkills';

/**
 * O que UM tiro instantâneo entrega, já resolvido.
 *
 * Existe para o disparo comum e as habilidades passarem pelo MESMO `hitscan`: o que muda entre eles
 * é este punhado de números, nunca a física. Sem ele a rajada, o tiro pesado e a salva teriam três
 * cópias da mesma varredura, divergindo no primeiro ajuste.
 */
interface PrismShotProfile {
  readonly damage: number;
  readonly pierce: boolean;
  readonly attackId: string;
  readonly tags: readonly string[];
  readonly procCoefficient: number;
  readonly force: number;
}

/**
 * O rig autoral da PRISM, visto pelo backend.
 *
 * É exatamente o contrato publicado por `src/combat/PrismRig.ts` e nada além dele — nenhum campo
 * privado do rig é tocado. Declarado por ESTRUTURA para o teste poder fechar todo o fluxo
 * (equipar, ciclar forma, travar durante a transformação, recarregar, disparar) com um duplo, sem
 * cena, sem GLB e sem áudio.
 */
export interface PrismRigPort {
  readonly ready: boolean;
  enabled: boolean;
  /** Upper-body pose follows the aim while the trigger is held or a burst is playing. */
  firing?: boolean;
  readonly mode: PrismMode;
  /** `true` enquanto a transformação está tocando: nada de disparo, recarga ou nova troca. */
  readonly busy: boolean;
  /** Boca do cano em MUNDO. `undefined` antes da carga ou com o rig escondido. */
  readonly muzzle: Vector3 | undefined;
  update(dt: number): void;
  setMode(mode: PrismMode): void;
  /** Começa a transformação para a PRÓXIMA forma. `false` quando o rig recusa. */
  transform(): boolean;
  fire(): void;
  impact?(mode: PrismMode): void;
  /** Amostra o clipe de recarga; `-1` restaura a pose. */
  reload(progress: number): void;
  reset(): void;
}

/** Apresentação autoral dos projéteis. Opcional: sem ela o combate usa os efeitos genéricos. */
export interface PrismVisualsPort {
  readonly ready: boolean;
  tracer(mode: PrismMode, from: Vector3, to: Vector3): void;
  spawnCapsule(id: number, position: Vector3, direction: Vector3): void;
  moveCapsule(id: number, position: Vector3, direction: Vector3, spin: number): void;
  removeCapsule(id: number): void;
  impact(mode: PrismMode, point: Vector3, normal: Vector3): void;
  explosion(point: Vector3, up: Vector3, radius: number): void;
  update(dt: number): void;
  clear(): void;
}

/** Sorteio da abertura do tiro. `RandomStream` satisfaz por estrutura. */
export interface PrismRandom {range(min: number, max: number): number}

/** Intenção do quadro, já resolvida pela cena (bordas de tecla incluídas). */
export interface PrismCommand {
  readonly fire: boolean;
  /** `R` */
  readonly reload: boolean;
  /**
   * Avança uma forma no ciclo autoral.
   *
   * Já não tem tecla dedicada: o `Q` no nível I é quem transforma (e o F1 tem o mesmo atalho para o
   * QA). O campo continua no comando porque é a porta pela qual o teste fecha o ciclo sem cena.
   */
  readonly cycle: boolean;
  /** `false` congela a arma: esquiva, carga de MP, morte, viagem, revisão. */
  readonly canAct: boolean;
}

export interface PrismWeaponPorts {
  readonly services: CombatServices;
  readonly rig: PrismRigPort;
  readonly camera: CombatCamera;
  readonly rng: PrismRandom;
  /** Corpo do jogador em MUNDO; só serve de âncora quando o rig ainda não publicou a boca. */
  readonly body: () => Vector3;
  readonly visuals?: PrismVisualsPort | undefined;
  readonly space?: CombatSpace | undefined;
}

/**
 * A PRISM em jogo: três armas num rig, sobre a física de tiro que já existia.
 *
 * O que ela NÃO faz, de propósito:
 *
 * - não refaz mira, colisão, destruição, crítico, ponto fraco nem MP — tudo isso entra por
 *   `CombatServices`, que é a porta do combate original (ver `DualPistols`);
 * - não toca no rig por dentro: transformação, pose, áudio e clipes são do `PrismRig`, e o backend
 *   só respeita o `busy` dele;
 * - não cria munição ao trocar de forma: cada forma tem carregador próprio (ver `PrismArsenal`).
 *
 * As habilidades de MP continuam sendo das pistolas, com clipe, voz e coreografia próprios. Este
 * backend não as intercepta; a cena apenas devolve as pistolas às mãos enquanto elas rodam.
 */
export class PrismWeapon {
  readonly arsenal = new PrismArsenal();
  readonly trigger = new PrismTrigger();
  readonly grenades: PrismGrenades;
  /**
   * As habilidades de MP do SOLDADO (níveis II e III), uma por forma.
   *
   * O relógio é puro (`PrismSkills`); aqui só mora a tradução de uma emissão em tiro, cápsula e
   * dano — sempre pela MESMA porta `CombatServices` do disparo comum.
   */
  readonly skills = new PrismSkillRunner();
  /** Habilidades efetivamente soltas nesta tentativa; diagnóstico do F1. */
  skillReleases = 0;
  private readonly services: CombatServices;
  private readonly rig: PrismRigPort;
  private readonly camera: CombatCamera;
  private readonly rng: PrismRandom;
  private readonly bodyAt: () => Vector3;
  private readonly visuals: PrismVisualsPort | undefined;
  private readonly space: CombatSpace;
  /** Uma transformação foi aceita pelo rig e ainda não terminou. */
  private transforming = false;
  /** O clipe de recarga está sendo amostrado; usado para mandar `-1` uma única vez no fim. */
  private reloadShown = false;
  private readonly scratchUp = new Vector3(0, 1, 0);
  /** `true` quando a PRISM é a arma nas mãos (a alternativa são as pistolas). */
  equipped = false;
  /** Armas guardadas (tecla `V`): nem pistola nem PRISM disparam. */
  holstered = false;
  /**
   * Apresentação retida pela cena: entrada pela nave, cinemática de habilidade, viagem, morte.
   * Esconde o rig e trava a arma sem mexer em munição nem em estado de forma.
   */
  suppressed = false;
  /** Disparos efetivamente saídos, por tentativa — entra no diagnóstico do F1. */
  shots = 0;
  /** Explosões resolvidas; diagnóstico e teste de área. */
  blasts = 0;
  /** O mundo visto pela balística. Guardado porque a PRÉVIA da mira integra no MESMO mundo. */
  private readonly grenadeWorld: GrenadeWorld;
  constructor(ports: PrismWeaponPorts) {
    this.services=ports.services;this.rig=ports.rig;this.camera=ports.camera;this.rng=ports.rng;
    this.bodyAt=ports.body;this.visuals=ports.visuals;this.space=ports.space??WORLD_SPACE;
    this.grenadeWorld={
      up:point=>{const up=this.space.upAt(this.vector(point),this.scratchUp);return {x:up.x,y:up.y,z:up.z};},
      segment:(from,to,radius)=>this.segment(from,to,radius),
    };
    this.grenades=new PrismGrenades(this.grenadeWorld,(grenade,at,normal,contact)=>this.detonate(grenade,at,normal,contact));
  }
  /** `true` quando o rig autoral subiu; sem ele a PRISM nem chega a ser equipável. */
  get ready(): boolean {return this.rig.ready;}
  get mode(): PrismMode {return this.arsenal.mode;}
  get tuning(): PrismModeTuning {return this.arsenal.tuning;}
  get magazine(): PrismMagazine {return this.arsenal.magazine;}
  get reloading(): boolean {return this.arsenal.magazine.reloading;}
  /**
   * `true` enquanto a transformação toca — nem disparo, nem recarga, nem nova troca.
   * Considera as duas pontas: o que o rig relata e o pedido já aceito que ele ainda não começou.
   */
  get busy(): boolean {return this.transforming||this.rig.busy;}
  /** Cadência da progressão (`stats.attackSpeed`), igual à das pistolas. */
  set rateMultiplier(value: number) {this.trigger.rateMultiplier=value;}
  get rateMultiplier(): number {return this.trigger.rateMultiplier;}
  /** `true` quando a arma pode agir: equipada, sacada, carregada e fora de transformação. */
  get live(): boolean {return this.equipped&&!this.holstered&&!this.suppressed&&this.ready;}

  /**
   * Equipa ou guarda a PRISM. Trocar de arma CANCELA a recarga em curso sem devolver munição —
   * é o que impede "recarrego, troco, volto" virar uma recarga instantânea.
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
  /** Alterna entre PRISM e pistolas; devolve a arma que ficou nas mãos. */
  toggleEquipped(): boolean {this.setEquipped(!this.equipped);return this.equipped;}

  /**
   * `T`: inicia a transformação para a próxima forma.
   *
   * Recusa durante recarga, durante outra transformação e com a arma fora das mãos. A forma só
   * TROCA quando o rig termina o clipe — quem manda no momento é o rig, e o carregador da nova
   * forma é o que ela tinha guardado.
   */
  requestMode(): boolean {
    if(!this.live||this.busy||this.reloading)return false;
    if(!this.rig.transform())return false;
    this.transforming=true;this.trigger.release();
    return true;
  }
  /** `R`: recarrega a forma em vigor. Recusa durante transformação e com o carregador cheio. */
  requestReload(): boolean {
    if(!this.live||this.busy)return false;
    // Recarregar no meio de uma rajada roubaria a munição que a habilidade JÁ cobrou.
    if(this.skills.emitting)return false;
    return this.magazine.request();
  }

  // ------------------------------------------------------------------ habilidades do soldado

  /** A habilidade que o `Q` solta NESTE instante, para a forma que está nas mãos. */
  skillFor(tier: PrismSkillTier): PrismSkillPlan {return prismSkill(this.arsenal.mode,tier);}
  /** `true` enquanto qualquer habilidade está no ar (emissões ou janela de sobrecarga). */
  get skillActive(): boolean {return this.skills.active;}
  /** Nome na tela da habilidade no ar; `''` quando não há nenhuma. */
  get skillLabel(): string {return this.skills.label;}
  /** A mecânica da habilidade no ar; `undefined` quando não há nenhuma. Leitura da apresentação. */
  /** O ponto do cano AGORA — a apresentacao ancora a carga do feixe nele. */
  muzzlePoint(): Vector3 {return this.muzzle().clone();}

  get skillKind(): PrismSkillPlan['kind']|undefined {return this.skills.plan?.kind;}
  /** `true` enquanto a habilidade no ar ainda carrega — nada saiu do cano. */
  get skillCharging(): boolean {return this.skills.charging;}
  /** Fração 0..1 da carga já cumprida; `1` fora de uma carga. */
  get skillChargeProgress(): number {return this.skills.chargeProgress;}
  /**
   * O SEGMENTO do feixe de íons neste instante, ou `undefined`.
   *
   * Calculado na leitura (e não guardado) porque a mira muda por quadro: o feixe acompanha para
   * onde o jogador está olhando enquanto dura, como o feixe da cenoura acompanha o alvo dela.
   */
  get beamSegment(): {from: Vector3; to: Vector3}|undefined {
    const plan=this.skills.plan;
    if(!plan||plan.kind!=='beam'||this.skills.charging)return undefined;
    const tuning=this.tuning;
    const from=this.muzzle().clone();
    const direction=this.aim(from,tuning,false);
    const blocked=this.services.traceWorld(from,direction,tuning.range);
    return {from,to:blocked?blocked.point.clone():from.add(direction.scale(tuning.range))};
  }
  /** Os hostis marcados pela chuva de mísseis; vazio fora dela. A apresentação desenha o anel. */
  get markedTargets(): readonly TrainingTarget[] {
    if(this.skills.plan?.kind!=='strike')return [];
    return this.strikeTargets.filter((target): target is TrainingTarget => target!==undefined);
  }
  /** Segundos restantes da sobrecarga; `0` fora dela. */
  get overdriveRemaining(): number {return this.skills.remaining;}

  /**
   * `Q` nível II/III: solta a habilidade da FORMA em vigor.
   *
   * `false` quando ela não pode sair — e aí quem chamou devolve o MP, porque a barra é descontada
   * na SOLTURA do `Q` (ver `MPCharge.update`) e cobrar por uma habilidade que não aconteceu seria
   * roubar o jogador. As recusas são todas de estado real: arma fora das mãos, transformação em
   * curso, recarga em curso, outra habilidade no ar e — a que importa — munição insuficiente.
   *
   * A munição é retirada AQUI, de uma vez, do carregador da forma. É isso que torna a habilidade
   * cara em dois recursos ao mesmo tempo e impede que ela seja "dano de graça" numa arma vazia.
   */
  releaseSkill(tier: PrismSkillTier): boolean {
    if(!this.live||this.busy||this.magazine.reloading||this.skills.active)return false;
    const plan=this.skillFor(tier);
    if(this.magazine.ammo<plan.ammoRequired)return false;
    for(let i=0;i<plan.ammoCost;i++)if(!this.magazine.consume())return false;
    this.trigger.release();
    this.skills.start(plan);
    // A marcação acontece no ATO do pedido, não na primeira ogiva: é o que o anel em volta do alvo
    // mostra durante os 0,8 s de espera. Escolher na emissão deixaria a espera sem imagem nenhuma —
    // que é exatamente o defeito da sobrecarga que esta habilidade veio substituir.
    if(plan.kind==='strike')this.strikeTargets=this.selectStrikeTargets(this.muzzle(),plan);
    this.skillReleases++;
    return true;
  }

  fixedUpdate(dt: number, command: PrismCommand): void {
    this.magazine.update(dt);
    // O rig é quem diz quando a forma mudou; o backend só adota o resultado.
    if(this.transforming&&!this.rig.busy){this.transforming=false;this.arsenal.setMode(this.rig.mode);}
    this.grenades.update(dt);
    if(!this.live){
      this.rig.firing=false;
      // A transformação só anda porque o rig recebe `update` na APRESENTAÇÃO, e a apresentação só
      // roda com a arma viva. Guardar a arma no meio do clipe (habilidade de MP, punhos, morte)
      // deixaria `busy` preso para sempre — a arma travaria sem nunca terminar de se transformar.
      // Interromper CANCELA a troca: a forma continua sendo a que estava nas mãos.
      if(this.transforming){this.transforming=false;this.rig.setMode(this.arsenal.mode);}
      // Uma habilidade não sobrevive à arma sair das mãos: a munição já foi cobrada, mas o resto
      // das emissões seria disparado por um cano que não está mais lá.
      this.skills.cancel();
      this.trigger.release();
      return;
    }
    if(command.cycle)this.requestMode();
    if(command.reload)this.requestReload();
    // As emissões da habilidade rodam ANTES do gatilho comum e o travam neste passo: os dois canos
    // não cospem juntos, e a rajada não perde um tiro para a cadência normal.
    const emitting=this.skills.emitting;
    this.skills.update(dt,(plan,index)=>this.emitSkill(plan,index));
    // Carregador vazio recarrega sozinho, como a pistola já fazia — nunca no meio de uma habilidade.
    if(this.magazine.ammo===0&&!this.magazine.reloading&&!this.busy&&!this.skills.emitting)this.magazine.request();
    const tuning=this.tuning;
    // Sobrecarga: a MESMA arma, com a cadência multiplicada pela janela.
    const overdrive=this.skills.overdrive;
    const rate=tuning.rate*(overdrive?overdrive.rateScale:1);
    const firing=command.fire&&command.canAct&&!this.busy&&!this.magazine.reloading
      &&this.magazine.ammo>0&&!emitting&&!this.skills.emitting;
    this.rig.firing=command.canAct&&(firing||emitting||this.skills.emitting);
    this.trigger.update(dt,firing,rate,tuning.automatic,()=>this.shoot());
  }

  /**
   * Apresentação: pose do rig, clipe de recarga e projéteis desenhados.
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
    const visuals=this.visuals;
    if(!visuals)return;
    for(const grenade of this.grenades.live)
      visuals.moveCapsule(grenade.id,this.vector(grenade.position),this.vector(grenade.velocity),grenade.travelled*.9);
    visuals.update(dt);
  }

  /** Morte, pausa dura, viagem: solta o gatilho, apaga o que está no ar e restaura a pose. */
  cancel(): void {
    this.trigger.release();
    this.magazine.cancel();
    this.skills.cancel();
    for(const grenade of this.grenades.live)this.visuals?.removeCapsule(grenade.id);
    this.grenades.clear();
    this.visuals?.clear();
    this.endReloadClip();
  }
  /** Reinício de tentativa: forma 0, carregadores cheios, nada no ar. */
  resetAttempt(): void {
    this.cancel();
    this.arsenal.resetAttempt();
    this.trigger.reset();
    this.transforming=false;
    this.shots=0;this.blasts=0;this.skillReleases=0;
    this.rig.reset();
    this.equipped=this.ready;
  }
  dispose(): void {this.cancel();this.rig.enabled=false;}

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
   * A mira é a MESMA das pistolas: o olho da câmera escolhe o ponto visado, e o tiro sai do cano
   * em direção a ele. Sem isso a bala sairia paralela à visão e erraria por um palmo a três metros.
   */
  private shoot(): boolean {
    if(!this.magazine.consume())return false;
    const tuning=this.tuning;
    // A sobrecarga não emite tiro próprio: ela reescreve o tiro NORMAL enquanto a janela dura.
    const overdrive=this.skills.overdrive;
    const origin=this.muzzle().clone();
    const direction=this.aim(origin,tuning,true,overdrive?overdrive.spreadDegrees:undefined);
    this.shots++;
    this.rig.fire();
    this.camera.impulse(tuning.impulse*(overdrive?overdrive.impulseScale:1));
    if(this.arsenal.mode===2)this.launchCapsule(origin,direction);
    else this.hitscan(origin,direction,tuning,overdrive?this.skillProfile(overdrive):undefined);
    return true;
  }

  aiming=false;
  /**
   * `degreesOverride` existe para as habilidades: a rajada controlada e a sobrecarga são mira
   * PERFEITA por contrato, e a única maneira honesta de dizer isso é passar a abertura em vez de
   * herdar a da forma.
   */
  private aim(origin: Vector3, tuning: PrismModeTuning, spreadEnabled=true, degreesOverride?: number): Vector3 {
    const degrees=degreesOverride??(tuning.id==='prism_sniper'&&!this.aiming?8:tuning.spreadDegrees);
    const spread=spreadEnabled?Math.tan(degrees*Math.PI/180):0;
    const look=this.camera.forward.clone();
    if(spread>0){
      const right=Vector3.Cross(this.space.upAt(origin,this.scratchUp),look).normalize();
      const up=Vector3.Cross(look,right).normalize();
      look.addInPlace(right.scale(this.rng.range(-spread,spread))).addInPlace(up.scale(this.rng.range(-spread,spread)));
    }
    look.normalize();
    const eye=this.camera.camera.position;
    const aimed=nearestContact(this.services.sweep(eye,look,tuning.range));
    const point=aimed?aimed.point:eye.add(look.scale(tuning.range));
    return this.towards(origin,point,look);
  }

  /** Direção unitária de `origin` até `point`; `fallback` quando os dois coincidem. */
  private towards(origin: Vector3, point: Vector3, fallback: Vector3): Vector3 {
    const direction=point.subtract(origin);
    const length=direction.length();
    return length>1e-4?direction.scale(1/length):fallback;
  }

  /** O disparo comum de uma forma, como perfil. É o que `hitscan` recebe quando ninguém sobrescreve. */
  private shotProfile(tuning: PrismModeTuning): PrismShotProfile {
    return {
      damage:tuning.damage,pierce:tuning.pierce,attackId:tuning.pierce?'lance':'pulse',
      // `bullet` é o que dá direito a ponto fraco e a MP por acerto — é a arma básica do
      // exterminador, não uma habilidade, então ela alimenta a barra como a pistola alimenta.
      tags:['bullet'],procCoefficient:tuning.pierce?1:.6,force:tuning.force,
    };
  }

  /** O disparo de uma HABILIDADE. `skill` desliga o MP por acerto e faz o dano escalar por `stats.mp`. */
  private skillProfile(plan: PrismSkillPlan): PrismShotProfile {
    const tuning=PRISM_MODES[plan.mode];
    return {
      damage:prismSkillDamage(plan),
      pierce:plan.pierce,
      attackId:plan.id,
      tags:PRISM_SKILL_TAGS,
      procCoefficient:plan.pierce?1:.6,
      force:tuning.force*plan.forceScale,
    };
  }

  private hitscan(origin: Vector3, direction: Vector3, tuning: PrismModeTuning, override?: PrismShotProfile): void {
    const profile=override??this.shotProfile(tuning);
    const sweep=this.services.sweep(origin,direction,tuning.range);
    const actors=profile.pierce?sweep.actors:sweep.actors.slice(0,1);
    const force=this.camera.forward;
    for(const contact of actors){
      if(!contact.target)continue;
      this.services.applyHit(contact.target,{
        point:contact.point,force,ray:direction,damage:profile.damage,
        sourceId:tuning.id,attackId:profile.attackId,
        tags:profile.tags,procCoefficient:profile.procCoefficient,forceMagnitude:profile.force,
      });
      this.services.effects.impact(contact.point,direction.negate());
      this.visuals?.impact(this.arsenal.mode,contact.point,contact.normal);
    }
    // Cenário só leva dano quando NENHUM ator ficou na frente — `sweep.actors` já vem recortado
    // pela parede, então o teste é o mesmo que decide onde sai a marca de bala no tiro comum.
    const world=sweep.world;
    if(actors.length>0||world)this.rig.impact?.(this.mode);
    if(world&&(profile.pierce||actors.length===0)){
      if(!this.services.damageScenery(world.point,world.normal,direction,profile.damage,world.triangle))
        this.services.effects.mark(world.point,world.normal);
      this.services.effects.impact(world.point,world.normal);
      this.visuals?.impact(this.arsenal.mode,world.point,world.normal);
    }
    const stop=!profile.pierce&&actors[0]?actors[0].point
      :world?world.point
      :origin.add(direction.scale(tuning.range));
    this.services.effects.muzzle(origin);
    if(this.visuals?.ready)this.visuals.tracer(this.arsenal.mode,origin,stop);
    else if(profile.pierce)this.services.effects.piercer(origin,stop);
    else this.services.effects.tracer(origin,stop);
  }

  // ------------------------------------------------------------------ emissão das habilidades

  /**
   * UMA emissão de habilidade.
   *
   * Nada de física nova: `burst`/`volley` caem no mesmo `hitscan` do tiro comum (só com outro
   * perfil de dano) e `fan` cai no mesmo `launchCapsule`, com a carga da cápsula dizendo o que a
   * explosão vira. A munição já foi cobrada em `releaseSkill`, então aqui não se consome nada —
   * é por isso que a recarga automática fica travada enquanto há emissões pendentes.
   */
  private emitSkill(plan: PrismSkillPlan, index: number): void {
    const tuning=this.tuning;
    const origin=this.muzzle().clone();
    this.shots++;
    this.rig.fire();
    this.camera.impulse(tuning.impulse*plan.impulseScale);
    if(plan.kind==='fan'){this.launchCapsule(origin,this.fanDirection(origin,tuning,plan,index),this.payloadOf(plan));return;}
    if(plan.kind==='strike'){this.launchMissile(origin,tuning,plan,index);return;}
    const direction=plan.kind==='volley'
      ?this.volleyDirection(origin,tuning,plan,index)
      :this.aim(origin,tuning,plan.spreadDegrees>0,plan.spreadDegrees);
    this.hitscan(origin,direction,tuning,this.skillProfile(plan));
  }

  /**
   * Altura de onde o míssil cai, em metros acima do alvo marcado.
   *
   * Alto o bastante para ele aparecer vindo DE CIMA (e não brotar em cima da cabeça), e baixo o
   * bastante para a queda caber na janela da habilidade: a 34 m/s com 26 m/s² de gravidade, são
   * pouco mais de 0,7 s de voo.
   */
  private static readonly MISSILE_HEIGHT=34;

  /** Alvos marcados pela chuva de mísseis; reconstruídos na PRIMEIRA emissão, como a salva. */
  private strikeTargets: (TrainingTarget|undefined)[] = [];

  /**
   * UM míssil da chuva: cai na vertical LOCAL do alvo marcado `index`.
   *
   * Nenhuma física nova, de novo: o míssil é a MESMA cápsula da lança-granadas, só que largada de
   * cima em vez de arremessada para a frente. Ela herda balística, colisão, destruição e explosão
   * de graça — e a ogiva maior vem da carga, não de um caminho paralelo.
   *
   * "De cima" é `up` do ALVO, não `+Y` do mundo: no equador do planeta um míssil em `+Y` cairia
   * deitado. É a mesma correção que o leque já faz em `fanDirection`.
   *
   * Sem alvo marcado (horda acabou, ou o marcado morreu na espera) o míssil cai à frente da mira,
   * no alcance da forma — a habilidade já foi paga e não pode sumir sem efeito.
   */
  private launchMissile(origin: Vector3, tuning: PrismModeTuning, plan: PrismSkillPlan, index: number): void {
    // Os alvos já foram escolhidos em `releaseSkill` — é a mesma lista que o anel desenhou.
    const target=this.strikeTargets[index];
    const ground=target
      ?target.mesh.getBoundingInfo().boundingBox.centerWorld.clone()
      :origin.add(this.aim(origin,tuning,false).scale(Math.min(tuning.range,plan.markRadius)));
    const up=this.space.upAt(ground,this.scratchUp).clone();
    const from=ground.add(up.scale(PrismWeapon.MISSILE_HEIGHT));
    // Flash no alvo no instante em que o míssil parte: diz QUEM foi marcado, mesmo antes de a
    // ogiva chegar. O marcador persistente da fase de carga é trabalho da apresentação.
    this.services.effects.burst(ground,1.4,.25);
    this.launchCapsule(from,up.scale(-1),this.payloadOf(plan));
  }

  /** Os hostis marcados: os `plan.shots` mais próximos dentro de `plan.markRadius`. */
  private selectStrikeTargets(origin: Vector3, plan: PrismSkillPlan): (TrainingTarget|undefined)[] {
    const pool=new Map<number,TrainingTarget>();
    const candidates: {id:number; distance:number}[] = [];
    for(const target of this.services.combatTargets){
      if(!target.mesh.isPickable||!target.mesh.isEnabled())continue;
      const centre=target.mesh.getBoundingInfo().boundingBox.centerWorld;
      const distance=Vector3.Distance(origin,centre);
      if(!(distance>1e-3))continue;
      pool.set(target.id,target);
      candidates.push({id:target.id,distance});
    }
    return markStrikeTargets(candidates,plan.shots,plan.markRadius).map(id=>pool.get(id));
  }

  /**
   * Porta da cena para ACENDER O CHÃO: recebe o centro e o raio da explosão.
   *
   * Opcional de propósito — a arma não conhece a horda (é ela que tem os corpos para queimar), e o
   * teste roda sem cena. Sem a porta ligada a habilidade continua explodindo; só não pinta fogo.
   */
  onGroundFire: ((centre: Vector3, radius: number) => void) | undefined;

  /**
   * Porta da ONDA DE CHOQUE: toda explosão avisa centro e raio.
   *
   * A arma não conhece o jogador (ele não é um ), então quem mede a distância e
   * arremessa o corpo é a cena. Vale para granada, míssil e estilhaço — o salto de foguete não é
   * privilégio da habilidade.
   */
  onBlastWave: ((centre: Vector3, radius: number) => void) | undefined;

  /** Carga da cápsula de uma habilidade de leque ou da ogiva do míssil, com o teto de raio. */
  private payloadOf(plan: PrismSkillPlan): GrenadePayload {
    return {
      radiusScale:Math.min(PRISM_SKILL_BLAST_CAP,plan.blastRadiusScale),
      damageScale:plan.blastDamageScale,
      incendiary:plan.incendiary,
      groundFire:plan.groundFire,
      attackId:plan.id,
    };
  }

  /**
   * A direção da cápsula `index` de um leque: a mira, girada em torno da vertical LOCAL.
   *
   * Girar em torno de `up` (e não de `+Y` do mundo) é o que faz o leque abrir na horizontal do
   * JOGADOR em qualquer ponto da casca do planeta — no mundo plano a conta é a mesma de sempre.
   */
  private fanDirection(origin: Vector3, tuning: PrismModeTuning, plan: PrismSkillPlan, index: number): Vector3 {
    const base=this.aim(origin,tuning,false);
    const angle=(fanAngles(plan.shots,plan.fanDegrees)[index]??0)*Math.PI/180;
    if(Math.abs(angle)<1e-6)return base;
    const up=this.space.upAt(origin,this.scratchUp);
    const right=Vector3.Cross(up,base);
    if(right.lengthSquared()<1e-8)return base;
    right.normalize();
    return base.scale(Math.cos(angle)).addInPlace(right.scale(Math.sin(angle))).normalize();
  }

  /**
   * A direção do feixe `index` de uma salva multi-alvo.
   *
   * Cada feixe procura um corpo DIFERENTE, escolhido por proximidade angular da mira e com LINHA DE
   * VISÃO real (a mesma varredura que barra a bala). Quando a salva tem mais feixes do que corpos
   * visíveis, os que sobram vão **para a frente** — é o recuo pedido: a habilidade nunca é
   * desperdiçada por falta de alvo, e nunca acerta duas vezes o mesmo bicho de graça.
   */
  private volleyDirection(origin: Vector3, tuning: PrismModeTuning, plan: PrismSkillPlan, index: number): Vector3 {
    if(index===0)this.volleyTargets=this.selectVolleyTargets(origin,tuning,plan.shots);
    const target=this.volleyTargets[index];
    const forward=this.aim(origin,tuning,false);
    if(!target)return forward;
    const centre=target.mesh.getBoundingInfo().boundingBox.centerWorld;
    return this.towards(origin,centre,forward);
  }

  /** Corpos escolhidos pela salva do quadro; reconstruída a cada disparo (índice 0). */
  private volleyTargets: (TrainingTarget|undefined)[] = [];

  private selectVolleyTargets(origin: Vector3, tuning: PrismModeTuning, limit: number): (TrainingTarget|undefined)[] {
    const look=this.camera.forward;
    const ranked: {target: TrainingTarget; score: number}[] = [];
    for(const target of this.services.combatTargets){
      if(!target.mesh.isPickable||!target.mesh.isEnabled())continue;
      const centre=target.mesh.getBoundingInfo().boundingBox.centerWorld;
      const offset=centre.subtract(origin);
      const distance=offset.length();
      if(!(distance>1e-3)||distance>tuning.range)continue;
      const direction=offset.scale(1/distance);
      // Só o que está à FRENTE, e só o que a colisão não esconde. A folga de 30 cm evita que o
      // próprio corpo do alvo (ou o chão sob ele) conte como cobertura.
      if(Vector3.Dot(direction,look)<=0)continue;
      if(distance>.45&&this.services.traceWorld(origin,direction,distance-.3))continue;
      // Quanto mais perto da mira, antes é atendido; a distância desempata.
      ranked.push({target,score:(1-Vector3.Dot(direction,look))*1000+distance});
    }
    ranked.sort((a,b)=>a.score-b.score);
    return Array.from({length:limit},(_,i)=>ranked[i]?.target);
  }

  // ------------------------------------------------------------------ prévia da mira

  /**
   * Onde a próxima cápsula cairia, sem disparar nada.
   *
   * Sai do MESMO cano (`muzzle()`) e da MESMA mira (`aim()`) do disparo de verdade, e integra no
   * MESMO mundo com a MESMA física (`predictGrenadeFlight` → `stepGrenade`). Por isso não existe
   * "marcador a uma distância fixa" aqui: o arco é o voo, ponto a ponto.
   *
   * O que ela deliberadamente NÃO faz:
   *
   * - não sorteia a abertura do tiro (`spreadEnabled=false`). Consumir o `RandomStream` numa prévia
   *   por quadro deslocaria TODO o resto da corrida que bebe da mesma fonte, e a linha ficaria
   *   tremendo sozinha na tela;
   * - não consome munição, não toca no gatilho, não emite dano, não pede áudio e não sacode a
   *   câmera. As únicas leituras do mundo são varreduras de colisão, que já são consultas puras.
   *
   * `undefined` quando a forma em vigor não é o lança-granadas — as outras não têm arco a mostrar.
   */
  previewGrenade(options?: TrajectoryOptions): GrenadePrediction | undefined {
    if(this.arsenal.mode!==2)return undefined;
    const origin=this.muzzle().clone();
    const direction=this.aim(origin,PRISM_MODES[2],false);
    return predictGrenadeFlight(
      this.grenadeWorld,
      {x:origin.x,y:origin.y,z:origin.z},
      {x:direction.x,y:direction.y,z:direction.z},
      options??{},
    );
  }

  private launchCapsule(origin: Vector3, direction: Vector3, payload?: GrenadePayload): void {
    const grenade=this.grenades.launch(
      {x:origin.x,y:origin.y,z:origin.z},{x:direction.x,y:direction.y,z:direction.z},
      PRISM_GRENADE.speed,payload,
    );
    this.services.effects.muzzle(origin);
    this.visuals?.spawnCapsule(grenade.id,origin,direction);
  }

  // ------------------------------------------------------------------ explosão

  private vector(v: Vec3): Vector3 {return new Vector3(v.x,v.y,v.z);}

  /** Contato da cápsula com mundo ou corpo, pela mesma varredura do tiro. */
  private segment(from: Vec3, to: Vec3, radius: number): GrenadeContact | undefined {
    const origin=this.vector(from);
    const delta=this.vector(to).subtractInPlace(origin);
    const length=delta.length();
    if(!(length>1e-6))return undefined;
    const direction=delta.scale(1/length);
    const contact=nearestContact(this.services.sweep(origin,direction,length,radius));
    if(!contact)return undefined;
    return {
      point:{x:contact.point.x,y:contact.point.y,z:contact.point.z},
      normal:{x:contact.normal.x,y:contact.normal.y,z:contact.normal.z},
      targetId:contact.target?.id,
      triangle:contact.triangle,
    };
  }

  /**
   * A explosão.
   *
   * Área LIMITADA e sem dano atrás de parede: cada corpo dentro do raio ainda precisa de LINHA DE
   * VISÃO real até o centro da explosão (`traceWorld`), medida na mesma colisão que barra a bala.
   * Um inimigo do outro lado de uma caixa entra no raio e sai sem levar nada — que é o pedido.
   *
   * O contato direto soma o dano do modo por cima do dano de área e é o ÚNICO que entra como
   * `bullet`: só ele tem um par `(ponto, direção)` de projétil de verdade, que é o que o teste de
   * ponto fraco exige. O estilhaço entra como `explosive`, então não vira crítico por aproximação
   * nem realimenta a barra de MP em cadeia — a arma continua pagando MP por acerto direto.
   */
  private detonate(grenade: Grenade, at: Vec3, normal: Vec3, contact: GrenadeContact | undefined): void {
    this.blasts++;
    this.visuals?.removeCapsule(grenade.id);
    const centre=this.vector(at);
    const up=this.space.upAt(centre,this.scratchUp).clone();
    const travel=this.vector(grenade.velocity);
    const speed=travel.length();
    const heading=speed>1e-4?travel.scale(1/speed):up.scale(-1);
    const tuning=PRISM_MODES[2];
    // Cápsula de HABILIDADE: mesma balística, explosão com outros números e — na salva incendiária —
    // a etiqueta que acende o alvo. Sem carga, tudo cai nos números comuns de `PRISM_GRENADE`.
    const payload=grenade.payload;
    const radius=PRISM_GRENADE.blastRadius*Math.min(PRISM_SKILL_BLAST_CAP,payload?.radiusScale??1);
    const damageScale=payload?.damageScale??1;
    const directTags=payload
      ?(payload.incendiary?[...PRISM_SKILL_TAGS,INCENDIARY_TAG]:PRISM_SKILL_TAGS)
      :['bullet'];
    const blastTags=payload
      ?(payload.incendiary?[...PRISM_SKILL_BLAST_TAGS,INCENDIARY_TAG]:PRISM_SKILL_BLAST_TAGS)
      :['explosive'];
    if(contact?.targetId!==undefined){
      const direct=this.services.combatTargets.find(target=>target.id===contact.targetId);
      if(direct)this.services.applyHit(direct,{
        point:centre,force:heading,ray:heading,damage:tuning.damage*damageScale,
        sourceId:tuning.id,attackId:payload?.attackId??'capsule',tags:directTags,
        procCoefficient:1,forceMagnitude:tuning.force,
      });
    }
    // A onda parte de 25 cm À FRENTE da superfície em que a cápsula bateu, na normal do contato.
    // O centro do dano continua sendo o ponto de contato (é dali que a distância é medida); o que
    // muda é a ORIGEM do raio de visão. Sem esse recuo o raio nasceria EM CIMA da parede e a
    // própria parede em que a granada explodiu deixaria de bloquear quem está do outro lado dela.
    // A explosão acende o CHÃO onde bateu, quando a carga pede. Porta opcional: sem cena ligada
    // (testes, servidor) a habilidade continua funcionando e só não pinta fogo.
    if(payload?.groundFire)this.onGroundFire?.(centre.clone(),radius);
    this.onBlastWave?.(centre.clone(),radius);
    const eye=contact?centre.add(this.vector(normal).scale(.25)):centre;
    for(const target of this.services.combatTargets){
      if(!target.mesh.isPickable||!target.mesh.isEnabled())continue;
      const point=target.mesh.getBoundingInfo().boundingBox.centerWorld;
      const offset=point.subtract(centre);
      const distance=offset.length();
      const falloff=blastFalloff(distance,radius);
      if(falloff<=0)continue;
      const direction=distance>1e-4?offset.scale(1/distance):up.clone();
      // Linha de visão REAL, na MESMA colisão que barra a bala. A folga de 30 cm no fim evita que
      // o chão sob os pés do alvo conte como cobertura. Vale também para a salva: "explosão maior"
      // aumenta o RAIO, nunca o direito de atravessar parede.
      if(distance>.45&&this.services.traceWorld(eye,direction,distance-.3))continue;
      this.services.applyHit(target,{
        point,force:direction,ray:direction,damage:PRISM_GRENADE.blastDamage*damageScale*falloff,
        sourceId:tuning.id,attackId:payload?`${payload.attackId}_blast`:'blast',tags:blastTags,
        procCoefficient:.5,forceMagnitude:PRISM_GRENADE.blastForce*falloff,
      });
    }
    // O cenário leva a explosão pela MESMA porta de destruição do tiro e do soco.
    this.services.damageScenery(centre,this.vector(normal),heading,PRISM_GRENADE.sceneryDamage*damageScale,contact?.triangle);
    if(this.visuals?.ready)this.visuals.explosion(centre,up,radius);
    else {this.services.effects.impact(centre,this.vector(normal));this.services.effects.burst(centre,.9,.28);}
    const audience=Vector3.Distance(this.camera.camera.position,centre);
    if(audience<60)this.rig.impact?.(2);
    if(audience<24)this.camera.impulse(.05*(1-audience/24));
  }
}

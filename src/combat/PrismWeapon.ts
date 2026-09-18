import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Vec3} from '../core/contracts';
import {nearestContact,type CombatServices} from './CombatServices';
import {WORLD_SPACE,type CombatCamera,type CombatSpace} from './DualPistols';
import {PrismArsenal,type PrismMagazine} from './PrismArsenal';
import {PrismTrigger} from './PrismTrigger';
import {PrismGrenades,blastFalloff,type Grenade,type GrenadeContact} from './PrismGrenades';
import {PRISM_GRENADE,PRISM_MODES,type PrismMode,type PrismModeTuning} from './PrismTuning';

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
  /** `T` — avança uma forma no ciclo autoral. */
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
  constructor(ports: PrismWeaponPorts) {
    this.services=ports.services;this.rig=ports.rig;this.camera=ports.camera;this.rng=ports.rng;
    this.bodyAt=ports.body;this.visuals=ports.visuals;this.space=ports.space??WORLD_SPACE;
    this.grenades=new PrismGrenades({
      up:point=>{const up=this.space.upAt(this.vector(point),this.scratchUp);return {x:up.x,y:up.y,z:up.z};},
      segment:(from,to,radius)=>this.segment(from,to,radius),
    },(grenade,at,normal,contact)=>this.detonate(grenade,at,normal,contact));
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
    return this.magazine.request();
  }

  fixedUpdate(dt: number, command: PrismCommand): void {
    this.magazine.update(dt);
    // O rig é quem diz quando a forma mudou; o backend só adota o resultado.
    if(this.transforming&&!this.rig.busy){this.transforming=false;this.arsenal.setMode(this.rig.mode);}
    this.grenades.update(dt);
    if(!this.live){
      // A transformação só anda porque o rig recebe `update` na APRESENTAÇÃO, e a apresentação só
      // roda com a arma viva. Guardar a arma no meio do clipe (habilidade de MP, punhos, morte)
      // deixaria `busy` preso para sempre — a arma travaria sem nunca terminar de se transformar.
      // Interromper CANCELA a troca: a forma continua sendo a que estava nas mãos.
      if(this.transforming){this.transforming=false;this.rig.setMode(this.arsenal.mode);}
      this.trigger.release();
      return;
    }
    if(command.cycle)this.requestMode();
    if(command.reload)this.requestReload();
    // Carregador vazio recarrega sozinho, como a pistola já fazia.
    if(this.magazine.ammo===0&&!this.magazine.reloading&&!this.busy)this.magazine.request();
    const tuning=this.tuning;
    const firing=command.fire&&command.canAct&&!this.busy&&!this.magazine.reloading&&this.magazine.ammo>0;
    this.trigger.update(dt,firing,tuning.rate,tuning.automatic,()=>this.shoot());
  }

  /**
   * Apresentação: pose do rig, clipe de recarga e projéteis desenhados.
   * Roda no relógio de quadro, nunca no passo fixo — é aqui que a arma existe visualmente.
   */
  updatePresentation(dt: number): void {
    const live=this.live;
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
    this.shots=0;this.blasts=0;
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
    const origin=this.muzzle().clone();
    const direction=this.aim(origin,tuning);
    this.shots++;
    this.rig.fire();
    this.camera.impulse(tuning.impulse);
    if(this.arsenal.mode===2)this.launchCapsule(origin,direction);
    else this.hitscan(origin,direction,tuning);
    return true;
  }

  private aim(origin: Vector3, tuning: PrismModeTuning): Vector3 {
    const spread=tuning.spreadDegrees*Math.PI/180;
    const look=this.camera.forward.clone();
    if(spread>0){look.x+=this.rng.range(-spread,spread);look.y+=this.rng.range(-spread,spread);}
    look.normalize();
    const eye=this.camera.camera.position;
    const aimed=nearestContact(this.services.sweep(eye,look,tuning.range));
    const point=aimed?aimed.point:eye.add(look.scale(tuning.range));
    const direction=point.subtract(origin);
    const length=direction.length();
    return length>1e-4?direction.scale(1/length):look;
  }

  private hitscan(origin: Vector3, direction: Vector3, tuning: PrismModeTuning): void {
    const sweep=this.services.sweep(origin,direction,tuning.range);
    const actors=tuning.pierce?sweep.actors:sweep.actors.slice(0,1);
    const force=this.camera.forward;
    for(const contact of actors){
      if(!contact.target)continue;
      this.services.applyHit(contact.target,{
        point:contact.point,force,ray:direction,damage:tuning.damage,
        sourceId:tuning.id,attackId:tuning.pierce?'lance':'pulse',
        // `bullet` é o que dá direito a ponto fraco e a MP por acerto — é a arma básica do
        // exterminador, não uma habilidade, então ela alimenta a barra como a pistola alimenta.
        tags:['bullet'],procCoefficient:tuning.pierce?1:.6,forceMagnitude:tuning.force,
      });
      this.services.effects.impact(contact.point,direction.negate());
      this.visuals?.impact(this.arsenal.mode,contact.point,contact.normal);
    }
    // Cenário só leva dano quando NENHUM ator ficou na frente — `sweep.actors` já vem recortado
    // pela parede, então o teste é o mesmo que decide onde sai a marca de bala no tiro comum.
    const world=sweep.world;
    if(actors.length>0||world)this.rig.impact?.(this.mode);
    if(world&&(tuning.pierce||actors.length===0)){
      if(!this.services.damageScenery(world.point,world.normal,direction,tuning.damage,world.triangle))
        this.services.effects.mark(world.point,world.normal);
      this.services.effects.impact(world.point,world.normal);
      this.visuals?.impact(this.arsenal.mode,world.point,world.normal);
    }
    const stop=!tuning.pierce&&actors[0]?actors[0].point
      :world?world.point
      :origin.add(direction.scale(tuning.range));
    this.services.effects.muzzle(origin);
    if(this.visuals?.ready)this.visuals.tracer(this.arsenal.mode,origin,stop);
    else if(tuning.pierce)this.services.effects.piercer(origin,stop);
    else this.services.effects.tracer(origin,stop);
  }

  private launchCapsule(origin: Vector3, direction: Vector3): void {
    const grenade=this.grenades.launch({x:origin.x,y:origin.y,z:origin.z},{x:direction.x,y:direction.y,z:direction.z});
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
    if(contact?.targetId!==undefined){
      const direct=this.services.combatTargets.find(target=>target.id===contact.targetId);
      if(direct)this.services.applyHit(direct,{
        point:centre,force:heading,ray:heading,damage:tuning.damage,
        sourceId:tuning.id,attackId:'capsule',tags:['bullet'],procCoefficient:1,forceMagnitude:tuning.force,
      });
    }
    // A onda parte de 25 cm À FRENTE da superfície em que a cápsula bateu, na normal do contato.
    // O centro do dano continua sendo o ponto de contato (é dali que a distância é medida); o que
    // muda é a ORIGEM do raio de visão. Sem esse recuo o raio nasceria EM CIMA da parede e a
    // própria parede em que a granada explodiu deixaria de bloquear quem está do outro lado dela.
    const eye=contact?centre.add(this.vector(normal).scale(.25)):centre;
    for(const target of this.services.combatTargets){
      if(!target.mesh.isPickable||!target.mesh.isEnabled())continue;
      const point=target.mesh.getBoundingInfo().boundingBox.centerWorld;
      const offset=point.subtract(centre);
      const distance=offset.length();
      const falloff=blastFalloff(distance,PRISM_GRENADE.blastRadius);
      if(falloff<=0)continue;
      const direction=distance>1e-4?offset.scale(1/distance):up.clone();
      // Linha de visão REAL, na MESMA colisão que barra a bala. A folga de 30 cm no fim evita que
      // o chão sob os pés do alvo conte como cobertura.
      if(distance>.45&&this.services.traceWorld(eye,direction,distance-.3))continue;
      this.services.applyHit(target,{
        point,force:direction,ray:direction,damage:PRISM_GRENADE.blastDamage*falloff,
        sourceId:tuning.id,attackId:'blast',tags:['explosive'],procCoefficient:.5,
        forceMagnitude:PRISM_GRENADE.blastForce*falloff,
      });
    }
    // O cenário leva a explosão pela MESMA porta de destruição do tiro e do soco.
    this.services.damageScenery(centre,this.vector(normal),heading,PRISM_GRENADE.sceneryDamage,contact?.triangle);
    if(this.visuals?.ready)this.visuals.explosion(centre,up,PRISM_GRENADE.blastRadius);
    else {this.services.effects.impact(centre,this.vector(normal));this.services.effects.burst(centre,.9,.28);}
    const audience=Vector3.Distance(this.camera.camera.position,centre);
    if(audience<60)this.rig.impact?.(2);
    if(audience<24)this.camera.impulse(.05*(1-audience/24));
  }
}

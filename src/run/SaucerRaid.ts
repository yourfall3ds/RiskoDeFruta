import type {Vec3} from '../core/contracts';

/**
 * Represália dos discos voadores.
 *
 * Os discos que cruzam o céu do mapa são decorativos até levarem um tiro. **Um tiro basta**: a nave
 * fica hostil, abandona a órbita, vem até o jogador e, ao entrar na área dele, faz o oposto de uma
 * abdução — abre um feixe e **deposita** um monstro por ele, de cima para baixo, à vista. Depois vai
 * embora. Atirar de novo na mesma nave escala a resposta: a segunda investida e as seguintes
 * despejam dez do mesmo monstro, um a um, em sequência rápida.
 *
 * **Lógica pura.** Nada aqui conhece Babylon, malha, áudio ou o enxame: a classe só decide onde a
 * nave está, quando o feixe acende e em que instante cada monstro toca o chão. `AbductionBeam`
 * desenha, `PlayerScene` liga o som e pede o spawn ao `EnemySwarm`.
 */

/** Monstros despejados na primeira investida. */
export const RAID_FIRST_DROP=1;
/** Monstros despejados da segunda investida em diante. */
export const RAID_SWARM_DROP=10;
/** Velocidade de cruzeiro da nave hostil, em m/s. */
export const RAID_SPEED=21;
/** Altura do voo pairado sobre o jogador, em metros acima do solo dele. */
export const RAID_HOVER_HEIGHT=13.5;
/** Raio horizontal que conta como "entrou na área do jogador", em metros. */
export const RAID_ARRIVAL_RADIUS=3.5;
/** Descida de um monstro pelo feixe, em segundos. */
export const RAID_BEAM_SECONDS=1.3;
/** Intervalo entre dois despejos da mesma investida. Curto de propósito: é para assustar. */
export const RAID_SWARM_GAP=.42;
/** Subida de saída antes de a nave voltar à órbita. */
export const RAID_DEPART_SECONDS=2.6;
/** Deslocamento lateral do ponto de pouso a cada despejo, para os dez não empilharem no mesmo ponto. */
export const RAID_SCATTER=2.6;

export type RaidPhase='patrol'|'approach'|'hover'|'beam'|'depart';

const distance2D=(a:Vec3,b:Vec3):number=>Math.hypot(a.x-b.x,a.z-b.z);

export class SaucerRaid {
  phase:RaidPhase='patrol';
  clock=0;
  /** Quantos monstros ainda faltam despejar nesta investida. */
  pending=0;
  /** Quantas investidas o jogador já provocou nesta nave. */
  provocations=0;
  /** 0..1 da descida do monstro atual pelo feixe. 0 com o feixe apagado. */
  beam=0;
  /** Ponto onde o monstro atual vai tocar o chão. */
  readonly landing={x:0,y:0,z:0};
  /** Posição da nave enquanto a investida manda nela; em `patrol` quem manda é a órbita decorativa. */
  readonly position={x:0,y:0,z:0};
  /** Índice do despejo atual dentro da investida, para espalhar os pontos de pouso. */
  private delivered=0;

  /** A investida controla a nave agora: a órbita decorativa deve ceder o lugar. */
  get commanding():boolean {return this.phase!=='patrol';}
  /** O feixe está aceso e um corpo desce por ele. */
  get beaming():boolean {return this.phase==='beam';}

  /**
   * Um tiro na nave. Devolve quantos monstros esta investida vai despejar, ou 0 se ela já está
   * ocupada — levar mais tiros no meio da descida não empilha investidas.
   */
  provoke(from:Vec3):number {
    if(this.phase!=='patrol')return 0;
    this.provocations++;
    this.pending=this.provocations===1?RAID_FIRST_DROP:RAID_SWARM_DROP;
    this.delivered=0;this.clock=0;this.beam=0;
    this.position.x=from.x;this.position.y=from.y;this.position.z=from.z;
    this.phase='approach';
    return this.pending;
  }

  /** Volta ao repouso: nova tentativa, troca de estágio ou descarte da cena. */
  reset():void {
    this.phase='patrol';this.clock=0;this.pending=0;this.provocations=0;this.beam=0;this.delivered=0;
  }

  /**
   * Avança a investida.
   *
   * `ground` resolve a altura do chão sob um ponto; é por ela que o monstro pousa no piso real em
   * vez de uma altura chutada. `onDeliver` é chamado UMA vez por monstro, no quadro em que ele
   * toca o chão.
   */
  update(dt:number,player:Vec3,ground:(x:number,z:number)=>number,onDeliver:(at:Vec3,index:number,total:number)=>void):void {
    if(!Number.isFinite(dt)||dt<=0||this.phase==='patrol')return;
    this.clock+=dt;
    const hover={x:player.x,y:player.y+RAID_HOVER_HEIGHT,z:player.z};

    if(this.phase==='approach'){
      this.flyTo(hover,dt);
      if(distance2D(this.position,hover)<=RAID_ARRIVAL_RADIUS){this.phase='hover';this.clock=0;}
      return;
    }
    if(this.phase==='hover'){
      // Acompanha o jogador de cima enquanto se estabiliza; meio segundo de ameaça antes do feixe.
      this.flyTo(hover,dt);
      if(this.clock>=.5){this.phase='beam';this.clock=0;this.beam=0;this.aimLanding(player,ground);}
      return;
    }
    if(this.phase==='beam'){
      this.flyTo(hover,dt*.35);
      this.beam=Math.min(1,this.clock/RAID_BEAM_SECONDS);
      if(this.beam<1)return;
      onDeliver({...this.landing},this.delivered,this.delivered+this.pending);
      this.delivered++;this.pending--;
      this.beam=0;this.clock=0;
      if(this.pending<=0){this.phase='depart';return;}
      this.phase='hover';
      // Entre um despejo e outro a nave só espera o intervalo curto, sem reacender o feixe.
      this.clock=.5-RAID_SWARM_GAP;
      return;
    }
    // Saída: sobe e apaga. Passado o tempo, a órbita decorativa retoma o controle.
    this.position.y+=RAID_SPEED*.8*dt;
    this.beam=0;
    if(this.clock>=RAID_DEPART_SECONDS){this.phase='patrol';this.clock=0;}
  }

  /** Movimento com velocidade constante, sem ultrapassar o destino no quadro. */
  private flyTo(target:Vec3,dt:number):void {
    const dx=target.x-this.position.x,dy=target.y-this.position.y,dz=target.z-this.position.z;
    const length=Math.hypot(dx,dy,dz);
    if(length<1e-4)return;
    const step=Math.min(length,RAID_SPEED*dt);
    this.position.x+=dx/length*step;this.position.y+=dy/length*step;this.position.z+=dz/length*step;
  }

  /**
   * Onde o próximo monstro toca o chão.
   *
   * Os dez de uma investida caem em volta do jogador, não no mesmo ponto: o ângulo gira a cada
   * despejo e o raio cresce devagar. A altura vem do piso real; sem piso válido, cai no nível do
   * próprio jogador, que é o chão em que ele está pisando.
   */
  private aimLanding(player:Vec3,ground:(x:number,z:number)=>number):void {
    const angle=this.delivered*2.399963,radius=this.delivered===0?0:RAID_SCATTER*Math.sqrt(this.delivered/RAID_SWARM_DROP)+1.2;
    const x=player.x+Math.sin(angle)*radius,z=player.z+Math.cos(angle)*radius;
    const y=ground(x,z);
    this.landing.x=x;this.landing.z=z;this.landing.y=Number.isFinite(y)?y:player.y;
  }
}

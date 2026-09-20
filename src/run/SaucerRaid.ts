import type {Vec3} from '../core/contracts';

/**
 * Represália dos discos voadores.
 *
 * Os discos que cruzam o céu são cenário até levarem um tiro. **Um tiro basta.** A partir daí o
 * evento tem um roteiro fixo:
 *
 * ```
 * PATRULHA ─tiro→ PRIMEIRA_CHEGADA → DEPOSITANDO_ET → LUTA_ET ─morte do E.T.→ RETORNANDO
 *                                                                                  ↓
 *                        CONCLUIDO ← ONDA_ATIVA ← DEPOSITANDO_ONDA ← SEGUNDA_CHEGADA
 * ```
 *
 * A segunda vinda **não** depende de novo tiro nem de temporizador: quem a dispara é o evento de
 * morte do E.T. (`etDefeated()`). Estado explícito, sem sopa de booleanos.
 *
 * **Lógica pura.** Nada aqui conhece Babylon, malha, áudio ou o enxame: a classe decide onde a nave
 * está, quando o feixe acende e em que instante cada corpo toca o chão. `AbductionBeam` desenha e
 * `PlayerScene` liga som e spawn.
 */

/** Corpos despejados na primeira visita: um E.T. clássico, sozinho. */
export const RAID_FIRST_DROP=1;
/** Corpos despejados na segunda visita: dois de cada uma das cinco espécies. */
export const RAID_SWARM_DROP=10;
/** Velocidade de cruzeiro da nave hostil, em m/s. */
export const RAID_SPEED=21;
/** Altura do voo pairado sobre o jogador, em metros acima do solo dele. */
export const RAID_HOVER_HEIGHT=13.5;
/** Raio horizontal que conta como "entrou na área do jogador", em metros. */
export const RAID_ARRIVAL_RADIUS=3.5;
/** Descida de um corpo pelo feixe, em segundos. */
export const RAID_BEAM_SECONDS=1.3;
/** Intervalo entre dois despejos da onda. Curto de propósito: é para assustar. */
export const RAID_SWARM_GAP=.42;
/** Subida de saída antes de a nave sumir. */
export const RAID_DEPART_SECONDS=2.6;
/** Espera entre a morte do E.T. e a nave reaparecer no céu. */
export const RAID_RETURN_DELAY=2.2;
/** Raio do espalhamento dos dez em volta do jogador, em metros. */
export const RAID_SCATTER=5.5;

export type RaidPhase=
  |'patrulha'
  |'primeira-chegada'
  |'depositando-et'
  |'luta-et'
  |'retornando'
  |'segunda-chegada'
  |'depositando-onda'
  |'onda-ativa'
  |'concluido';

const distance2D=(a:Vec3,b:Vec3):number=>Math.hypot(a.x-b.x,a.z-b.z);
/** Fases em que a investida manda no voo da nave; fora delas a órbita decorativa retoma. */
const FLYING:readonly RaidPhase[]=['primeira-chegada','depositando-et','retornando','segunda-chegada','depositando-onda'];

export class SaucerRaid {
  phase:RaidPhase='patrulha';
  clock=0;
  /** Quantos corpos ainda faltam despejar na visita atual. */
  pending=0;
  /** 0..1 da descida do corpo atual pelo feixe. 0 com o feixe apagado. */
  beam=0;
  /** Ponto onde o corpo atual toca o chão. */
  readonly landing={x:0,y:0,z:0};
  /** Posição da nave enquanto a investida manda nela. */
  readonly position={x:0,y:0,z:0};
  /** Índice do despejo atual dentro da visita, para espalhar os pontos de pouso. */
  private delivered=0;

  get commanding():boolean {return FLYING.includes(this.phase);}
  get beaming():boolean {return this.phase==='depositando-et'||this.phase==='depositando-onda';}
  /** O evento já começou e ainda não terminou. */
  get engaged():boolean {return this.phase!=='patrulha'&&this.phase!=='concluido';}

  /**
   * Um tiro na nave. Só a primeira visita nasce de tiro; devolve quantos corpos ela vai deixar, ou
   * 0 se o evento já está em andamento ou já foi concluído.
   */
  provoke(from:Vec3):number {
    if(this.phase!=='patrulha')return 0;
    this.pending=RAID_FIRST_DROP;this.delivered=0;this.clock=0;this.beam=0;
    this.position.x=from.x;this.position.y=from.y;this.position.z=from.z;
    this.phase='primeira-chegada';
    return this.pending;
  }

  /**
   * O E.T. da primeira visita morreu. **É isto que chama o disco de volta**, sem tiro e sem
   * temporizador. Devolve quantos corpos a segunda visita vai despejar, ou 0 se não era a hora.
   */
  etDefeated():number {
    if(this.phase!=='luta-et')return 0;
    this.phase='retornando';this.clock=0;this.delivered=0;this.pending=RAID_SWARM_DROP;
    return this.pending;
  }

  /** A onda de dez foi limpa. Encerra o evento desta nave. */
  waveCleared():void {
    if(this.phase==='onda-ativa')this.phase='concluido';
  }

  /**
   * Todos os corpos desta investida desistiram e sumiram porque o jogador fugiu longe demais.
   *
   * **Não é vitória**: a nave volta à patrulha em vez de ir para `concluido`, então quem quiser o
   * item tem de enfrentar o evento de novo — atirando de novo, do zero. Sem isto o roteiro ficaria
   * preso em `luta-et` ou `onda-ativa` para sempre, esperando uma morte que nunca vem, e aquele
   * disco jamais voltaria a ser provocável.
   */
  abandoned():void {
    if(this.phase==='luta-et'||this.phase==='onda-ativa')this.reset();
  }

  /** Volta ao repouso: nova tentativa, troca de estágio ou descarte da cena. */
  reset():void {
    this.phase='patrulha';this.clock=0;this.pending=0;this.beam=0;this.delivered=0;
  }

  /**
   * Avança o evento.
   *
   * `ground` resolve a altura do chão sob um ponto, para o corpo pousar no piso real. `onDeliver` é
   * chamado UMA vez por corpo, no quadro em que ele toca o chão, com o índice dentro da visita.
   */
  update(dt:number,player:Vec3,ground:(x:number,z:number)=>number,onDeliver:(at:Vec3,index:number,total:number,wave:boolean)=>void):void {
    if(!Number.isFinite(dt)||dt<=0)return;
    if(this.phase==='patrulha'||this.phase==='concluido'||this.phase==='luta-et'||this.phase==='onda-ativa'){
      // Nestas fases a nave não está em cena; quem conduz é o combate.
      this.beam=0;
      return;
    }
    this.clock+=dt;
    const hover={x:player.x,y:player.y+RAID_HOVER_HEIGHT,z:player.z};
    const wave=this.pending>RAID_FIRST_DROP||this.phase==='segunda-chegada'||this.phase==='depositando-onda';

    if(this.phase==='primeira-chegada'||this.phase==='segunda-chegada'){
      this.flyTo(hover,dt);
      if(distance2D(this.position,hover)<=RAID_ARRIVAL_RADIUS){
        this.phase=this.phase==='primeira-chegada'?'depositando-et':'depositando-onda';
        this.clock=0;this.beam=0;this.aimLanding(player,ground);
      }
      return;
    }
    if(this.phase==='retornando'){
      // Sobe, some e volta sozinha depois do intervalo curto: a nave "vai buscar reforço".
      this.position.y+=RAID_SPEED*.7*dt;
      if(this.clock>=RAID_RETURN_DELAY){
        this.phase='segunda-chegada';this.clock=0;
        this.position.x=player.x-40;this.position.y=player.y+48;this.position.z=player.z-40;
      }
      return;
    }
    // Depositando: o feixe desce um corpo por vez.
    this.flyTo(hover,dt*.35);
    this.beam=Math.min(1,this.clock/RAID_BEAM_SECONDS);
    if(this.beam<1)return;
    onDeliver({...this.landing},this.delivered,this.delivered+this.pending,wave);
    this.delivered++;this.pending--;
    this.beam=0;this.clock=0;
    if(this.pending>0){this.aimLanding(player,ground);this.clock=-RAID_SWARM_GAP;return;}
    // Visita cumprida: a primeira entrega o E.T. e sai; a segunda deixa a onda e encerra.
    this.phase=this.phase==='depositando-et'?'luta-et':'onda-ativa';
    this.clock=0;
  }

  private flyTo(target:Vec3,dt:number):void {
    const dx=target.x-this.position.x,dy=target.y-this.position.y,dz=target.z-this.position.z;
    const length=Math.hypot(dx,dy,dz);
    if(length<1e-4||dt<=0)return;
    const step=Math.min(length,RAID_SPEED*dt);
    this.position.x+=dx/length*step;this.position.y+=dy/length*step;this.position.z+=dz/length*step;
  }

  /**
   * Onde o próximo corpo toca o chão.
   *
   * O primeiro cai em cima do jogador; os dez da onda se abrem em espiral à volta dele, com ângulo
   * girando pelo ângulo áureo e raio crescendo — ninguém nasce dentro de ninguém. A altura vem do
   * piso real; sem piso válido, cai no nível em que o próprio jogador está pisando.
   */
  private aimLanding(player:Vec3,ground:(x:number,z:number)=>number):void {
    const angle=this.delivered*2.399963,radius=this.delivered===0?0:1.8+RAID_SCATTER*Math.sqrt(this.delivered/RAID_SWARM_DROP);
    const x=player.x+Math.sin(angle)*radius,z=player.z+Math.cos(angle)*radius;
    const y=ground(x,z);
    this.landing.x=x;this.landing.z=z;this.landing.y=Number.isFinite(y)?y:player.y;
  }
}

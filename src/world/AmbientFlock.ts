import type {Vec3} from '../core/contracts';

/**
 * Simulação dos bichos de cenário da fazenda — galinhas, corvos e pardais.
 *
 * ## Por que isto é puro e não fala com o Babylon
 *
 * O que quebra num bando de cenário não é o desenho, é a **contabilidade**: bicho que nasce além do
 * orçamento, bicho que morre duas vezes e devolve dois bursts de penas, bicho que some e nunca
 * volta. Nada disso precisa de GPU para ser reproduzido, e com o Babylon no meio só se testa
 * carregando um GLB de 7 mil triângulos. Então o estado de vida, susto e renascimento mora aqui,
 * em números, e `FarmWildlife` só lê este estado e o transforma em pose.
 *
 * ## Eles NÃO são mobs
 *
 * Não têm vida, não têm dano, não têm IA de combate: um tiro mata, ponto. `kill` é idempotente de
 * propósito — a granada que pega três galinhas de uma vez acerta a mesma galinha várias vezes no
 * mesmo quadro, e sem isso sairiam três explosões de penas do mesmo bicho.
 */

export type AmbientSpecies='chicken'|'crow'|'sparrow';

/**
 * Teto absoluto de bichos vivos ao mesmo tempo.
 *
 * Cada bicho é uma instância com esqueleto e AnimationGroups PRÓPRIOS (`doNotInstantiate`), que é o
 * que permite cada um ter a sua pose — e é exatamente o que custa. 18 é o limite escolhido: cabe a
 * fazenda povoada sem que a amostragem de pose apareça no quadro, e é um número fixo, não uma
 * consequência de quantos pontos de nascimento alguém desenhou depois.
 */
export const AMBIENT_FLOCK_CAP=18;

/** Orçamento por espécie. A soma é, por construção, o teto acima. */
export const AMBIENT_SPECIES_BUDGET:Readonly<Record<AmbientSpecies,number>>={chicken:8,crow:5,sparrow:5};

/**
 * Espera até o bicho morto reaparecer. É LONGO de propósito: o dono quer poder limpar o terreiro a
 * tiro e ver que limpou. Curto demais e o abate vira esteira; infinito e a fazenda esvazia numa
 * sessão longa e nunca mais tem vida nenhuma.
 */
export const AMBIENT_RESPAWN_SECONDS=26;

/** Raio em que um tiro/explosão assusta. Maior que o do jogador: o barulho viaja. */
export const AMBIENT_SHOT_STARTLE_RANGE=9;
/** Raio em que o jogador andando assusta. Curto, senão nada fica parado perto dele nunca. */
export const AMBIENT_PLAYER_STARTLE_RANGE=3.5;
/**
 * Alcance em que a pose é AMOSTRADA a cada quadro. Fora dele o bicho continua se movendo (custa
 * três multiplicações) mas segura a última pose: `sampleGroup` escreve o rig inteiro e chama
 * `skeleton.prepare(true)`, e isso é o caro. Um corvo a 50 m parado numa pose não é perceptível.
 */
export const AMBIENT_ANIMATION_RANGE=34;

/** Duração da fuga. Passado isso a galinha volta a ciscar e a ave pousa de novo. */
export const AMBIENT_FLEE_SECONDS=4.5;

const SPEED:Readonly<Record<AmbientSpecies,{walk:number;flee:number}>>={
  chicken:{walk:.62,flee:3.4},
  crow:{walk:0,flee:7.2},
  sparrow:{walk:0,flee:6.4},
};

/** Velocidade do ciclo de animação, em voltas por segundo, por espécie e estado. */
const CLIP_RATE:Readonly<Record<AmbientSpecies,{calm:number;flee:number}>>={
  chicken:{calm:.55,flee:1.9},
  crow:{calm:.28,flee:1.5},
  sparrow:{calm:.7,flee:2.4},
};

export interface AmbientSlot {
  readonly species:AmbientSpecies;
  /** Onde o bicho vive. Fuga afasta dali; renascimento devolve para cá. */
  readonly x:number;readonly y:number;readonly z:number;
  /** Poleiro: o bicho começa acima do chão e volta para lá depois do voo. */
  readonly perch:boolean;
  readonly yaw:number;
}

export type AmbientMode='calm'|'flee';

export interface AmbientAnimal {
  readonly id:number;
  readonly species:AmbientSpecies;
  readonly slot:AmbientSlot;
  x:number;y:number;z:number;
  yaw:number;
  mode:AmbientMode;
  /** Tempo restante do estado atual, em segundos. */
  timer:number;
  /** Progresso 0..1 dentro do clipe, escrito por `sampleGroup` na camada de desenho. */
  phase:number;
  alive:boolean;
  /** Conta regressiva para renascer. Só corre com `alive===false`. */
  respawnIn:number;
  /** A galinha está andando (ao contrário de ciscar parada). */
  walking:boolean;
  /** Alvo do passeio calmo. */
  targetX:number;targetZ:number;
  /** De onde veio o susto, para fugir na direção OPOSTA e não para cima do tiro. */
  fleeX:number;fleeZ:number;
}

const distance2=(ax:number,az:number,bx:number,bz:number):number=>{const dx=ax-bx,dz=az-bz;return dx*dx+dz*dz;};

/**
 * Distribui os pontos de nascimento respeitando o orçamento por espécie.
 *
 * O corte é feito AQUI e não no laço de desenho: um mapa que ganhou poleiros novos não pode
 * aumentar o bando calado. Pontos além do orçamento da espécie são descartados, na ordem recebida.
 */
export function limitAmbientSlots(slots:readonly AmbientSlot[]):AmbientSlot[] {
  const used:Record<AmbientSpecies,number>={chicken:0,crow:0,sparrow:0};
  const kept:AmbientSlot[]=[];
  for(const slot of slots){
    if(kept.length>=AMBIENT_FLOCK_CAP)break;
    if(used[slot.species]>=AMBIENT_SPECIES_BUDGET[slot.species])continue;
    used[slot.species]++;kept.push(slot);
  }
  return kept;
}

export class AmbientFlock {
  readonly animals:AmbientAnimal[]=[];
  constructor(slots:readonly AmbientSlot[],private readonly random:()=>number=Math.random){
    let id=0;
    for(const slot of limitAmbientSlots(slots)){
      this.animals.push({
        id:id++,species:slot.species,slot,
        x:slot.x,y:slot.y,z:slot.z,yaw:slot.yaw,
        mode:'calm',timer:this.random()*2.5,phase:this.random(),
        alive:true,respawnIn:0,walking:false,
        targetX:slot.x,targetZ:slot.z,fleeX:slot.x,fleeZ:slot.z-1,
      });
    }
  }

  get aliveCount():number{let n=0;for(const a of this.animals)if(a.alive)n++;return n;}
  get fleeingCount():number{let n=0;for(const a of this.animals)if(a.alive&&a.mode==='flee')n++;return n;}

  /**
   * Um tiro mata, e só uma vez.
   *
   * Devolve o bicho na PRIMEIRA vez e `undefined` depois: quem chama usa isso para decidir se solta
   * penas e som. Granada e tiro múltiplo acertam o mesmo alvo no mesmo quadro, e sem este portão
   * saíam vários jatos de sangue de um bicho só.
   */
  kill(id:number):AmbientAnimal|undefined {
    const animal=this.animals.find(a=>a.id===id);
    if(!animal||!animal.alive)return undefined;
    animal.alive=false;animal.respawnIn=AMBIENT_RESPAWN_SECONDS;animal.mode='calm';animal.timer=0;
    return animal;
  }

  /** Susto vindo de um ponto (tiro, explosão, passo pesado). Devolve quantos se assustaram. */
  startleAt(point:Vec3,radius=AMBIENT_SHOT_STARTLE_RANGE):number {
    const r2=radius*radius;let count=0;
    for(const animal of this.animals){
      if(!animal.alive)continue;
      if(distance2(animal.x,animal.z,point.x,point.z)>r2)continue;
      this.startle(animal,point.x,point.z);count++;
    }
    return count;
  }

  private startle(animal:AmbientAnimal,fromX:number,fromZ:number):void {
    animal.fleeX=fromX;animal.fleeZ=fromZ;
    // Renovar o relógio num bicho que já foge é o que faz o bando continuar em pânico enquanto o
    // tiroteio dura, em vez de pousar no meio da rajada.
    animal.mode='flee';animal.timer=AMBIENT_FLEE_SECONDS;animal.walking=true;
  }

  /**
   * Um passo do mundo.
   *
   * `groundAt` é opcional porque o teste não tem cenário: sem ele o bicho anda no plano em que
   * nasceu, que é exatamente o que o teste quer medir.
   */
  update(dt:number,viewer?:Vec3,groundAt?:(x:number,z:number)=>number):void {
    if(!(dt>0))return;
    for(const animal of this.animals){
      if(!animal.alive){
        animal.respawnIn-=dt;
        if(animal.respawnIn<=0)this.respawn(animal);
        continue;
      }
      if(viewer&&animal.mode==='calm'&&distance2(animal.x,animal.z,viewer.x,viewer.z)<AMBIENT_PLAYER_STARTLE_RANGE**2)
        this.startle(animal,viewer.x,viewer.z);

      animal.timer-=dt;
      const rate=CLIP_RATE[animal.species][animal.mode];
      animal.phase=(animal.phase+dt*rate)%1;

      if(animal.mode==='flee')this.stepFlee(animal,dt);
      else this.stepCalm(animal,dt);

      // Quem está no poleiro mantém a cota do poleiro; quem cisca segue o relevo; quem voa só não
      // atravessa o chão. Consultar o relevo é um raycast por bicho por quadro, e por isso o
      // poleiro parado é justamente quem NÃO paga.
      if(groundAt&&!(animal.mode==='calm'&&animal.slot.perch)){
        const ground=groundAt(animal.x,animal.z);
        if(animal.species==='chicken'||animal.mode==='calm')animal.y=ground;
        else if(animal.y<ground+.4)animal.y=ground+.4;
      }
    }
  }

  private stepCalm(animal:AmbientAnimal,dt:number):void {
    if(animal.species!=='chicken'){
      // Corvo e pardal esperam pousados. O corvo NÃO tem clipe de espera no arquivo — só
      // `root|TakeOff` — então quem desenha segura o quadro 0 dele, e é por isso que o poleiro
      // precisa mesmo ser parado: qualquer balanço inventado aqui apareceria como tremor.
      if(animal.timer<=0)animal.timer=2+this.random()*4;
      return;
    }
    if(animal.timer<=0){
      animal.walking=this.random()<.45;
      animal.timer=animal.walking?1.2+this.random()*2:1.5+this.random()*2.5;
      if(animal.walking){
        // Longe de casa o passeio vira volta para casa: sem isso a galinha caminha aleatoriamente
        // até sair da fazenda, e cada susto empurra o bando um pouco mais para longe.
        const far=distance2(animal.x,animal.z,animal.slot.x,animal.slot.z)>36;
        const angle=this.random()*Math.PI*2,reach=1.5+this.random()*2.5;
        animal.targetX=far?animal.slot.x:animal.x+Math.cos(angle)*reach;
        animal.targetZ=far?animal.slot.z:animal.z+Math.sin(angle)*reach;
      }
    }
    if(!animal.walking)return;
    const dx=animal.targetX-animal.x,dz=animal.targetZ-animal.z,length=Math.hypot(dx,dz);
    if(length<.12){animal.walking=false;animal.timer=Math.min(animal.timer,.4);return;}
    const step=Math.min(length,SPEED.chicken.walk*dt);
    animal.x+=dx/length*step;animal.z+=dz/length*step;animal.yaw=Math.atan2(dx,dz);
  }

  private stepFlee(animal:AmbientAnimal,dt:number):void {
    if(animal.timer<=0){this.settle(animal);return;}
    let dx=animal.x-animal.fleeX,dz=animal.z-animal.fleeZ,length=Math.hypot(dx,dz);
    // Susto em cima do próprio bicho não tem direção: escolhe uma, senão ele fica travado no lugar
    // com uma divisão por zero disfarçada de NaN.
    if(length<1e-3){dx=Math.cos(animal.yaw);dz=Math.sin(animal.yaw);length=1;}
    const speed=SPEED[animal.species].flee,step=speed*dt;
    animal.x+=dx/length*step;animal.z+=dz/length*step;animal.yaw=Math.atan2(dx,dz);
    if(animal.species!=='chicken'){
      // Sobe enquanto foge, com teto: o corvo "decola e some", não vira satélite.
      const ceiling=animal.slot.y+7.5;
      if(animal.y<ceiling)animal.y=Math.min(ceiling,animal.y+3.2*dt);
    }
  }

  /** Fim da fuga: volta ao posto. Voar de volta ponto a ponto não acrescenta nada visível. */
  private settle(animal:AmbientAnimal):void {
    animal.mode='calm';animal.walking=false;animal.timer=1+this.random()*3;
    if(animal.species==='chicken')return;
    animal.x=animal.slot.x;animal.y=animal.slot.y;animal.z=animal.slot.z;animal.yaw=animal.slot.yaw;
  }

  private respawn(animal:AmbientAnimal):void {
    animal.alive=true;animal.respawnIn=0;animal.mode='calm';animal.walking=false;
    animal.timer=this.random()*2;animal.phase=this.random();
    animal.x=animal.slot.x;animal.y=animal.slot.y;animal.z=animal.slot.z;animal.yaw=animal.slot.yaw;
  }
}

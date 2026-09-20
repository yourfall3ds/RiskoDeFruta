import {ITEMS,computeRunStats,type RunStats} from './RunProgression';

/**
 * O INVENTÁRIO DE UM JOGADOR — e só dele.
 *
 * No cooperativo créditos, XP e nível são da sala, mas os ITENS são de cada sobrevivente. Sem essa
 * separação `RunProgression.stats` produziria um único `RunStats` para a sala inteira e o servidor
 * escreveria os mesmos atributos em todos os motores: quatro cópias de um personagem, não quatro
 * personagens. O nível continua vindo de fora (`level`) porque ele É compartilhado — por isso a
 * fórmula mora em `computeRunStats` e não aqui.
 */
export class PlayerLoadout {
  readonly inventory=new Map<string,number>();
  stats:RunStats;
  /** Nível com que os atributos vigentes foram calculados; `refresh` só recalcula quando muda. */
  private level:number;

  constructor(level=1){this.level=level;this.stats=computeRunStats(level,this.inventory);}

  /** Acompanha o nível da sala. Recalcular a cada passo seria varrer os 90 itens 60 vezes por segundo. */
  refresh(level:number):void {
    if(level===this.level)return;
    this.level=level;this.stats=computeRunStats(level,this.inventory);
  }

  addItem(id:string):number {
    if(!ITEMS.some(item=>item.id===id))throw new Error(`Unknown item ${id}`);
    const stacks=(this.inventory.get(id)??0)+1;
    this.inventory.set(id,stacks);
    this.stats=computeRunStats(this.level,this.inventory);
    return stacks;
  }

  clear():void {this.inventory.clear();this.stats=computeRunStats(this.level,this.inventory);}
}

/**
 * Ordenações e contagens que valem para um tique inteiro da horda.
 *
 * Antes, cada ator que pensava refazia dois varrimentos da lista completa: um `filter` + `sort` por
 * distância só para descobrir a própria posição na fila de ataque, e um `filter` para contar quantos
 * já estavam em `windup`. Com N atores e até `AI_TUNING.maxPerTick` pensamentos por tique isso é
 * O(maxPerTick × N log N) por frame, com duas listas novas por pensamento.
 *
 * O conjunto de atores não muda durante `AIScheduler.update`: `think` não move, não mata e não cria
 * ninguém — os spawns do diretor e das invocações acontecem depois. Então a fila pode ser montada
 * uma vez por tique e lida em O(1). A única coisa que muda no meio do tique é a contagem de
 * `windup`, e ela só cresce: `noteWindup` reproduz exatamente o `filter` antigo.
 */
export class HordeTickCache {
  private readonly slots:{id:number;ranged:boolean;distance:number}[]=[];
  private readonly groups:[number[],number[]]=[[],[]];
  private readonly ranks=new Map<number,number>();
  /** [corpo a corpo, à distância] — mesmas duas classes que o `filter` original separava. */
  private readonly windup:[number,number]=[0,0];
  private size=0;
  /** Diagnóstico: quantas vezes a fila foi montada. Um tique da horda deve montar no máximo uma. */
  builds=0;
  private readonly byDistance=(a:number,b:number):number=>this.slots[a]!.distance-this.slots[b]!.distance;
  begin():void {this.size=0;this.windup[0]=0;this.windup[1]=0;}
  /** `distance` pode ser o quadrado: só a ordem importa, e a ordem é a mesma. */
  add(id:number,ranged:boolean,distance:number,winding:boolean):void {
    const slot=this.slots[this.size];
    if(slot){slot.id=id;slot.ranged=ranged;slot.distance=distance;}
    else this.slots[this.size]={id,ranged,distance};
    this.size++;
    if(winding)this.windup[ranged?1:0]++;
  }
  finish():void {
    const [melee,ranged]=this.groups;
    melee.length=0;ranged.length=0;
    for(let i=0;i<this.size;i++)(this.slots[i]!.ranged?ranged:melee).push(i);
    this.ranks.clear();
    for(const group of this.groups){
      // `push` na ordem da lista + ordenação estável = mesmo desempate do `filter().sort()` antigo.
      group.sort(this.byDistance);
      for(let rank=0;rank<group.length;rank++)this.ranks.set(this.slots[group[rank]!]!.id,rank);
    }
    this.builds++;
  }
  /** Posição na fila de ataque da própria classe; -1 para quem não entrou na fila deste tique. */
  rank(id:number):number {return this.ranks.get(id)??-1;}
  windups(ranged:boolean):number {return this.windup[ranged?1:0]!;}
  /** Quem entra em `windup` no meio do tique conta para os próximos pensamentos do mesmo tique. */
  noteWindup(ranged:boolean):void {this.windup[ranged?1:0]++;}
  clear():void {this.begin();this.ranks.clear();this.groups[0].length=0;this.groups[1].length=0;this.slots.length=0;this.builds=0;}
}

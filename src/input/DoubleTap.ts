export type TapAxis='x+'|'x-'|'z+'|'z-';

/**
 * Detector de duplo toque direcional do WASD.
 *
 * Fica na CAPTURA, não na simulação: o cliente vê todos os quadros de teclado, então a borda
 * de soltura nunca se perde. O resultado viaja como intenção (`InputFrame.dash`) e o servidor
 * apenas valida cooldown/carga/colisão — continua autoritativo sobre o resultado.
 */
export class DoubleTap {
  /** Janela entre o primeiro e o segundo toque. */
  constructor(private readonly windowSeconds=0.28,private readonly now:()=>number=()=>performance.now()/1000){}
  private readonly pending=new Map<TapAxis,number>();
  private last={x:0,z:0};

  /** Chamar uma vez por quadro de entrada; devolve `true` no quadro do segundo toque. */
  read(x:number,z:number):boolean {
    const time=this.now();
    for(const [axis,stamp] of this.pending)if(time-stamp>this.windowSeconds)this.pending.delete(axis);
    const axes:[TapAxis,number,number][]=[['x+',x,this.last.x],['x-',-x,-this.last.x],['z+',z,this.last.z],['z-',-z,-this.last.z]];
    let fired=false;
    for(const [axis,current,previous] of axes){
      if(!(current>.5&&previous<=.5))continue;
      if(this.pending.has(axis)){fired=true;this.pending.clear();break;}
      this.pending.set(axis,time);
    }
    this.last={x,z};
    return fired;
  }
  clear():void {this.pending.clear();this.last={x:0,z:0};}
}

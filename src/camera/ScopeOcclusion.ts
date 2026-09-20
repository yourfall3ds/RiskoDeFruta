import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import {Vector3} from '@babylonjs/core/Maths/math.vector';

/**
 * A lente limpa da luneta.
 *
 * A câmera do jogo é de TERCEIRA pessoa: com a luneta aberta ela fecha o FOV, e o ombro, o braço e
 * o próprio cano da PRISM passam a ocupar o quadro inteiro — o jogador aponta para um pixel que
 * está atrás da cabeça do personagem. Esta classe esconde só o que REALMENTE está na frente da
 * lente e devolve cada malha exatamente à visibilidade que ela tinha.
 *
 * Duas regras que a fazem segura:
 *
 * - o estado anterior é guardado POR MALHA, na hora de esconder, e restaurado tal e qual. Uma malha
 *   que já estava invisível por outro motivo (morte, arma guardada, streaming) continua invisível
 *   depois — nunca "reaparece" por cortesia da luneta;
 * - `restore()` é idempotente e é chamado em todo caminho de saída (soltar a mira, trocar de arma,
 *   pausa, morte, descarte), então nenhuma malha fica escondida por engano.
 */
export class ScopeOcclusion {
  private readonly hidden=new Map<AbstractMesh,boolean>();

  constructor(
    /** As malhas candidatas — corpo do personagem e rig da arma. Avaliada a cada aplicação. */
    private readonly candidates:()=>Iterable<AbstractMesh>,
    /** Até que distância do olho uma malha é considerada "na frente da lente", em metros. */
    private readonly nearMetres=1.35,
  ) {}

  /** Quantas malhas estão escondidas por esta classe agora. Diagnóstico e teste. */
  get count():number {return this.hidden.size;}

  /**
   * `active` ligado esconde o que bloqueia; desligado devolve tudo. Chamado por quadro: malhas que
   * saíram da frente da lente voltam sozinhas no quadro seguinte.
   */
  apply(active:boolean,eye:Vector3):void {
    if(!active){this.restore();return;}
    for(const [mesh,previous] of this.hidden){
      if(mesh.isDisposed()){this.hidden.delete(mesh);continue;}
      if(!this.blocks(mesh,eye)){mesh.isVisible=previous;this.hidden.delete(mesh);}
    }
    for(const mesh of this.candidates()){
      if(this.hidden.has(mesh)||mesh.isDisposed()||!mesh.isVisible)continue;
      if(!this.blocks(mesh,eye))continue;
      this.hidden.set(mesh,mesh.isVisible);
      mesh.isVisible=false;
    }
  }

  restore():void {
    for(const [mesh,previous] of this.hidden)if(!mesh.isDisposed())mesh.isVisible=previous;
    this.hidden.clear();
  }

  dispose():void {this.restore();}

  /** A esfera envolvente encosta na lente? É o teste barato que basta aqui. */
  private blocks(mesh:AbstractMesh,eye:Vector3):boolean {
    const sphere=mesh.getBoundingInfo?.().boundingSphere;
    if(!sphere)return false;
    return Vector3.Distance(sphere.centerWorld,eye)-sphere.radiusWorld<this.nearMetres;
  }
}

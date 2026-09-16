import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../core/contracts';

/**
 * Nave de inserção com deck aberto, de onde a expedição começa.
 *
 * O corpo visível é o GLB autoral `public/models/dropship-deck.glb`, gerado por
 * `scripts/build-dropship-deck.py` no mesmo pipeline Blender + mapas PBR dos outros assets do
 * projeto (casco de revolução, deck com nervuras, volume estrutural, corrimão nos dois lados,
 * propulsores e a boca aberta com faixa de perigo). Nada é primitiva de runtime e nenhum asset
 * original é alterado.
 *
 * **Sem colisão.** O personagem só pisa no deck durante a entrada, que é apresentação pura com o
 * motor travado. Registrar um corpo físico a 900 m de altitude criaria exatamente o problema do
 * colisor invisível do totem — piso que não corresponde a nada.
 */

/** Distância entre a origem do asset e a borda aberta do deck, em metros. */
export const DECK_LIP_OFFSET=.8;
/**
 * Alinha o eixo de corrida do asset com o yaw do jogador.
 *
 * O deck é autorado com a saída em +X no Blender/glTF, mas o carregador glTF do Babylon aplica a
 * troca de mão do sistema (rotação de 180° em Y somada a `scaling.z = -1`), o que espelha o eixo X.
 * Por isso a frente do asset aparece em **−X local** e o alinhamento correto é `yaw + π/2`, não
 * `yaw − π/2`. `tests/dropship-deck.test.ts` mede isso no GLB real, em quatro yaws.
 */
export const deckRotationY=(yaw:number):number=>yaw+Math.PI/2;

export class DropshipDeck {
  readonly root:TransformNode;
  private container:AssetContainer|undefined;
  private disposed=false;
  private clock=0;
  ready=false;
  error='';
  /** Peças que pulsam: reator do casco, balizas da saída e bocais dos propulsores. */
  private glow:TransformNode|undefined;

  constructor(private readonly scene:Scene){
    this.root=new TransformNode('dropship-deck',scene);
    this.root.setEnabled(false);
  }

  async load():Promise<void>{
    try{
      const container=await LoadAssetContainerAsync('/models/dropship-deck.glb',this.scene);
      if(this.disposed){container.dispose();return;}
      this.container=container;
      const group=container.instantiateModelsToScene(name=>'dropship-'+name,false,{doNotInstantiate:true});
      for(const node of group.rootNodes)node.parent=this.root;
      for(const mesh of this.root.getChildMeshes()){
        mesh.isPickable=false;
        // A 900 m de altitude a névoa do clima apagaria a nave inteira.
        mesh.applyFog=false;
        mesh.receiveShadows=false;
        mesh.alwaysSelectAsActiveMesh=true;
      }
      this.glow=this.root.getChildTransformNodes().find(n=>n.name.endsWith('Dropship reactor lights'));
      this.ready=true;
    }catch(error){if(!this.disposed)this.error=error instanceof Error?error.message:'Falha no deck da nave';}
  }

  /** Ancora a borda aberta do deck no ponto de salto, com o eixo de corrida no yaw do jogador. */
  place(edge:Vec3,yaw:number):void {
    if(this.disposed)return;
    this.base.set(edge.x-Math.sin(yaw)*DECK_LIP_OFFSET,edge.y,edge.z-Math.cos(yaw)*DECK_LIP_OFFSET);
    this.root.rotation.y=deckRotationY(yaw);
    this.root.position.copyFrom(this.base);
  }
  private readonly base=Vector3.Zero();

  /** `visible` desliga a nave inteira de uma vez — sem sobra em cena ao pular ou reiniciar. */
  update(dt:number,visible:boolean):void {
    if(this.disposed)return;
    this.root.setEnabled(visible&&this.ready);
    if(!visible||!this.ready)return;
    this.clock+=Math.max(0,Number.isFinite(dt)?dt:0);
    // Flutuação lenta do voo estacionário, sempre calculada a partir da âncora — nunca acumulada.
    this.root.position.copyFrom(this.base);
    this.root.position.y+=Math.sin(this.clock*.55)*.16;
    this.root.rotation.z=Math.sin(this.clock*.37)*.006;
    if(this.glow)this.glow.scaling.setAll(1+Math.sin(this.clock*2.4)*.012);
  }

  dispose():void {
    this.disposed=true;this.ready=false;this.glow=undefined;
    this.root.dispose(false,false);
    this.container?.dispose();this.container=undefined;
  }
}

/** Posição do centro do asset a partir da borda aberta. Usada pelos testes de alinhamento. */
export function deckAnchor(edge:Vec3,yaw:number):Vector3 {
  return new Vector3(edge.x-Math.sin(yaw)*DECK_LIP_OFFSET,edge.y,edge.z-Math.cos(yaw)*DECK_LIP_OFFSET);
}

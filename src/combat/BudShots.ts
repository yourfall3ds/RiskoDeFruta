import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {Scene} from '@babylonjs/core/scene';
import {Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';

/** Teto de buds vivos ao mesmo tempo. Estourou, o mais antigo some — nunca cresce sem limite. */
const LIVE_CAP=64;

interface LiveBud {
  readonly node:TransformNode;
  readonly from:Vector3;
  readonly to:Vector3;
  /** Segundos de voo até o ponto de impacto. */
  readonly flight:number;
  age:number;
  readonly spin:Vector3;
}

/**
 * Os BUDS desenhados da submetralhadora de seda.
 *
 * Apresentação e nada mais: **o dano já aconteceu** no instante do disparo (o tiro é instantâneo,
 * como o da PRISM em assalto). O bud é o que o jogador VÊ saindo do cano e chegando no alvo, e é
 * por isso que ele viaja num tempo calculado a partir da distância real do acerto — chegar antes
 * ou depois do impacto seria a arma mentindo sobre onde a bala foi parar.
 *
 * Falhar a carga não derruba nada: `ready` fica `false`, `error` entra no diagnóstico do F1 e o
 * combate segue com o rastro genérico do `ShotEffects`, que já existia.
 */
export class BudShots {
  private template:TransformNode|undefined;
  private container:AssetContainer|undefined;
  private readonly live:LiveBud[]=[];
  private disposed=false;
  ready=false;
  error='';

  constructor(private readonly scene:Scene) {}

  async load():Promise<void> {
    try{
      const container=await LoadAssetContainerAsync('/models/weapons/cannabis-bud.glb',this.scene);
      if(this.disposed){container.dispose();return;}
      this.container=container;container.addAllToScene();
      const root=container.rootNodes[0];
      if(!root)throw Error('bud sem nó raiz');
      root.setEnabled(false);
      for(const mesh of root.getChildMeshes())mesh.isPickable=false;
      this.template=root as TransformNode;
      this.ready=true;
    }catch(error){
      if(!this.disposed)this.error=error instanceof Error?error.message:'Falha nos buds';
    }
  }

  /**
   * Um bud saindo do cano em direção ao ponto REAL do acerto.
   *
   * `speed` vem da tabela da arma. A distância divide a velocidade para achar o tempo de voo; num
   * tiro à queima-roupa isso dá um piscar, que é exatamente o que se quer — o bud não pode pairar.
   */
  spawn(from:Vector3,to:Vector3,speed:number,scale=1):void {
    if(!this.ready||!this.template)return;
    const node=this.template.clone(`bud-${this.live.length}`,null);
    if(!node)return;
    node.setEnabled(true);
    for(const mesh of node.getChildMeshes()){mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;}
    node.position.copyFrom(from);
    node.rotationQuaternion=Quaternion.Identity();
    // A escala do template é a do GLB; a de leitura multiplica por cima dela.
    node.scaling.copyFrom(this.template.scaling).scaleInPlace(scale);
    while(this.live.length>=LIVE_CAP)this.live.shift()?.node.dispose();
    this.live.push({
      node,from:from.clone(),to:to.clone(),
      flight:Math.max(.02,Vector3.Distance(from,to)/Math.max(1,speed)),
      age:0,
      // O bud gira enquanto voa: um pedaço de flor não sai do cano alinhado como uma bala.
      spin:new Vector3(18+Math.random()*10,24+Math.random()*12,11+Math.random()*8),
    });
  }

  update(dt:number):void {
    if(this.live.length===0)return;
    const step=Math.max(0,dt);
    for(let i=this.live.length-1;i>=0;i--){
      const bud=this.live[i]!;
      bud.age+=step;
      const t=bud.age/bud.flight;
      if(t>=1){bud.node.dispose();this.live.splice(i,1);continue;}
      Vector3.LerpToRef(bud.from,bud.to,t,bud.node.position);
      bud.node.rotationQuaternion=Quaternion.RotationYawPitchRoll(
        bud.spin.y*bud.age,bud.spin.x*bud.age,bud.spin.z*bud.age);
    }
  }

  /** Morte, pausa dura, viagem: nada de bud sobrevivendo a uma troca de cena. */
  clear():void {
    for(const bud of this.live)bud.node.dispose();
    this.live.length=0;
  }

  get count():number {return this.live.length;}

  dispose():void {
    this.disposed=true;
    this.clear();
    this.container?.dispose();
  }
}

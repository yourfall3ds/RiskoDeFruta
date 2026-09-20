import {CreateCylinder} from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';

/**
 * Feixe de contra-abdução: a luz que **deposita** o monstro no chão.
 *
 * É o clássico cone de abdução ao contrário. Três camadas concêntricas, todas emissivas e sem
 * iluminação, no mesmo padrão do `EnemyLaser` do projeto: um cone largo e translúcido, um miolo
 * mais estreito e um disco de contato no chão que marca onde o corpo vai pousar.
 *
 * Só apresentação. Quem decide quando acender e onde pousar é o `SaucerRaid`.
 */
export class AbductionBeam {
  private readonly cone;
  private readonly core;
  private readonly pad;
  private readonly coneMaterial:StandardMaterial;
  private readonly coreMaterial:StandardMaterial;
  private readonly padMaterial:StandardMaterial;
  private clock=0;

  constructor(scene:Scene){
    this.coneMaterial=new StandardMaterial('abduction-beam-cone',scene);
    this.coneMaterial.emissiveColor=new Color3(.35,1.5,.85);
    this.coneMaterial.disableLighting=true;this.coneMaterial.alpha=.20;this.coneMaterial.backFaceCulling=false;
    this.coreMaterial=new StandardMaterial('abduction-beam-core',scene);
    this.coreMaterial.emissiveColor=new Color3(1.6,2.6,1.9);
    this.coreMaterial.disableLighting=true;this.coreMaterial.alpha=.34;this.coreMaterial.backFaceCulling=false;
    this.padMaterial=new StandardMaterial('abduction-beam-pad',scene);
    this.padMaterial.emissiveColor=new Color3(.5,2,1.1);
    this.padMaterial.disableLighting=true;this.padMaterial.alpha=.5;

    // Cone invertido: boca larga em baixo, estreito junto à nave — é o formato da luz de abdução.
    this.cone=CreateCylinder('abduction-cone',{height:1,diameterTop:.9,diameterBottom:3.4,tessellation:28},scene);
    this.core=CreateCylinder('abduction-core',{height:1,diameterTop:.35,diameterBottom:1.5,tessellation:20},scene);
    this.pad=CreateCylinder('abduction-pad',{height:.06,diameter:3.4,tessellation:32},scene);
    for(const [mesh,material] of [[this.cone,this.coneMaterial],[this.core,this.coreMaterial],[this.pad,this.padMaterial]] as const){
      mesh.material=material;mesh.isPickable=false;mesh.setEnabled(false);
      // Um feixe não recebe sombra nem projeta; e a névoa do clima não pode apagá-lo.
      mesh.receiveShadows=false;mesh.applyFog=false;mesh.alwaysSelectAsActiveMesh=true;
    }
  }

  /** Apaga o feixe inteiro. */
  hide():void {
    this.cone.setEnabled(false);this.core.setEnabled(false);this.pad.setEnabled(false);
  }

  /**
   * Acende o feixe entre a nave e o ponto de pouso.
   * `intensity` (0..1) abre e fecha a luz nas pontas da descida, para não piscar ligado/desligado.
   */
  show(from:Vector3,to:Vector3,intensity:number,dt:number):void {
    const power=Math.max(0,Math.min(1,intensity));
    if(power<=.01){this.hide();return;}
    this.clock+=Math.max(0,dt);
    const height=Math.max(.2,from.y-to.y);
    const centre=new Vector3(to.x,to.y+height/2,to.z);
    for(const mesh of [this.cone,this.core]){
      mesh.setEnabled(true);
      mesh.position.copyFrom(centre);
      mesh.rotation.set(0,0,0);
      mesh.scaling.set(power,height,power);
    }
    // Pulso lento no miolo: a luz respira em vez de ficar chapada.
    this.core.scaling.x=this.core.scaling.z=power*(.85+Math.sin(this.clock*7)*.12);
    this.pad.setEnabled(true);
    this.pad.position.set(to.x,to.y+.04,to.z);
    const spread=power*(1+Math.sin(this.clock*4)*.06);
    this.pad.scaling.set(spread,1,spread);
    this.coneMaterial.alpha=.20*power;
    this.coreMaterial.alpha=.34*power;
    this.padMaterial.alpha=.5*power;
  }

  dispose():void {
    this.cone.dispose();this.core.dispose();this.pad.dispose();
    this.coneMaterial.dispose();this.coreMaterial.dispose();this.padMaterial.dispose();
  }
}

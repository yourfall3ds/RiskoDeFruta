import {CreateDisc} from '@babylonjs/core/Meshes/Builders/discBuilder';
import {CreateLines} from '@babylonjs/core/Meshes/Builders/linesBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {LinesMesh} from '@babylonjs/core/Meshes/linesMesh';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../core/contracts';
import {TRAJECTORY_MAX_POINTS} from '../combat/GrenadeTrajectory';

/**
 * O arco previsto do lança-granadas e o ponto de queda, desenhados.
 *
 * É APRESENTAÇÃO DE MIRA, não cenário: uma polilinha sem iluminação e um disco de contato, os dois
 * fora da colisão, fora do picking e fora das sombras. Nenhum asset de mundo é inventado aqui.
 *
 * Os dois nós são criados UMA vez, no tamanho máximo, e depois só reescritos — um `CreateLines` por
 * quadro entregaria lixo ao coletor no meio do combate. A linha é atualizada por `instance`, que é
 * o caminho do Babylon para reaproveitar o buffer de vértices.
 *
 * O marcador de queda só existe quando existe CONTATO: estopim estourado no ar não marca chão
 * nenhum, porque ali não há chão para marcar.
 */
export class TrajectoryView {
  private line:LinesMesh;
  private readonly marker:Mesh;
  private readonly points:Vector3[];
  private readonly markerNormal=new Vector3(0,1,0);
  private visible=false;
  private disposed=false;

  constructor(private readonly scene:Scene,private readonly capacity=TRAJECTORY_MAX_POINTS) {
    // A linha nasce degenerada (todos os pontos na origem) e cresce só em conteúdo, nunca em
    // tamanho: `updatable` exige que a contagem de pontos não mude entre atualizações.
    this.points=Array.from({length:Math.max(2,capacity)},()=>new Vector3());
    this.line=CreateLines('grenade-arc',{points:this.points,updatable:true},scene);
    this.line.color=new Color3(.55,.92,1);
    this.line.alpha=.85;
    this.line.isPickable=false;
    this.line.doNotSyncBoundingInfo=true;
    this.line.alwaysSelectAsActiveMesh=true;
    this.line.renderingGroupId=1;
    this.line.setEnabled(false);

    const material=new StandardMaterial('grenade-landing',scene);
    material.disableLighting=true;
    material.emissiveColor=new Color3(.55,.92,1);
    material.alpha=.55;
    material.backFaceCulling=false;
    this.marker=CreateDisc('grenade-landing',{radius:.55,tessellation:28},scene);
    this.marker.material=material;
    this.marker.isPickable=false;
    this.marker.receiveShadows=false;
    this.marker.alwaysSelectAsActiveMesh=true;
    this.marker.renderingGroupId=1;
    this.marker.rotationQuaternion=Quaternion.Identity();
    this.marker.setEnabled(false);
  }

  get active():boolean {return this.visible;}

  /**
   * Redesenha o arco. `impact` ausente esconde o marcador sem esconder a linha — é o caso do
   * estopim que estoura no ar e o do arco truncado.
   */
  show(points:readonly Vec3[],impact:{point:Vec3;normal:Vec3}|undefined):void {
    if(this.disposed)return;
    if(points.length<2){this.hide();return;}
    const count=Math.min(points.length,this.capacity);
    for(let i=0;i<this.points.length;i++){
      // Os índices sobrando repetem a ÚLTIMA amostra: a contagem de vértices tem de ser fixa, e
      // segmentos de comprimento zero não desenham nada.
      const source=points[Math.min(i,count-1)]!;
      this.points[i]!.set(source.x,source.y,source.z);
    }
    this.line=CreateLines('grenade-arc',{points:this.points,instance:this.line},this.scene);
    this.line.setEnabled(true);
    this.visible=true;
    if(!impact){this.marker.setEnabled(false);return;}
    // O disco nasce no plano XY do Babylon, com a face em `+Z`: alinhar `+Z` à normal do contato é
    // o que deixa o marcador deitado no chão, colado na parede ou no teto, conforme onde bateu.
    this.markerNormal.set(impact.normal.x,impact.normal.y,impact.normal.z);
    if(this.markerNormal.lengthSquared()<1e-8)this.markerNormal.set(0,1,0);
    else this.markerNormal.normalize();
    Quaternion.FromUnitVectorsToRef(FORWARD,this.markerNormal,this.marker.rotationQuaternion!);
    // 3 cm acima da superfície: sem a folga o disco briga em z-fighting com o chão em que caiu.
    this.marker.position.set(
      impact.point.x+this.markerNormal.x*.03,
      impact.point.y+this.markerNormal.y*.03,
      impact.point.z+this.markerNormal.z*.03,
    );
    this.marker.setEnabled(true);
  }

  hide():void {
    if(this.disposed||!this.visible)return;
    this.visible=false;
    this.line.setEnabled(false);
    this.marker.setEnabled(false);
  }

  dispose():void {
    if(this.disposed)return;
    this.disposed=true;
    this.visible=false;
    this.marker.material?.dispose();
    this.marker.dispose();
    this.line.dispose();
  }
}

const FORWARD=new Vector3(0,0,1);

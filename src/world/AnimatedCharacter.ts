import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {Skeleton} from '@babylonjs/core/Bones/skeleton';
import type {Scene} from '@babylonjs/core/scene';

/**
 * Importador de personagem animado de terceiros.
 *
 * ## Por que a adaptação é aqui e não no Blender
 *
 * Os modelos CC-BY baixados trazem rig e animação válidos, mas cada autor usa a sua convenção:
 * escala em centímetros, origem na cintura, eixo de frente arbitrário e nomes de clipe próprios.
 * Medimos o que acontece ao "consertar" isso reexportando: reparentear a cena num normalizador e
 * exportar de novo **mata a animação** dos rigs profundos (729 e 744 ossos) — os clipes sobrevivem
 * com o nome certo e param de mover a malha. Os mesmos originais, convertidos por passagem pura,
 * animam. Então o arquivo fica intocado e a adaptação acontece no carregamento.
 *
 * ## Hierarquia
 *
 * ```
 * EnemyGameplayRoot      posição, IA, colisão, vida   (do jogo)
 *   └ AssetPlacementRoot  apoio no chão medido
 *       └ AssetOrientationRoot  correção de eixo + escala
 *           └ hierarquia original do glTF    (intocada)
 * ```
 *
 * Nada abaixo de `AssetOrientationRoot` é tocado: nem osso, nem quaternion, nem malha individual.
 *
 * ## O que é medido, e não chutado
 *
 * A pose de vínculo de um glTF **não é** a pose do personagem em jogo: nestes modelos ela difere da
 * espera em até 0,45 unidade de altura, e é isso que enterra o corpo no chão. Toda medida sai da
 * **geometria deformada pelo esqueleto** com a espera amostrada, que é o que a tela mostra.
 */

export type ClipRole='Idle'|'Walk'|'Run'|'Attack'|'Death';

export interface CharacterProfile {
  readonly model:string;
  /** Altura desejada em metros, medida na pose de espera. */
  readonly height:number;
  /** Giro de apresentação, em radianos, aplicado no root de orientação. */
  readonly yaw:number;
  readonly clips:Readonly<Record<ClipRole,readonly string[]>>;
  /** Papéis cujo clipe toca de trás para frente (queda derivada do "levantar" do autor). */
  readonly reversed?:readonly ClipRole[];
  /**
   * Postura do corpo. Existe porque "de pé" não se mede igual em todo bicho: um bípede é mais alto
   * que fundo, uma ave ou um quadrúpede é o contrário sem estar deitado. É declarado aqui em vez de
   * virar um limiar frouxo que deixaria um bípede deitado passar.
   */
  readonly stance?:'bipede'|'quadrupede';
}

export interface NormalizedCharacter {
  readonly placement:TransformNode;
  readonly orientation:TransformNode;
  readonly meshes:AbstractMesh[];
  readonly skeletons:Skeleton[];
  readonly clips:Map<string,AnimationGroup>;
  readonly height:number;
  readonly scale:number;
  readonly groundOffset:number;
  readonly orientationLabel:string;
  readonly orientationMethod:string;
  readonly confidence:number;
  /** A espera realmente move a malha? `false` denuncia clipe inerte. */
  readonly animationEffective:boolean;
  readonly report:string;
  dispose():void;
}

/** Extremos verticais da geometria já deformada pelo esqueleto. */
function deformedBounds(meshes:readonly AbstractMesh[]):{low:number;high:number}|undefined {
  const point=new Vector3();
  let low=Number.POSITIVE_INFINITY,high=Number.NEGATIVE_INFINITY;
  for(const mesh of meshes){
    const vertices=mesh.getPositionData(true,true);
    if(!vertices?.length)continue;
    const matrix=mesh.computeWorldMatrix(true);
    for(let i=0;i<vertices.length;i+=3){
      Vector3.TransformCoordinatesFromFloatsToRef(vertices[i]!,vertices[i+1]!,vertices[i+2]!,matrix,point);
      if(point.y<low)low=point.y;
      if(point.y>high)high=point.y;
    }
  }
  return Number.isFinite(low)&&Number.isFinite(high)?{low,high}:undefined;
}

/**
 * Escreve uma pose no rig sem deixar a animação correndo.
 *
 * `skeleton.prepare(true)` depois da escrita não é opcional: sem ele as matrizes dos ossos ficam as
 * do quadro anterior e qualquer medida devolve a pose antiga — foi assim que a primeira versão do
 * diagnóstico imprimiu três poses diferentes com números idênticos.
 */
export function sampleGroup(group:AnimationGroup,progress:number,skeletons:readonly Skeleton[]):void {
  const frame=group.from+(group.to-group.from)*Math.max(0,Math.min(1,progress));
  for(const track of group.targetedAnimations){
    const node=track.target as TransformNode;
    const value:unknown=track.animation.evaluate(frame);
    const property=track.animation.targetProperty;
    if(property==='rotationQuaternion'&&node.rotationQuaternion&&value&&typeof value==='object'&&'w' in value)
      node.rotationQuaternion.copyFrom(value as never);
    else if(property==='position'&&value instanceof Vector3)node.position.copyFrom(value);
    else if(property==='scaling'&&value instanceof Vector3)node.scaling.copyFrom(value);
  }
  for(const skeleton of skeletons)skeleton.prepare(true);
}

/** Cópia de um grupo com o tempo invertido: a queda feita por quem fez o rig. */
function reverseGroup(group:AnimationGroup,name:string,scene:Scene):AnimationGroup {
  const reversed=new AnimationGroup(name,scene);
  for(const track of group.targetedAnimations){
    const keys=track.animation.getKeys();
    if(keys.length<2)continue;
    const first=keys[0]!.frame,last=keys[keys.length-1]!.frame;
    const clone=track.animation.clone();
    clone.setKeys(keys.map(key=>({...key,frame:first+last-key.frame})).reverse());
    reversed.addTargetedAnimation(clone,track.target);
  }
  reversed.stop();
  return reversed;
}

/**
 * Candidatos de correção de eixo, sempre avaliados A PARTIR DA IDENTIDADE.
 * Acumular rotação entre tentativas é o erro que piora o corpo a cada recarga.
 */
const ORIENTATION_CANDIDATES:readonly {label:string;x:number;y:number;z:number}[]=[
  {label:'identidade',x:0,y:0,z:0},
  {label:'X+90',x:Math.PI/2,y:0,z:0},
  {label:'X-90',x:-Math.PI/2,y:0,z:0},
  {label:'Z+90',x:0,y:0,z:Math.PI/2},
  {label:'Z-90',x:0,y:0,z:-Math.PI/2},
  {label:'Y180',x:0,y:Math.PI,z:0},
];

const BONE_ALIASES={
  head:[/head(?!.*end)/i,/skull/i,/neck/i],
  hips:[/hips?$/i,/pelvis/i,/spine0?1/i,/^root$/i],
  foot:[/foot(?!.*end)/i,/ankle/i,/toe(?!.*end)/i,/calf/i,/leg/i],
} as const;

function findBones(skeletons:readonly Skeleton[],patterns:readonly RegExp[]):TransformNode[] {
  for(const pattern of patterns){
    const hits:TransformNode[]=[];
    for(const skeleton of skeletons)
      for(const bone of skeleton.bones){
        const node=bone.getTransformNode();
        if(node&&pattern.test(bone.name)&&!hits.includes(node))hits.push(node);
      }
    if(hits.length)return hits;
  }
  return [];
}

const averageY=(nodes:readonly TransformNode[]):number|undefined=>{
  if(!nodes.length)return undefined;
  let total=0;
  for(const node of nodes){node.computeWorldMatrix(true);total+=node.getAbsolutePosition().y;}
  return total/nodes.length;
};

function resolveClip(groups:readonly AnimationGroup[],aliases:readonly string[]):AnimationGroup|undefined {
  for(const alias of aliases){
    const wanted=alias.toLowerCase();
    const hit=groups.find(group=>{
      const name=group.name.toLowerCase();
      return name===wanted||name.endsWith('|'+wanted)||name.endsWith(wanted);
    });
    if(hit)return hit;
  }
  return undefined;
}

/**
 * Instancia um personagem e o deixa pronto para o jogo: de pé, virado, na escala pedida, com a sola
 * na origem do `parent`, e os clipes acessíveis pelo nome canônico.
 *
 * Esqueleto e grupos de animação são os da própria instância, nunca compartilhados com outra cópia:
 * tocar `Walk` num inimigo não pode mover os outros.
 */
export function normalizeAnimatedCharacter(
  container:AssetContainer,scene:Scene,profile:CharacterProfile,id:string|number,parent:TransformNode,
):NormalizedCharacter|undefined {
  const instance=container.instantiateModelsToScene(name=>`${profile.model}-${id}-${name}`,false,{doNotInstantiate:true});
  const placement=new TransformNode(`${profile.model}-${id}-placement`,scene);
  const orientation=new TransformNode(`${profile.model}-${id}-orientation`,scene);
  placement.parent=parent;orientation.parent=placement;
  for(const node of instance.rootNodes)node.parent=orientation;

  const meshes=orientation.getChildMeshes().filter(mesh=>mesh.getTotalVertices()>0);
  if(!meshes.length){placement.dispose(false,false);return undefined;}
  const skeletons=instance.skeletons;
  const groups=instance.animationGroups;
  for(const group of groups)group.stop();

  const clips=new Map<string,AnimationGroup>();
  const derived:AnimationGroup[]=[];
  for(const role of ['Idle','Walk','Run','Attack','Death'] as const){
    const group=resolveClip(groups,profile.clips[role]);
    if(!group)continue;
    if(profile.reversed?.includes(role)){
      const backwards=reverseGroup(group,`${profile.model}-${id}-${role}-reverso`,scene);
      derived.push(backwards);clips.set(role,backwards);
    } else clips.set(role,group);
  }
  const idle=clips.get('Idle');

  // ---- 1. orientação, medida no esqueleto -----------------------------------------------------
  placement.position.setAll(0);placement.scaling.setAll(1);placement.rotation.set(0,0,0);
  orientation.position.setAll(0);orientation.scaling.setAll(1);orientation.rotation.set(0,0,0);
  const head=findBones(skeletons,BONE_ALIASES.head);
  const hips=findBones(skeletons,BONE_ALIASES.hips);
  const feet=findBones(skeletons,BONE_ALIASES.foot);
  const skeletal=head.length>0&&hips.length>0;
  let best={label:'identidade',x:0,y:0,z:0,score:Number.NEGATIVE_INFINITY};
  for(const candidate of ORIENTATION_CANDIDATES){
    orientation.rotation.set(candidate.x,candidate.y,candidate.z);
    orientation.computeWorldMatrix(true);
    if(idle)sampleGroup(idle,0,skeletons);else for(const s of skeletons)s.prepare(true);
    for(const mesh of meshes)mesh.computeWorldMatrix(true);
    const bounds=deformedBounds(meshes);
    const headY=averageY(head),hipsY=averageY(hips),feetY=averageY(feet);
    let score=0;
    if(headY!==undefined&&hipsY!==undefined){
      if(headY>hipsY)score+=4;
      score+=Math.max(-2,Math.min(2,(headY-hipsY)));
    }
    if(hipsY!==undefined&&feetY!==undefined&&hipsY>feetY)score+=3;
    if(bounds){
      const height=bounds.high-bounds.low;
      if(feetY!==undefined&&height>1e-4&&Math.abs(feetY-bounds.low)<height*.3)score+=2;
      score+=Math.max(0,Math.min(1,height/Math.max(1e-4,height)));
    }
    if(score>best.score)best={label:candidate.label,x:candidate.x,y:candidate.y,z:candidate.z,score};
  }
  const confidence=skeletal?Math.max(0,Math.min(1,best.score/10)):0;
  // Sem ossos reconhecíveis não há como decidir: fica na identidade em vez de girar por chute.
  const chosen=skeletal?best:{label:'identidade (sem ossos)',x:0,y:0,z:0,score:0};
  orientation.rotation.set(chosen.x,chosen.y+profile.yaw,chosen.z);
  orientation.computeWorldMatrix(true);

  // ---- 2. escala, pela altura declarada -------------------------------------------------------
  if(idle)sampleGroup(idle,0,skeletons);else for(const s of skeletons)s.prepare(true);
  for(const mesh of meshes)mesh.computeWorldMatrix(true);
  const posed=deformedBounds(meshes);
  const measured=posed?posed.high-posed.low:0;
  const scale=measured>1e-4?profile.height/measured:1;
  orientation.scaling.setAll(scale);
  orientation.computeWorldMatrix(true);

  // ---- 3. apoio no chão, na pose animada ------------------------------------------------------
  // A medida sai em MUNDO, mas o deslocamento é aplicado num nó FILHO. Descontar a altura do pai é
  // obrigatório: sem isso o corpo vai parar em Y=0 do mundo em vez de encostar no root de jogo, e
  // o erro é exatamente a altura em que o inimigo nasceu.
  if(idle)sampleGroup(idle,0,skeletons);else for(const s of skeletons)s.prepare(true);
  for(const mesh of meshes)mesh.computeWorldMatrix(true);
  const scaled=deformedBounds(meshes);
  parent.computeWorldMatrix(true);
  const parentY=parent.getAbsolutePosition().y;
  const groundOffset=scaled?parentY-scaled.low:0;
  placement.position.y=groundOffset;
  placement.computeWorldMatrix(true);

  // ---- 4. a animação move mesmo a malha? ------------------------------------------------------
  let animationEffective=false;
  const walk=clips.get('Walk')??clips.get('Run')??clips.get('Attack');
  if(idle&&walk&&walk!==idle){
    sampleGroup(idle,0,skeletons);
    for(const mesh of meshes)mesh.computeWorldMatrix(true);
    const a=deformedBounds(meshes);
    sampleGroup(walk,.5,skeletons);
    for(const mesh of meshes)mesh.computeWorldMatrix(true);
    const b=deformedBounds(meshes);
    animationEffective=Boolean(a&&b&&(Math.abs(a.low-b.low)>1e-4||Math.abs(a.high-b.high)>1e-4));
    sampleGroup(idle,0,skeletons);
  } else if(idle){
    // Um clipe só: compara a espera consigo mesma em dois instantes.
    sampleGroup(idle,0,skeletons);
    for(const mesh of meshes)mesh.computeWorldMatrix(true);
    const a=deformedBounds(meshes);
    sampleGroup(idle,.5,skeletons);
    for(const mesh of meshes)mesh.computeWorldMatrix(true);
    const b=deformedBounds(meshes);
    animationEffective=Boolean(a&&b&&(Math.abs(a.low-b.low)>1e-5||Math.abs(a.high-b.high)>1e-5));
    sampleGroup(idle,0,skeletons);
  }

  for(const mesh of meshes){mesh.alwaysSelectAsActiveMesh=true;mesh.receiveShadows=true;}

  const report=`[AlienLoader] asset=${profile.model} orientation=${chosen.label} confidence=${confidence.toFixed(2)}`
    +` method=${skeletal?'esqueleto':'nenhum'} scale=${scale.toFixed(3)} groundOffset=${groundOffset.toFixed(3)}`
    +` height=${(measured*scale).toFixed(2)}m clips=${[...clips.keys()].join('/')||'nenhum'}`
    +` animationEffective=${animationEffective}`;

  return {
    placement,orientation,meshes,skeletons,clips,
    height:measured*scale,scale,groundOffset,
    orientationLabel:chosen.label,orientationMethod:skeletal?'esqueleto':'nenhum',confidence,
    animationEffective,report,
    dispose():void{
      for(const group of [...groups,...derived])group.dispose();
      for(const skeleton of skeletons)skeleton.dispose();
      placement.dispose(false,false);
    },
  };
}

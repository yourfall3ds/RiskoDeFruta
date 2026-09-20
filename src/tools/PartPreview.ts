import {Engine} from '@babylonjs/core/Engines/engine';
import {Scene} from '@babylonjs/core/scene';
import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3,Color4} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import {CubeTexture} from '@babylonjs/core/Materials/Textures/cubeTexture';
import '@babylonjs/core/Materials/Textures/Loaders/envTextureLoader';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import '@babylonjs/loaders/glTF';

/**
 * Visualizador da saída do PartCrafter.
 *
 * Existe para responder uma pergunta específica: o GLB saiu SEPARADO mesmo? Um render bonito não
 * prova isso — uma malha fundida e uma malha em três partes desenham igual. O que prova é colorir
 * cada parte e AFASTÁ-LAS: se as peças se separam, a segmentação é real.
 *
 * Não faz parte do jogo. Vive em `src/tools/` como as outras ferramentas de revisão e só é
 * carregado pela página `pc-preview.html`.
 */

const COLOURS: readonly [number,number,number][] = [
  [.95,.42,.22],[.30,.72,.95],[.62,.90,.35],[.95,.80,.25],[.78,.45,.95],[.35,.95,.72],
];

interface Part {mesh: AbstractMesh; home: Vector3; away: Vector3}

const canvas=document.getElementById('c') as HTMLCanvasElement;
const engine=new Engine(canvas,true,{preserveDrawingBuffer:true},true);
const scene=new Scene(engine);
scene.clearColor=new Color4(.043,.067,.094,1);

const camera=new ArcRotateCamera('cam',Math.PI*.6,Math.PI*.42,3.2,Vector3.Zero(),scene);
camera.attachControl(canvas,true);
camera.wheelDeltaPercentage=.02;
new HemisphericLight('h',new Vector3(.2,1,.1),scene).intensity=.85;
new DirectionalLight('k',new Vector3(-.5,-1,-.4),scene).intensity=1.5;
// Ambiente para os materiais PBR do GLB: sem ele a pintura fica sem reflexo e some.
scene.environmentTexture=CubeTexture.CreateFromPrefilteredData('https://assets.babylonjs.com/environments/studio.env',scene);

const parts: Part[]=[];
let root: TransformNode|undefined;

const explode=document.getElementById('explode') as HTMLInputElement;
const spin=document.getElementById('spin') as HTMLInputElement;

function apply():void {
  const spread=Number(explode.value)/100;
  for(const part of parts)part.mesh.position=part.home.add(part.away.scale(spread*.9));
  if(root)root.rotation.y=Number(spin.value)*Math.PI/180;
}

async function load():Promise<void> {
  // Qual saída mostrar: `?glb=object-rmbg.glb` compara a geração com remoção de fundo.
  const busca=new URLSearchParams(location.search);
  const file=busca.get('glb')??'object.glb';
  // `?textura=1` preserva o material do GLB: sem isto a cor por parte esconderia a textura.
  const manterMaterial=busca.get('textura')==='1';
  const container=await LoadAssetContainerAsync('/pc-preview/'+file,scene);
  container.addAllToScene();
  const meshes=container.meshes.filter(mesh=>mesh.getTotalVertices()>0);

  let min:Vector3|undefined,max:Vector3|undefined;
  for(const mesh of meshes){
    const box=mesh.getBoundingInfo().boundingBox;
    min=min?Vector3.Minimize(min,box.minimumWorld):box.minimumWorld.clone();
    max=max?Vector3.Maximize(max,box.maximumWorld):box.maximumWorld.clone();
  }
  const centre=min!.add(max!).scale(.5);
  camera.radius=(max!.subtract(min!).length()||1)*1.35;

  const legend=document.getElementById('legend')!;
  let triangles=0;
  meshes.forEach((mesh,index)=>{
    const colour=COLOURS[index%COLOURS.length]!;
    const material=new StandardMaterial('part-'+index,scene);
    material.diffuseColor=new Color3(...colour);
    material.specularColor=new Color3(.15,.15,.18);
    // Em modo textura o material do GLB é PBR e precisa de AMBIENTE para refletir alguma coisa:
    // sem `environmentTexture` o Babylon devolve uma superfície quase chapada e a pintura some.
    if(manterMaterial){
      const pbr=mesh.material as {environmentIntensity?:number; albedoTexture?:unknown}|null;
      if(pbr&&'environmentIntensity' in pbr)pbr.environmentIntensity=1.1;
    } else mesh.material=material;
    // Direção de afastamento: do centro do CONJUNTO para o centro DA PARTE.
    const away=mesh.getBoundingInfo().boundingBox.centerWorld.subtract(centre);
    if(away.lengthSquared()<1e-6)away.copyFromFloats(0,1,0);
    parts.push({mesh,home:mesh.position.clone(),away:away.normalize()});
    const count=mesh.getTotalIndices()/3;
    triangles+=count;
    const row=document.createElement('div');
    row.className='row';
    const swatch=document.createElement('span');
    swatch.className='sw';
    swatch.style.background=`rgb(${colour.map(c=>Math.round(c*255)).join(',')})`;
    const text=document.createElement('span');
    text.textContent=`parte ${index} · ${count.toLocaleString('pt-BR')} tri`;
    row.append(swatch,text);
    legend.append(row);
  });

  root=new TransformNode('root',scene);
  for(const part of parts)part.mesh.parent=root;
  root.position=centre.scale(-1);
  // Diagnóstico honesto: diz QUAL material está na malha, para não confundir "sem textura" com
  // "textura não aplicada". Foi exatamente essa confusão que me custou duas rodadas aqui.
  const primeiro=meshes[0]?.material as {getClassName?:()=>string}|null;
  const materialNome=manterMaterial?(primeiro?.getClassName?.()??'nenhum'):'cor por parte';
  document.getElementById('stats')!.textContent=
    `${meshes.length} partes separadas · ${triangles.toLocaleString('pt-BR')} triângulos · material: ${materialNome}`;
  apply();
  (window as unknown as Record<string,unknown>)['__ready']=true;
}

for(const control of [explode,spin])control.addEventListener('input',apply);
engine.runRenderLoop(()=>scene.render());
window.addEventListener('resize',()=>engine.resize());
// Porta para renderizar à mão quando o rAF do painel de revisão está suspenso.
(window as unknown as Record<string,unknown>)['__draw']=():void=>{apply();scene.render();};
void load().catch((error:unknown)=>{
  document.getElementById('stats')!.textContent='falhou: '+String(error);
});

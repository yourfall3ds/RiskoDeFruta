import {followSun} from './FollowingSun';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3,Color4 } from '@babylonjs/core/Maths/math.color';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { HDRCubeTexture } from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import { createSeamlessSky } from './SeamlessSky';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import '@babylonjs/core/Materials/Textures/Loaders/envTextureLoader';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import {SceneLoader} from '@babylonjs/core/Loading/sceneLoader';
import {GLTFLoaderState, type GLTFFileLoader} from '@babylonjs/loaders/glTF';

export const TRAINING_LIGHTING = { sun:4.2, fill:.5, exposure:1.4, contrast:1.08, bloom:.12, shadowSize:2048, msaa:4 } as const;
const qualitySettings=new WeakMap<Scene,(balanced:boolean)=>void>();
export function applyLightingQuality(scene:Scene,balanced:boolean):void {qualitySettings.get(scene)?.(balanced);}
export function trainingLighting(scene: Scene,camera: Camera): ShadowGenerator {
  // glTF 9.25 raises every material to the scene's light count after each import.
  // Clamp before readiness/rendering: WebGL can expose only 12 vertex UBO bindings.
  const clampLights=()=>{for(const material of scene.materials)if(material instanceof PBRMaterial||material instanceof StandardMaterial){if(material.maxSimultaneousLights>4){material.unfreeze();material.maxSimultaneousLights=4;}}};
  scene.onBeforeRenderObservable.add(clampLights);
  // Imports finish between frames. Clamp before executeWhenReady can compile the inflated
  // shader variant; waiting for a render is too late when readiness itself blocks the render.
  //
  // O CORTE TEM DE ACONTECER NO `READY`, e não no `COMPLETE`. O carregador sobe as luzes de todos
  // os materiais DENTRO da passagem para READY (`glTFLoader._loadAsync`: o laço "Making sure we
  // enable enough lights" roda e em seguida `_setState(READY)` e `resultFunc()`), e é o `resultFunc`
  // que devolve o controle a quem importou. O COMPLETE só vem depois, quando as promessas finais
  // assentam. Cortando só no COMPLETE, sobrava uma janela entre a subida e o corte em que quem
  // importou já seguia a vida — e se algo compilasse ali, o programa saía com onze vagas de luz,
  // catorze blocos de uniforme, e falhava contra o limite de doze da placa. O programa falho ficava
  // no registro do motor e a cena nunca mais ficava pronta: o travamento no fim da barra, medido
  // no Test Map V1.0 e na fazenda. `onLoaderStateChangedObservable` notifica de forma SÍNCRONA
  // dentro de `_setState`, então o corte no READY roda antes de o controle voltar.
  // O COMPLETE continua cortando também: é barato e cobre o que chegar depois.
  const loaderObserver=SceneLoader.OnPluginActivatedObservable.add(plugin=>{
    if(plugin.name!=='gltf')return;
    const loader=plugin as GLTFFileLoader;
    const noReady=loader.onLoaderStateChangedObservable.add(state=>{if(state===GLTFLoaderState.READY)clampLights();});
    loader.onCompleteObservable.addOnce(()=>{clampLights();loader.onLoaderStateChangedObservable.remove(noReady);});
  });
  scene.onDisposeObservable.addOnce(()=>SceneLoader.OnPluginActivatedObservable.remove(loaderObserver));
  scene.clearColor=new Color4(.16,.25,.38,1);
  scene.fogMode=3;scene.fogStart=70;scene.fogEnd=260;scene.fogColor=new Color3(.34,.44,.62);
  const sun=new DirectionalLight('afternoon-sun',new Vector3(-.6,-1,.4),scene);
  sun.position.set(35,55,-20);sun.diffuse=new Color3(1,.88,.72);sun.intensity=TRAINING_LIGHTING.sun;
  sun.shadowMinZ=1;sun.shadowMaxZ=160;sun.shadowFrustumSize=92;sun.autoCalcShadowZBounds=false;
  const fill=new HemisphericLight('sky-fill',Vector3.Up(),scene);fill.diffuse=new Color3(.56,.7,1);fill.groundColor=new Color3(.23,.15,.12);fill.intensity=TRAINING_LIGHTING.fill;
  const env=new HDRCubeTexture('/environment/field-sky.hdr',scene,256,false,true,false,true);
  scene.environmentTexture=env;scene.environmentIntensity=.85;
  createSeamlessSky(scene);
  const shadows=new ShadowGenerator(TRAINING_LIGHTING.shadowSize,sun);shadows.usePercentageCloserFiltering=true;shadows.filteringQuality=ShadowGenerator.QUALITY_HIGH;shadows.bias=.0006;shadows.normalBias=.025;
  scene.onBeforeRenderObservable.add(()=>{const forward=camera.getForwardRay(1).direction;followSun(sun,{x:camera.globalPosition.x+forward.x*12,y:camera.globalPosition.y-1,z:camera.globalPosition.z+forward.z*12},shadows.mapSize);});
  const ambientOcclusion=new SSAO2RenderingPipeline('farm-contact-shadows',scene,{ssaoRatio:.5,blurRatio:.5},[camera],false);
  ambientOcclusion.radius=.7;ambientOcclusion.totalStrength=.65;ambientOcclusion.samples=8;ambientOcclusion.expensiveBlur=false;
  const pipeline=new DefaultRenderingPipeline('training-post',true,scene,[camera]);
  pipeline.fxaaEnabled=true;pipeline.samples=TRAINING_LIGHTING.msaa;pipeline.bloomEnabled=true;pipeline.bloomThreshold=.85;pipeline.bloomWeight=TRAINING_LIGHTING.bloom;pipeline.bloomKernel=48;
  pipeline.imageProcessingEnabled=true;pipeline.imageProcessing.toneMappingEnabled=true;
  pipeline.imageProcessing.toneMappingType=ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipeline.imageProcessing.exposure=TRAINING_LIGHTING.exposure;pipeline.imageProcessing.contrast=TRAINING_LIGHTING.contrast;
  let balanced=false;qualitySettings.set(scene,value=>{if(value===balanced)return;balanced=value;if(value)scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(ambientOcclusion.name,camera);else scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(ambientOcclusion.name,camera);shadows.mapSize=value?1024:TRAINING_LIGHTING.shadowSize;shadows.filteringQuality=value?ShadowGenerator.QUALITY_LOW:ShadowGenerator.QUALITY_HIGH;pipeline.samples=value?1:TRAINING_LIGHTING.msaa;});
  return shadows;
}

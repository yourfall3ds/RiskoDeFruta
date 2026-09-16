import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import {DracoDecoder} from '@babylonjs/core/Meshes/Compression/dracoDecoder';
import '@babylonjs/loaders/glTF';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Scene} from '@babylonjs/core/scene';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {Camera} from '@babylonjs/core/Cameras/camera';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {trainingLighting} from '../rendering/TrainingLighting';
import {PLANET_MESH_URL} from './PlanetManifest';

/**
 * A casca visível do planeta: o GLB autoral do Codex, carregado EXATAMENTE como veio.
 *
 * O contrato do asset diz que ilhas e pontes já estão assadas em coordenadas globais, na mesma
 * raiz da malha de colisão do manifesto. Portanto aqui não existe rotação, escala nem
 * reposicionamento: qualquer transformação a mais abre uma emenda entre o que se vê e o que
 * sustenta o corpo. Também não existe esfera de emergência — buraco continua buraco.
 */
export class PlanetWorldView {
  readonly root: TransformNode;
  readonly meshes: AbstractMesh[] = [];
  ready = false;
  error = '';
  private disposed = false;

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator | undefined) {
    this.root = new TransformNode('planet-world', scene);
  }

  async load(url = PLANET_MESH_URL): Promise<void> {
    try {
      DracoDecoder.DefaultConfiguration={
        wasmUrl:'/vendor/draco/draco_wasm_wrapper_gltf.js',
        wasmBinaryUrl:'/vendor/draco/draco_decoder_gltf.wasm',
        fallbackUrl:'/vendor/draco/draco_decoder_gltf.js',
      };
      const imported = await ImportMeshAsync(url, this.scene);
      if (this.disposed) {for (const mesh of imported.meshes) mesh.dispose(); return;}
      for (const mesh of imported.meshes) {
        if (!mesh.parent) mesh.parent = this.root;
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        // A casca é estática: congelar a matriz evita recalcular milhares de nós por quadro.
        mesh.freezeWorldMatrix();
        this.meshes.push(mesh);
        if (mesh.getTotalVertices() > 0) this.shadows?.addShadowCaster(mesh);
      }
      this.ready = true;
    } catch (error) {
      if (this.disposed) return;
      this.error = error instanceof Error
        ? `Não foi possível carregar ${url}: ${error.message}`
        : `Não foi possível carregar ${url}`;
    }
  }

  /**
   * Malha de um nó pelo nome EXATO do GLB — é como o manifesto de destrutíveis (`nodeName`)
   * aponta para o prop que vai rachar e estilhaçar.
   *
   * O importador do Babylon costuma prefixar instâncias, então a busca aceita o sufixo depois de
   * um separador. Devolver `undefined` é caso previsto pelo contrato: o prop então funciona em
   * modo "só colisão" (some do caminho, sem caco) em vez de derrubar o carregamento.
   */
  meshByName(nodeName: string): AbstractMesh | undefined {
    if (!nodeName) return undefined;
    const exact = this.meshes.find(mesh => mesh.name === nodeName);
    if (exact) return exact;
    return this.meshes.find(mesh => mesh.name.endsWith(nodeName)
      && /[.\-_ ]$/.test(mesh.name.slice(0, mesh.name.length - nodeName.length) || ' '));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes) mesh.dispose();
    this.meshes.length = 0;
    this.root.dispose();
  }
}

/**
 * Iluminação do planeta reaproveitando a montagem existente (HDR, sombras, pós-processamento).
 *
 * Duas correções são obrigatórias no globo: a névoa linear de 70–260 m do mundo plano apagava o
 * lado oposto do planeta e a câmera de órbita; e o plano distante precisa alcançar a casca inteira.
 * O sol continua fixo em espaço de mundo — num planeta isso é o comportamento certo: um hemisfério
 * iluminado e outro na sombra.
 */
export function planetLighting(scene: Scene, camera: Camera): ShadowGenerator {
  const shadows = trainingLighting(scene, camera);
  scene.fogMode = Scene.FOGMODE_NONE;
  return shadows;
}

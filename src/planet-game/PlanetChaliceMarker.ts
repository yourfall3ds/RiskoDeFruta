import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Quaternion} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {Vec3} from '../core/contracts';
import {anyPerpendicular, cross, normalize, quaternionFromBasis} from '../planet/PlanetFrame';

/**
 * O cálice autoral (`/models/harvest-chalice.glb`) plantado no convés de uma ilha.
 *
 * É o MESMO asset da expedição do jogo plano — nada de primitiva, nada de marcador procedural.
 * A única diferença é a raiz: o Y do modelo é alinhado com a vertical LOCAL da ilha, e não com o
 * Y do mundo, senão o cálice ficaria deitado em qualquer ilha fora do polo norte.
 */
export class PlanetChaliceMarker {
  readonly root: TransformNode;
  private readonly meshes: AbstractMesh[] = [];
  /** Vertical local e tangente de referência do sítio; o giro recompõe a base, sem acumular. */
  private axis: Vec3 = {x: 0, y: 1, z: 0};
  private forward: Vec3 = {x: 0, y: 0, z: 1};
  private spin = 0;
  ready = false;
  error = '';
  private disposed = false;

  constructor(private readonly scene: Scene, private readonly shadows?: ShadowGenerator) {
    this.root = new TransformNode('planet-chalice', scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    this.root.setEnabled(false);
  }

  async load(url = '/models/harvest-chalice.glb'): Promise<void> {
    try {
      const imported = await ImportMeshAsync(url, this.scene);
      if (this.disposed) {for (const mesh of imported.meshes) mesh.dispose(); return;}
      for (const mesh of imported.meshes) {
        if (!mesh.parent) mesh.parent = this.root;
        mesh.isPickable = false;
        this.meshes.push(mesh);
        if (mesh.getTotalVertices() > 0) this.shadows?.addShadowCaster(mesh);
      }
      this.ready = true;
    } catch (error) {
      if (!this.disposed) this.error = error instanceof Error ? error.message : 'Falha ao carregar o cálice';
    }
  }

  /** Planta o cálice com o pé no ponto dado e o topo apontando para fora do planeta. */
  placeAt(position: Vec3, up: Vec3): void {
    if (!this.ready) return;
    this.axis = normalize(up, {x: 0, y: 1, z: 0});
    this.forward = anyPerpendicular(this.axis);
    this.root.position.set(position.x, position.y, position.z);
    this.root.setEnabled(true);
    this.applyBasis();
  }

  /** Some do campo — troca de ilha, recomeço. O modelo continua carregado. */
  hide(): void {this.root.setEnabled(false);}

  /** Giro lento de leitura em torno da vertical LOCAL. Apresentação pura, sem deriva. */
  update(dt: number, visible: boolean): void {
    if (!this.ready || !this.root.isEnabled()) return;
    for (const mesh of this.meshes) mesh.isVisible = visible;
    if (!visible || !(dt > 0)) return;
    this.spin = (this.spin + dt * 0.5) % (Math.PI * 2);
    this.applyBasis();
  }

  /**
   * Reconstrói a orientação a partir da base girada. Compor quaternions aqui exigiria decidir a
   * convenção de ordem do Babylon; girar a TANGENTE e remontar a base é o mesmo resultado sem
   * nenhuma ambiguidade — e não acumula erro porque parte sempre da tangente original.
   */
  private applyBasis(): void {
    const right = cross(this.axis, this.forward);
    const cos = Math.cos(this.spin), sin = Math.sin(this.spin);
    const forward = normalize({
      x: this.forward.x * cos + right.x * sin,
      y: this.forward.y * cos + right.y * sin,
      z: this.forward.z * cos + right.z * sin,
    }, this.forward);
    const q = quaternionFromBasis(cross(this.axis, forward), this.axis, forward);
    this.root.rotationQuaternion!.set(q.x, q.y, q.z, q.w);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes) mesh.dispose();
    this.meshes.length = 0;
    this.root.dispose();
  }
}

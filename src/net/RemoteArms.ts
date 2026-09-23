import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { CharacterVisual } from '../animation/CharacterVisual';
import { PrismRig } from '../combat/PrismRig';
import { SmgRig } from '../combat/SmgRig';
import { PLAYER_CLASSES, type PlayerClassId } from '../run/PlayerClass';

/**
 * A ARMA NA MÃO DO OUTRO JOGADOR.
 *
 * O `RemotePlayers` desenhava só o CORPO: a arma do jogador local mora em `DualPistols`/`PrismRig`/
 * `SmgRig`, que a cena monta uma vez, para ela mesma. O companheiro aparecia de mãos vazias e o tiro
 * dele era um coice de braço sem nada no braço.
 *
 * Aqui a arma é só APRESENTAÇÃO — munição, dano e balística seguem no servidor. A classe viaja no
 * `PlayerState` (`classId`), então cada tela escolhe a mesma arma sem mensagem nova. Os dois rigs
 * de rifle já recebem um `CharacterVisual` qualquer e resolvem grip e ossos pela instância, não pela
 * cena — por isso funcionam num segundo boneco sem tocar neles.
 */
export type RemoteWeapon = 'pistols' | 'prism' | 'smg';

/** Volume da PRISM de quem não sou eu: presente, mas abaixo da minha. */
const REMOTE_VOLUME = .25;

export function remoteWeaponFor(classId: PlayerClassId | undefined): RemoteWeapon {
  return classId ? PLAYER_CLASSES[classId].weapon as RemoteWeapon : 'pistols';
}

export class RemoteArms {
  private rig: PrismRig | SmgRig | undefined;
  private pistols: TransformNode[] = [];
  private pistolAsset: AssetContainer | undefined;
  private disposed = false;

  constructor(private readonly scene: Scene, private readonly visual: CharacterVisual, readonly weapon: RemoteWeapon) {
    if (weapon === 'prism') {
      const rig = new PrismRig(scene, visual); this.rig = rig;
      void rig.load().then(() => { if (!this.disposed) { rig.setVolume(REMOTE_VOLUME); rig.enabled = true; } }).catch(() => {});
      rig.enabled = true;
    } else if (weapon === 'smg') {
      const rig = new SmgRig(scene, visual); this.rig = rig;
      void rig.load().then(() => { if (!this.disposed) rig.enabled = true; }).catch(() => {});
      rig.enabled = true;
    } else {
      void this.loadPistols();
    }
  }

  private async loadPistols(): Promise<void> {
    try {
      const asset = await LoadAssetContainerAsync('/models/pistol.glb', this.scene);
      if (this.disposed) { asset.dispose(); return; }
      this.pistolAsset = asset;
      for (let side = 0; side < 2; side++) {
        const root = new TransformNode(`remote-pistol-${side}`, this.scene);
        const instance = asset.instantiateModelsToScene(name => `remote-pistol-${side}-${name}`, false, { doNotInstantiate: true });
        for (const node of instance.rootNodes) node.parent = root;
        for (const node of instance.rootNodes) for (const mesh of node.getChildMeshes()) { mesh.isPickable = false; mesh.receiveShadows = true; }
        this.pistols.push(root);
      }
    } catch { /* sem pistola o boneco segue: a arma é enfeite do remoto, não regra */ }
  }

  /** Um tiro visto pela queda da munição. As pistolas alternam a mão; os rifles tocam o próprio clipe. */
  fire(side: 0 | 1): void {
    if (this.rig) this.rig.fire();
    else this.visual.fire(side);
  }

  /** Depois do `visual.update`: a pose de braço do rifle é aplicada por cima da animação. */
  update(dt: number, reloadProgress: number): void {
    if (this.rig) {
      this.rig.reload(reloadProgress);
      this.rig.update(dt);
      return;
    }
    for (let side = 0; side < this.pistols.length; side++) {
      const root = this.pistols[side]!, grip = this.visual.grips[side];
      root.setEnabled(this.visual.ready && !!grip);
      if (!grip) continue;
      root.parent = grip; root.position.setAll(0); root.rotationQuaternion = Quaternion.Identity();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.rig?.dispose();
    for (const root of this.pistols) root.dispose(false, true);
    this.pistols.length = 0;
    this.pistolAsset?.dispose();
  }
}

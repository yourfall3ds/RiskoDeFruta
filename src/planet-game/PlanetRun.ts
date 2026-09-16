import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {CreatePlane} from '@babylonjs/core/Meshes/Builders/planeBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Quaternion} from '@babylonjs/core/Maths/math.vector';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {Scene} from '@babylonjs/core/scene';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type {Vec3} from '../core/contracts';
import type {RandomStream} from '../core/RunRNG';
import {PERK_ICONS} from '../ui/PerkIcons';
import type {ItemDefinition, RunProgression} from '../run/RunProgression';
import {rollApplicableItem} from './PlanetItems';
import {PlanetFrame, add, anyPerpendicular, cross, length, normalize, quaternionFromBasis, scale, sub} from '../planet/PlanetFrame';
import type {PlanetCollision} from '../planet/PlanetCollision';
import type {IslandRecord} from './PlanetManifest';
import {findIslandSpawn, islandSamples, probeSpawn, SPAWN_DEFAULTS, type SpawnProbe} from './PlanetSpawn';

/**
 * Baús, itens e o que sobrevive à troca de estágio.
 *
 * `RunProgression` (inventário, nível, XP, créditos, `advanceStage`) é usado INTEIRO e sem cópia —
 * ele já é puro. O que este arquivo acrescenta é a colocação no referencial radial: baú no convés
 * com a tampa para fora do planeta, carta do item em pé sobre a vertical local, e coleta medida no
 * plano tangente. A lista de itens que esta cena realmente aplica vive em `PlanetItems`, que é
 * puro e testável sem Babylon.
 */
export const CHEST_TUNING = {
  /** Custo em créditos para abrir. */
  cost: 25,
  /** Alcance do `E`. */
  reachMetres: 3.2,
  /** Alcance de coleta da carta caída. */
  pickupMetres: 2.2,
  /** Baús por ilha semeada. */
  perIsland: 2,
} as const;

interface PlanetChest {
  readonly root: TransformNode;
  readonly position: Vec3;
  readonly up: Vec3;
  readonly meshes: AbstractMesh[];
  opened: boolean;
}

interface PlanetLoot {
  readonly item: ItemDefinition;
  readonly root: TransformNode;
  readonly position: Vec3;
  readonly up: Vec3;
  age: number;
}

export class PlanetRun {
  readonly chests: PlanetChest[] = [];
  readonly loot: PlanetLoot[] = [];
  ready = false;
  error = '';
  private container: AssetContainer | undefined;
  private readonly materials = new Map<number, StandardMaterial>();
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly frame: PlanetFrame,
    private readonly collision: PlanetCollision,
    readonly progression: RunProgression,
    private readonly rng: RandomStream,
    private readonly shadows?: ShadowGenerator,
  ) {}

  async load(url = '/models/interactive-chest.glb'): Promise<void> {
    try {
      const container = await LoadAssetContainerAsync(url, this.scene);
      if (this.disposed) {container.dispose(); return;}
      this.container = container;
      this.ready = true;
    } catch (error) {
      if (!this.disposed) this.error = error instanceof Error ? error.message : 'Falha ao carregar o baú';
    }
  }

  /**
   * Semeia baús numa ilha, sempre sobre apoio validado.
   *
   * Sem sonda o baú pousaria na altura nominal do convés e ficaria enterrado ou flutuando — o
   * relevo autoral varia dezenas de metros dentro da mesma ilha.
   */
  plantChests(island: IslandRecord, count: number = CHEST_TUNING.perIsland): number {
    if (!this.ready) return 0;
    const options = {...SPAWN_DEFAULTS, height: 1.4, requirePlatform: false};
    // Separação proporcional à pegada: um valor fixo de 14 m planta um baú só numa ilha de 10 m.
    // O planeta está sendo reautorado com mais ilhas e menores — nada aqui pode assumir tamanho.
    const separation = Math.max(4, Math.min(14, island.radius * 0.45));
    let planted = 0;
    const samples = [...islandSamples(island, 48, island.radius * 0.75)];
    // Embaralha pela semente da partida: baú no mesmo canto toda vez não é exploração.
    for (let i = samples.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      const swap = samples[i]!; samples[i] = samples[j]!; samples[j] = swap;
    }
    for (const candidate of samples) {
      if (planted >= count) break;
      const probe = probeSpawn(this.collision, this.frame, candidate, options);
      if (!probe) continue;
      if (this.chests.some(chest => length(sub(chest.position, probe.position)) < separation)) continue;
      this.place(probe);
      planted++;
    }
    if (planted === 0) {
      // A ilha inteira reprovou a varredura: tenta o mesmo ponto que o jogador usaria.
      const probe = findIslandSpawn(this.collision, this.frame, island, options);
      if (probe) {this.place(probe); planted = 1;}
    }
    return planted;
  }

  private place(probe: SpawnProbe): void {
    const root = new TransformNode(`planet-chest-${this.chests.length}`, this.scene);
    root.position.set(probe.position.x, probe.position.y, probe.position.z);
    const forward = anyPerpendicular(probe.up);
    const q = quaternionFromBasis(cross(probe.up, forward), probe.up, forward);
    root.rotationQuaternion = new Quaternion(q.x, q.y, q.z, q.w);
    const meshes: AbstractMesh[] = [];
    const instance = this.container?.instantiateModelsToScene(name => `chest-${this.chests.length}-${name}`, false, {doNotInstantiate: false});
    for (const node of instance?.rootNodes ?? []) {
      node.parent = root;
      for (const mesh of node.getChildMeshes()) {
        mesh.isPickable = false; mesh.receiveShadows = true; meshes.push(mesh);
        this.shadows?.addShadowCaster(mesh);
      }
    }
    this.chests.push({root, position: probe.position, up: probe.up, meshes, opened: false});
  }

  /** Baú fechado ao alcance do `E`, se houver. */
  chestNear(position: Vec3): PlanetChest | undefined {
    return this.chests.find(chest => !chest.opened && length(sub(chest.position, position)) <= CHEST_TUNING.reachMetres);
  }

  /**
   * Abre o baú mais próximo. Devolve a mensagem do HUD ou `undefined` quando não havia baú.
   * Sem crédito, o baú continua fechado — não existe abertura de cortesia.
   */
  openChest(position: Vec3): string | undefined {
    const chest = this.chestNear(position);
    if (!chest) return undefined;
    if (this.progression.credits < CHEST_TUNING.cost) {
      return `Baú trancado · ${CHEST_TUNING.cost} créditos (você tem ${Math.floor(this.progression.credits)})`;
    }
    this.progression.credits -= CHEST_TUNING.cost;
    chest.opened = true;
    for (const mesh of chest.meshes) mesh.isVisible = false;
    const item = this.rollItem();
    this.dropLoot(item, chest.position, chest.up);
    return `${item.name} caiu do baú`;
  }

  /** Só itens cujo atributo esta cena aplica de verdade. Ver `PlanetItems`. */
  rollItem(): ItemDefinition {return rollApplicableItem(() => this.rng.next());}

  /** Carta do item em pé sobre a vertical local, com o ícone autoral do catálogo. */
  dropLoot(item: ItemDefinition, origin: Vec3, up: Vec3): void {
    let material = this.materials.get(item.icon);
    if (!material) {
      material = new StandardMaterial(`planet-loot-${item.icon}`, this.scene);
      const texture = new Texture(`/perks/${PERK_ICONS[item.icon] ?? PERK_ICONS[0]}`, this.scene);
      texture.hasAlpha = true;
      material.diffuseTexture = texture;
      material.useAlphaFromDiffuseTexture = true;
      material.emissiveColor = new Color3(0.72, 0.72, 0.72);
      material.specularColor = Color3.Black();
      material.backFaceCulling = false;
      material.transparencyMode = StandardMaterial.MATERIAL_ALPHATESTANDBLEND;
      this.materials.set(item.icon, material);
    }
    const root = new TransformNode(`planet-loot-${item.id}-${this.loot.length}`, this.scene);
    const card = CreatePlane(`planet-loot-card-${this.loot.length}`, {size: 0.62}, this.scene);
    card.parent = root; card.material = material; card.isPickable = false;
    const position = add(origin, scale(up, 0.85));
    root.position.set(position.x, position.y, position.z);
    root.rotationQuaternion = Quaternion.Identity();
    this.loot.push({item, root, position, up, age: 0});
  }

  /** Item ao alcance, se houver. */
  lootNear(position: Vec3): PlanetLoot | undefined {
    return this.loot.find(drop => length(sub(drop.position, position)) <= CHEST_TUNING.pickupMetres);
  }

  /** Coleta por proximidade — sem tecla, como no jogo plano. Devolve o item pego. */
  collect(position: Vec3): ItemDefinition | undefined {
    const drop = this.lootNear(position);
    if (!drop) return undefined;
    this.loot.splice(this.loot.indexOf(drop), 1);
    drop.root.dispose();
    this.progression.addItem(drop.item.id);
    return drop.item;
  }

  /** Giro de leitura da carta em torno da vertical local. Apresentação pura. */
  render(dt: number, cameraPosition: Vec3): void {
    for (const drop of this.loot) {
      drop.age += dt;
      // A carta encara a câmera girando só sobre o `up` local: fica sempre legível e sempre em pé.
      const toCamera = sub(cameraPosition, drop.position);
      const forward = normalize(sub(toCamera, scale(drop.up, dotProduct(toCamera, drop.up))), anyPerpendicular(drop.up));
      const q = quaternionFromBasis(cross(drop.up, forward), drop.up, forward);
      drop.root.rotationQuaternion!.set(q.x, q.y, q.z, q.w);
      const bob = Math.sin(drop.age * 2.2) * 0.05;
      const p = add(drop.position, scale(drop.up, bob));
      drop.root.position.set(p.x, p.y, p.z);
    }
  }

  /**
   * Fim de estágio: inventário, nível e XP SOBREVIVEM; créditos viram XP e o campo é limpo.
   * É `RunProgression.advanceStage()` — o mesmo do jogo plano, sem cópia.
   */
  advanceStage(): void {
    this.progression.advanceStage();
    this.clearField();
  }

  /** Morte: a tentativa recomeça do zero, como num roguelike. */
  resetOnDeath(): void {
    this.progression.reset();
    this.clearField();
  }

  private clearField(): void {
    for (const chest of this.chests) chest.root.dispose();
    this.chests.length = 0;
    for (const drop of this.loot) drop.root.dispose();
    this.loot.length = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearField();
    for (const material of this.materials.values()) material.dispose(false, true);
    this.materials.clear();
    this.container?.dispose();
  }
}

const dotProduct = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

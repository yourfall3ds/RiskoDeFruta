import {ensureRagdollPhysics,addRagdollTerrain,activeRagdollPositions} from '../physics/RagdollWorld';
import type {Scene} from '@babylonjs/core/scene';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type {Vec3} from '../core/contracts';
import type {PlayerMotor} from '../player/PlayerMotor';
import {PlanetCollision} from '../planet/PlanetCollision';
import {PlanetFrame} from '../planet/PlanetFrame';
import {CollisionWorld} from '../physics/CollisionWorld';
import type {SurfaceFrame} from '../physics/SurfaceFrame';
import {PlanetGraph} from '../planet-game/PlanetGraph';
import {loadPlanetManifest, PlanetManifestError, type IslandRecord, type PlanetManifest} from '../planet-game/PlanetManifest';
import {PlanetWorldView} from '../planet-game/PlanetWorldView';
import {NO_DESTRUCTION, PlanetDestructionLedger, type DestructionPort} from '../planet-game/PlanetDestruction';
import {
  DestructionSystem, DestructionVisuals, materialDestructionAudio, parseDestructibles, type DestructibleRecord,
} from '../destruction';
import type {WeaponAudio} from '../audio/WeaponAudio';
import type {GameWorld, WorldSite} from './GameWorld';
import type {TrainingTarget} from './TrainingYard';

/**
 * O arquipélago esférico como MUNDO do jogo real.
 *
 * Não é uma cena e não tem laço de jogo: é só o mapa. Quem joga continua sendo `PlayerScene`, com
 * `DualPistols`, `EnemySwarm`, `MPCharge`, `RunProgression` e o resto exatamente como na fazenda.
 * A única coisa que este arquivo entrega ao jogo é um `SurfaceFrame` esférico e a lista de ilhas.
 *
 * O asset já vem em coordenadas globais (contrato do manifesto): aqui nada é rotacionado, escalado
 * ou reposicionado. Qualquer transformação a mais abriria emenda entre o que se vê e o que sustenta
 * o corpo.
 */
export class PlanetWorld implements GameWorld {
  readonly targets: TrainingTarget[] = [];
  ready = false;
  error = '';

  /**
   * O mesmo `CollisionWorld` que a fazenda usa, só que configurado para esfera.
   *
   * Ele nasce vazio (nenhuma caixa, nenhuma `GroundSurface` plana) e recebe o par
   * `PlanetFrame` + `PlanetCollision` em `configurePlanet`. Depois disso `collision.surface`
   * responde `kind === 'sphere'` e todo o jogo — motor, horda, armas, VFX — continua recebendo
   * exatamente o objeto que sempre recebeu.
   */
  readonly collision = new CollisionWorld();

  private manifestData: PlanetManifest | undefined;
  private frameValue: PlanetFrame | undefined;
  private readonly planetCollision = new PlanetCollision();
  private graphValue: PlanetGraph | undefined;
  private view: PlanetWorldView | undefined;
  private siteList: WorldSite[] = [];
  private disposed = false;

  /**
   * Destruição de cenário.
   *
   * O ledger existe SEMPRE — é ele quem guarda os intervalos de triângulo removidos (que a cópia da
   * navegação precisa receber) e quem acusa prop que quebrou na tela sem sair da colisão. A fachada
   * só entra quando o manifesto traz `destructibles`, que é o caso do build atual (520 registros).
   */
  private ledger: PlanetDestructionLedger | undefined;
  private destructionPort: DestructionPort = NO_DESTRUCTION;
  private destructionSystem: DestructionSystem | undefined;
  private destructionVisuals: DestructionVisuals | undefined;
  private destructionRecords: readonly DestructibleRecord[] = [];
  private destructionWarnings: readonly string[] = [];
  private destructionNote = 'sem cenário quebrável neste mapa';

  constructor(
    private readonly scene: Scene,
    private shadows: ShadowGenerator | undefined,
    private readonly audio: WeaponAudio,
  ) {}

  /**
   * A luz nasce DEPOIS do mundo (ela precisa da câmera, que precisa da colisão, que vem daqui).
   * Como a casca só é carregada de forma assíncrona, basta o gerador chegar antes do `load`
   * terminar para as ilhas entrarem como projetoras de sombra na primeira vez.
   */
  useShadows(shadows: ShadowGenerator): void {this.shadows = shadows;}

  // ---------------------------------------------------------------- contrato GameWorld

  /**
   * Antes de `load()` isto responde o referencial PLANO (o `CollisionWorld` ainda não foi
   * configurado). É correto e é de propósito: a cena monta objetos antes do manifesto chegar, e
   * um `throw` aqui só transformaria ordem de carregamento em falha. Depois de `configurePlanet`
   * o mesmo objeto passa a responder esférico, sem ninguém reassinar nada.
   */
  get surface(): SurfaceFrame {return this.collision.surface;}
  get sites(): readonly WorldSite[] {return this.siteList;}
  /** Grafo de ilhas e pontes. Rota longa, vizinhança e sorteio de destino saem daqui. */
  get graph(): PlanetGraph | undefined {return this.graphValue;}
  get frame(): PlanetFrame | undefined {return this.frameValue;}
  get collisionMesh(): PlanetCollision {return this.planetCollision;}
  get manifest(): PlanetManifest | undefined {return this.manifestData;}
  /** Porta de destruição já ligada ao ledger; é isto que a arma recebe. */
  get destructibles():readonly DestructibleRecord[] {return this.destructionRecords;}
  get destruction(): DestructionPort {return this.destructionPort;}

  /**
   * Material do piso sob o pé, para o som do passo.
   *
   * O planeta é uma sopa de triângulos sem id de material, então sem este gancho toda ilha e toda
   * ponte soariam `grass`. O manifesto sabe o que é convés e o que é ponte: fora de qualquer
   * pegada de ilha, quem está de pé está numa **ponte**, e ponte é madeira. É a mesma distinção
   * que a fazenda faz por `/bridge|plank|stair|wood/i` no id da superfície.
   */
  /**
   * Recorte de triângulos em volta de um ponto, em coordenadas de MUNDO.
   *
   * Existe para o cadáver articulado: a casca tem 1,75 M de triângulos e não há corpo estático de
   * Havok para ela, então o corpo físico do jogador leva consigo só o chão que importa. A varredura
   * é linear no manifesto e roda UMA vez por morte — não por quadro.
   */
  trianglePatch(centre: Vec3, radius: number): {positions: number[]; indices: number[]} | undefined {
    const patch=this.planetCollision.trianglesAround(centre,radius);
    return patch.indices.length?patch:undefined;
  }


  footingMaterialAt(p: Vec3): 'water' | 'wood' | 'concrete' | 'grass' | undefined {
    if (!this.graphValue) return undefined;
    return this.graphValue.islandAt(p) ? 'grass' : 'wood';
  }

  siteAt(p: Vec3): WorldSite | undefined {
    const island = this.graphValue?.islandAt(p);
    return island ? this.siteList.find(site => site.id === island.id) : undefined;
  }

  /**
   * Rota caminhável entre dois pontos, em metros de arco.
   *
   * Dentro da mesma ilha é o arco direto — o convés é contínuo por construção. Entre ilhas é a
   * soma dos vãos do grafo de pontes, que é o único caminho a pé que existe: `undefined` quando o
   * par não está ligado, e é essa recusa que impede o cálice cair numa ilha inalcançável.
   */
  routeLength(from: Vec3, to: Vec3): number | undefined {
    const graph = this.graphValue, frame = this.frameValue;
    if (!graph || !frame) return undefined;
    const a = graph.islandAt(from), b = graph.islandAt(to);
    if (!a || !b) return undefined;
    if (a.id === b.id) return frame.arcDistance(from, to);
    const route = graph.route(a.id, b.id);
    if (!route) return undefined;
    // As pontas contam: do corpo até a borda da ilha de partida e da borda da última até o destino.
    return route.length + frame.arcDistance(from, a.centre) + frame.arcDistance(b.centre, to);
  }

  async load(): Promise<void> {
    try {
      const manifest = await loadPlanetManifest();
      if (this.disposed) return;
      this.manifestData = manifest;
      const frame = this.frameValue = new PlanetFrame({
        centre: manifest.centre,
        surfaceRadius: manifest.radius,
        voidRadius: manifest.radius * 0.84,
        ceilingRadius: manifest.radius * 1.6,
        islandRadius: Math.max(...manifest.islands.map(island => island.radius), 1),
      });
      this.planetCollision.setGeometry(manifest.positions, manifest.indices);
      this.graphValue = new PlanetGraph(manifest);
      // A partir daqui `collision.surface.kind === 'sphere'` para todo mundo que já segura o
      // `CollisionWorld` — não existe segundo objeto para ninguém reassinar.
      this.collision.configurePlanet(frame, this.planetCollision);
      this.siteList = manifest.islands.map(toSite);

      this.view = new PlanetWorldView(this.scene, this.shadows);
      await this.view.load();
      if (this.disposed) return;
      if (this.view.error) {this.error = this.view.error; return;}

      await ensureRagdollPhysics(this.scene);
      if(this.disposed)return;
      this.installDestruction(manifest);
      this.ready = true;
    } catch (error) {
      if (this.disposed) return;
      this.error = error instanceof PlanetManifestError
        ? `${error.message}.`
        : error instanceof Error ? error.message : 'Falha desconhecida ao montar o planeta';
    }
  }

  /** O planeta é estático: não há região para carregar sob demanda. */
  async prepareVisit(): Promise<boolean> {return this.ready;}

  get regionStatus(): string {
    const graph = this.graphValue;
    return `Planeta · ${graph?.size ?? 0} ilhas · ${this.planetCollision.triangleCount} triângulos`
      + ` · ${this.destructionRecords.length} destrutíveis (${this.destructionNote})`
      + (this.ledger ? ` · ${this.ledger.readout()}` : '');
  }

  fixedUpdate(_dt: number, _player: PlayerMotor): void {
    // Sem streaming: a casca inteira está residente. O gancho existe para o contrato e para o dia
    // em que a carta de navegação por ilha precisar acompanhar o corpo.
  }

  private readonly corpsePatches=new Map<string,()=>void>();
  private patchMask=-1;
  update(dt: number): void {
    if(this.patchMask!==this.planetCollision.disabledCount){
      for(const release of this.corpsePatches.values())release();
      this.corpsePatches.clear();this.patchMask=this.planetCollision.disabledCount;
    }
    const needed=new Set<string>();
    for(const point of activeRagdollPositions(this.scene)){
      const x=Math.round(point.x/8)*8,y=Math.round(point.y/8)*8,z=Math.round(point.z/8)*8;
      const key=`${x}:${y}:${z}`;needed.add(key);
      if(!this.corpsePatches.has(key)){
        const patch=this.trianglePatch({x,y,z},16);
        if(patch)this.corpsePatches.set(key,addRagdollTerrain(this.scene,`planet-corpse-${key}`,patch));
      }
    }
    for(const [key,release] of this.corpsePatches)if(!needed.has(key)){release();this.corpsePatches.delete(key);}

    // Rachadura, caco e poeira andam no relógio de apresentação.
    this.destructionPort.update(dt);
  }

  /** Cenário inteiro de volta — nova tentativa e troca de ilha. */
  restoreScenery(): void {
    this.ledger?.restore();
    this.destructionPort.reset();
  }

  /** Intervalos de triângulo hoje removidos, para quem precisar invalidar rota. */
  destructionRanges(): readonly {start: number; count: number}[] {
    return this.ledger?.ranges ?? [];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for(const release of this.corpsePatches.values())release();
    this.corpsePatches.clear();
    this.destructionPort.dispose?.();
    this.destructionVisuals?.dispose();
    this.view?.dispose();
    this.targets.length = 0;
  }

  // ---------------------------------------------------------------- destruição

  /**
   * Liga os destrutíveis do manifesto (`version: 2`, 520 registros no build atual).
   *
   * Quem valida o formato é `parseDestructibles`, dono do tipo — inclusive recusando registro ruim
   * sem derrubar o mapa. A colisão entra pelo LEDGER e não direto, porque é ele quem sabe quais
   * intervalos saíram mesmo depois de a fachada esquecer; a ordem inversa deixaria colisão removida
   * sob prop visível, que é o defeito espelhado da "parede fantasma".
   */
  private installDestruction(manifest: PlanetManifest): void {
    this.ledger = new PlanetDestructionLedger(this.planetCollision);
    if (manifest.destructibles === undefined) {
      this.destructionNote = 'o mapa não declara cenário quebrável (manifesto versão 1)';
      return;
    }
    const parsed = parseDestructibles(manifest.destructibles, {
      centre: manifest.centre,
      triangleTotal: manifest.indices.length / 3,
    });
    if (parsed.records.length === 0) {
      this.destructionNote = parsed.warnings.length > 0
        ? `nenhum destrutível aceito · ${parsed.warnings[0]}`
        : 'lista de destrutíveis vazia';
      return;
    }
    const visuals = new DestructionVisuals(this.scene, {
      ...(this.view ? {root: this.view.root} : {}),
      // Centro presente ⇒ os cacos caem pela RADIAL, não pelo −Y do mundo.
      centre: manifest.centre,
      support: (point, up) => this.planetCollision.supportBelow(point, up, 0.6, 12)?.offset,
    });
    const system = new DestructionSystem({
      collision: this.ledger.collisionPort(),
      audio: materialDestructionAudio(this.audio),
      presentation: visuals,
    });
    system.register(parsed.records);
    this.destructionVisuals = visuals;
    this.destructionSystem = system;
    this.destructionRecords = parsed.records;
    this.destructionWarnings = [...parsed.warnings, ...system.warnings];
    this.destructionNote = `${system.registered} instalados`
      + (this.destructionWarnings.length > 0 ? ` · ${this.destructionWarnings.length} avisos` : '');
    const ledger = this.ledger;
    this.destructionPort = {
      hit: hit => ledger.record(system.hit(hit)),
      update: dt => system.update(dt),
      reset: () => system.resetAttempt(),
      dispose: () => visuals.dispose(),
    };
  }

  /** Diagnóstico do F1: quanto do cenário já foi ao chão. */
  get destructionStatus(): string {
    const system = this.destructionSystem;
    return `${this.destructionRecords.length} destrutíveis · ${this.destructionNote}`
      + (system ? ` · quebrados ${system.broken} · ${system.removedTriangles} tris fora` : '');
  }
}

const toSite = (island: IslandRecord): WorldSite => ({
  id: island.id, name: island.name, centre: island.centre, up: island.up, radius: island.radius,
});

import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { EntityStore } from '../core/EntityStore';
import { EventBus } from '../core/EventBus';
import type { Entity, GameEvents } from '../core/contracts';
import { Pool } from '../core/Pool';
import { RunRNG } from '../core/RunRNG';
import { AIScheduler } from '../ai/AIScheduler';
import { createFoundationContent, FOUNDATION_TUNING as tuning } from '../content/foundation';
import type { SceneModule } from '../engine/SceneLifecycle';

interface Probe { entity: Entity; mesh: Mesh; orbit: number; phase: number; speed: number }

/** TEMP_ASSET_REQUIRED: diagnostic geometry only, never player/enemy art. */
export class FoundationScene implements SceneModule {
  readonly scene: Scene;
  readonly instrumentation: SceneInstrumentation;
  readonly entities = new EntityStore();
  readonly events = new EventBus<GameEvents>();
  readonly ai = new AIScheduler();
  readonly content = createFoundationContent();
  readonly rng: RunRNG;
  readonly probePool: Pool<Mesh>;
  readonly probes: Probe[] = [];
  private time = 0;
  private disposed = false;

  constructor(engine: AbstractEngine, readonly seed: string) {
    this.rng = new RunRNG(seed);
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.055, 0.08, 0.12, 1);
    try {
      const camera = new ArcRotateCamera('diagnostic-camera', -Math.PI / 2, tuning.cameraBeta, tuning.cameraRadius, Vector3.Zero(), this.scene);
      camera.lowerRadiusLimit = 12; camera.upperRadiusLimit = 35;
      camera.lowerBetaLimit = 0.15; camera.upperBetaLimit = 1.5;
      camera.attachControl(engine.getRenderingCanvas(), true);
      const light = new HemisphericLight('diagnostic-light', new Vector3(0, 1, 0), this.scene);
      light.intensity = 0.85;
      const ground = CreateGround('technical-ground', { width: tuning.groundSize, height: tuning.groundSize }, this.scene);
      const groundMaterial = new StandardMaterial('ground-material', this.scene);
      groundMaterial.diffuseColor = Color3.FromHexString('#263641');
      groundMaterial.specularColor = Color3.Black();
      ground.material = groundMaterial; ground.freezeWorldMatrix(); ground.isPickable = false;
      const lines: Vector3[][] = [];
      for (let i = -12; i <= 12; i += 2) {
        lines.push([new Vector3(i, 0.01, -12), new Vector3(i, 0.01, 12)]);
        lines.push([new Vector3(-12, 0.01, i), new Vector3(12, 0.01, i)]);
      }
      const grid = CreateLineSystem('technical-grid', { lines }, this.scene);
      grid.color = Color3.FromHexString('#47616b'); grid.isPickable = false; grid.freezeWorldMatrix();
      const definition = this.content.get('debug_probe');
      const material = new StandardMaterial('probe-material', this.scene);
      material.diffuseColor = Color3.FromHexString(definition.color);
      material.specularColor = Color3.Black();
      this.probePool = new Pool(tuning.poolCapacity, () => {
        const mesh = CreateBox('pooled-probe', { size: definition.radius * 2 }, this.scene);
        mesh.material = material; mesh.isPickable = false;
        return mesh;
      }, mesh => { mesh.setEnabled(false); mesh.position.setAll(0); mesh.rotation.setAll(0); mesh.scaling.setAll(1); });
      const random = this.rng.stream('scene');
      for (let i = 0; i < tuning.probeCount; i++) {
        const orbit = random.range(tuning.minOrbit, tuning.maxOrbit);
        const phase = random.range(0, Math.PI * 2);
        const entity = this.entities.create(definition.id, { x: Math.cos(phase) * orbit, y: tuning.height, z: Math.sin(phase) * orbit });
        const mesh = this.probePool.acquire()!;
        mesh.setEnabled(true);
        const probe = { entity, mesh, orbit, phase, speed: definition.orbitSpeed };
        this.probes.push(probe);
        // Exercises cadence only; no enemy behavior is being implemented in M0.
        this.ai.add({ id: entity.id, distance: () => probe.orbit * 8, update: () => {} });
      }
      this.instrumentation = new SceneInstrumentation(this.scene);
      this.instrumentation.captureFrameTime = true;
      this.events.emit('StageStarted', { stageId: 'm0_foundation', seed });
    } catch (error) {
      this.scene.dispose();
      throw error;
    }
  }
  fixedUpdate(dt: number): void {
    this.time += dt;
    this.entities.beginTick();
    for (const probe of this.probes) {
      const angle = probe.phase + this.time * probe.speed;
      probe.entity.transform.current.x = Math.cos(angle) * probe.orbit;
      probe.entity.transform.current.z = Math.sin(angle) * probe.orbit;
    }
    this.ai.update(dt);
    this.entities.flushRemovals();
  }
  render(alpha: number): void {
    for (const probe of this.probes) {
      const { current, previous } = probe.entity.transform;
      probe.mesh.position.set(
        previous.x + (current.x - previous.x) * alpha,
        previous.y + (current.y - previous.y) * alpha,
        previous.z + (current.z - previous.z) * alpha,
      );
    }
    this.scene.render();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ai.clear(); this.events.clear(); this.entities.clear();
    this.probePool.releaseAll(); this.probes.length = 0;
    this.instrumentation.dispose(); this.scene.dispose();
  }
  getDebug() {const p=this.probePool.stats;return {entities:this.entities.size,aiJobs:this.ai.size,aiTicks:this.ai.totalTicks,poolActive:p.active,poolCapacity:p.capacity,poolPeak:p.peak,poolMisses:p.misses,definitions:this.content.size,listeners:this.events.listenerCount};}
  private paused=false;
  get isPaused():boolean {return this.paused;}
  setPaused(paused: boolean): void {this.paused=paused;}
  configure(_name: string,_value: number): void {}
}

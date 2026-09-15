import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { FoundationScene } from '../src/game/FoundationScene';

it('creates, simulates, renders and repeatedly disposes actual Babylon scenes without resource accumulation', () => {
  const engine = new NullEngine();
  const fingerprints: number[][] = [];
  try {
    for (let run = 0; run < 5; run++) {
      const scene = new FoundationScene(engine, 'repeatable');
      expect(engine.scenes.length).toBe(1);
      expect(scene.entities.size).toBe(12);
      expect(scene.probePool.stats.active).toBe(12);
      for (let tick = 0; tick < 120; tick++) scene.fixedUpdate(1 / 60);
      scene.render(0.5);
      fingerprints.push(scene.probes.map(probe => probe.entity.transform.current.x));
      scene.dispose(); scene.dispose();
      expect(scene.probePool.stats.active).toBe(0);
      expect(scene.ai.size).toBe(0);
      expect(engine.scenes.length).toBe(0);
    }
    for (const fingerprint of fingerprints) expect(fingerprint).toEqual(fingerprints[0]);
  } finally { engine.dispose(); }
});

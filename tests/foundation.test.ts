import { describe, expect, it } from 'vitest';
import { FixedLoop } from '../src/core/FixedLoop';
import { RunRNG } from '../src/core/RunRNG';
import { EventBus } from '../src/core/EventBus';
import type { GameEvents } from '../src/core/contracts';
import { Pool } from '../src/core/Pool';
import { EntityStore } from '../src/core/EntityStore';
import { AIScheduler, AI_TUNING } from '../src/ai/AIScheduler';
import { ContentRegistry } from '../src/content/ContentRegistry';
import { SceneLifecycle } from '../src/engine/SceneLifecycle';

describe('fixed simulation', () => {
  function run(fps: number): { ticks: number; distance: number } {
    let distance = 0;
    const loop = new FixedLoop(dt => { distance += 9 * dt; }, alpha => { expect(alpha).toBeGreaterThanOrEqual(0); expect(alpha).toBeLessThan(1); });
    for (let frame = 0; frame <= fps * 10; frame++) loop.frame(frame / fps);
    return { ticks: loop.tick, distance };
  }
  it('simulates the same ten seconds at 30, 60 and 144 render FPS', () => {
    for (const fps of [30, 60, 144]) {
      expect(run(fps).ticks).toBe(600);
      expect(run(fps).distance).toBeCloseTo(90, 8);
    }
  });
  it('limits catch-up and excludes time spent in a hidden tab', () => {
    const loop = new FixedLoop(() => {}, () => {});
    loop.frame(0); loop.frame(10);
    expect(loop.stepsLastFrame).toBe(5);
    expect(loop.droppedSeconds).toBeGreaterThan(9);
    loop.suspend(); loop.frame(1000);
    expect(loop.tick).toBe(5);
    loop.frame(1000 + 1 / 60); expect(loop.tick).toBe(6);
    loop.reset(); expect(loop.tick).toBe(0); expect(loop.droppedSeconds).toBe(0);
  });
});

describe('seeded runs', () => {
  it('reproduces a run and isolates loot from director and boss', () => {
    const first = new RunRNG('farm'); const second = new RunRNG('farm');
    for (let i = 0; i < 1000; i++) first.stream('loot').next();
    for (let i = 0; i < 50; i++) {
      expect(first.stream('director').next()).toBe(second.stream('director').next());
      expect(first.stream('boss').next()).toBe(second.stream('boss').next());
    }
    expect(new RunRNG('other').stream('scene').next()).not.toBe(new RunRNG('farm').stream('scene').next());
  });
});

describe('event ownership and content validation', () => {
  it('unsubscribes and cleans scene subscriptions', () => {
    const bus = new EventBus<GameEvents>(); const received: number[] = [];
    const off = bus.on('LevelUp', event => received.push(event.level));
    bus.emit('LevelUp', { entityId: 1, level: 2 }); off();
    bus.emit('LevelUp', { entityId: 1, level: 3 });
    expect(received).toEqual([2]); expect(bus.listenerCount).toBe(0);
    bus.on('LevelUp', () => {}); bus.clear(); expect(bus.listenerCount).toBe(0);
  });
  it('rejects invalid or duplicate content and freezes registered definitions', () => {
    const registry = new ContentRegistry<{ id: string; hp: number }>();
    registry.register({ id: 'test', hp: 10 });
    expect(() => registry.register({ id: 'test', hp: 20 })).toThrow();
    expect(() => registry.register({ id: '', hp: 20 })).toThrow();
    expect(() => registry.get('missing')).toThrow();
    expect(Object.isFrozen(registry.get('test'))).toBe(true);
  });
  it('does not let an old disposer remove new subscriptions after clear', () => {
    const bus = new EventBus<GameEvents>(); let calls = 0;
    const oldOff = bus.on('LevelUp', () => {});
    bus.clear();
    bus.on('LevelUp', () => { calls++; });
    oldOff();
    bus.emit('LevelUp', { entityId: 1, level: 2 });
    expect(calls).toBe(1);
  });
});

describe('entity and pooled resource lifecycle', () => {
  it('keeps an interpolation snapshot and removes entities only at the boundary', () => {
    const store = new EntityStore();
    const entity = store.create('probe', { x: 1, y: 2, z: 3 });
    store.beginTick(); entity.transform.current.x = 9;
    expect(entity.transform.previous.x).toBe(1);
    store.remove(entity.id); expect(store.size).toBe(1);
    const removed: number[] = []; store.flushRemovals(value => removed.push(value.id));
    expect(removed).toEqual([entity.id]); expect(store.size).toBe(0);
    expect(store.create('probe', { x: 0, y: 0, z: 0 }).id).not.toBe(entity.id);
  });
  it('resets reused objects, caps growth and rejects double or foreign releases', () => {
    let allocations = 0;
    const pool = new Pool(2, () => { allocations++; return { hp: 0, status: '' }; }, value => { value.hp = 100; value.status = ''; });
    const a = pool.acquire()!; const b = pool.acquire()!;
    a.hp = 1; a.status = 'burn';
    expect(pool.acquire()).toBeUndefined(); expect(allocations).toBe(2);
    pool.release(a);
    expect(() => pool.release(a)).toThrow();
    expect(() => pool.release({ hp: 1, status: '' })).toThrow();
    const reused = pool.acquire()!; expect(reused).toBe(a); expect(reused).toEqual({ hp: 100, status: '' });
    pool.release(b); pool.releaseAll();
    expect(pool.stats).toEqual({ capacity: 2, active: 0, peak: 2, misses: 1 });
  });
  it('replaces and disposes scenes once while retaining a scene after a failed factory', () => {
    const lifecycle = new SceneLifecycle(); let disposals = 0; let updates = 0;
    const factory = () => ({ fixedUpdate: () => { updates++; }, render: () => {}, dispose: () => { disposals++; } });
    lifecycle.replace(factory);
    expect(() => lifecycle.replace(() => { throw new Error('load failure'); })).toThrow();
    lifecycle.fixedUpdate(1 / 60); expect(updates).toBe(1); expect(disposals).toBe(0);
    lifecycle.replace(factory); expect(disposals).toBe(1);
    lifecycle.dispose(); lifecycle.dispose(); expect(disposals).toBe(2);
  });
});

describe('AI scheduling', () => {
  it('updates near units more frequently than far units', () => {
    const scheduler = new AIScheduler(); const counts = [0, 0, 0];
    [5, 40, 90].forEach((distance, id) => scheduler.add({ id, distance: () => distance, update: () => { counts[id] = counts[id]! + 1; } }));
    for (let i = 0; i < 600; i++) scheduler.update(1 / 60);
    expect(counts[0]).toBeGreaterThan(counts[1]! * 1.8);
    expect(counts[1]).toBeGreaterThan(counts[2]! * 2);
  });
  it('bounds a 300-job load without starving a job and clears on restart', () => {
    const scheduler = new AIScheduler(); const counts = new Array<number>(300).fill(0);
    counts.forEach((_, id) => scheduler.add({ id, distance: () => 2, update: () => { counts[id] = counts[id]! + 1; } }));
    for (let i = 0; i < 600; i++) { scheduler.update(1 / 60); expect(scheduler.ticksLastUpdate).toBeLessThanOrEqual(AI_TUNING.maxPerTick); }
    expect(Math.min(...counts)).toBeGreaterThan(40);
    scheduler.clear(); expect(scheduler.size).toBe(0); expect(scheduler.totalTicks).toBe(0);
  });
});

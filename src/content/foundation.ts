import { ContentRegistry } from './ContentRegistry';

export interface ProbeDefinition { id: string; radius: number; orbitSpeed: number; color: string }
export function createFoundationContent(): ContentRegistry<ProbeDefinition> {
  const registry = new ContentRegistry<ProbeDefinition>();
  registry.register({ id: 'debug_probe', radius: 0.35, orbitSpeed: 0.32, color: '#86bac9' });
  return registry;
}
export const FOUNDATION_TUNING = {
  probeCount: 12, poolCapacity: 24, minOrbit: 3, maxOrbit: 8, height: 0.65,
  cameraRadius: 21, cameraBeta: 0.9, groundSize: 24,
} as const;

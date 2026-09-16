/**
 * Porta única da navegação do planeta.
 *
 * Integração mínima (ver `.temp/planet-navigation-api.md` para o contrato completo):
 *
 * ```ts
 * const navigation = new PlanetNavigation(frame, collision, manifest);
 * while (!navigation.build(8).done) await nextFrame();      // fatiado, 8 ms por quadro
 * const points = navigation.path(actor.position, target);   // Vec3[] | undefined
 * const follower = new PathFollower(frame, points ?? []);
 * ```
 */
export {PlanetNavigation, surfacePoint} from './PlanetNavigation';
export {PathFollower} from './PathFollower';
export type {FollowStep} from './PathFollower';
export {NavProbe} from './NavProbe';
export type {FloorSample, LinkVerdict} from './NavProbe';
export {NavGraph} from './NavGraph';
export {NAV_BAKED_VERSION, NAV_DEFAULTS, resolveNavOptions} from './NavTypes';
export type {
  NavAccess, NavBaked, NavBridge, NavCollision, NavCoverage, NavFrame, NavIsland, NavManifest,
  NavOptions, NavPhase, NavProgress, NavRayHit, NavRoute, NavSnap, NavStats, NavSupport,
} from './NavTypes';

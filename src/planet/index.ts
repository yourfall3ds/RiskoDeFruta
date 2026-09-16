/**
 * Núcleo do planeta — porta única de integração.
 *
 * Contrato numérico e decisões em `.temp/planet-core-design.md`.
 * Nada aqui depende de `@babylonjs/*`, de `Scene` ou do estado do jogo atual:
 * o consumidor recebe posições, verticais, quaternions e poses, e aplica onde quiser.
 *
 * Receita mínima de integração:
 *
 * ```ts
 * const frame = new PlanetFrame(PLANET);
 * const collision = new PlanetCollision();
 * collision.setGeometry(mergedPositions, mergedIndices);      // mesmo formato de CollisionWorld
 *
 * for (const slot of PLANET_LAYOUT.islands) {
 *   const p = islandPlacementFor(frame, slot.id, deckOffset);
 *   node.position.set(p.position.x, p.position.y, p.position.z);
 *   node.rotationQuaternion = new Quaternion(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w);
 * }
 * for (const plan of PLANET_LAYOUT.bridges.filter(b => b.stage === 1)) {
 *   for (const m of bridgeSpanFor(frame, plan, {modules: 6}).modules) { ...mesma aplicação... }
 * }
 *
 * const motor = new PlanetMotor({frame, collision, spawn: frame.fromDirection({x:0,y:0,z:1}, 1)});
 * const camera = new PlanetCamera(frame, motor.position, {collision});
 *
 * // 60 Hz
 * camera.look(mouseDx, mouseDy, motor.up);
 * motor.fixedUpdate(dt, {x, z, jump, sprint}, camera.motorHeading);
 * const pose = camera.update(motor.position, dt);
 * babylonCamera.upVector.copyFrom(pose.up);
 * babylonCamera.position.copyFrom(pose.position);
 * babylonCamera.setTarget(pose.target);
 * characterRoot.rotationQuaternion = new Quaternion(motor.rotation.x, ..., motor.rotation.w);
 * ```
 */
export {
  PLANET, PlanetFrame, quaternionFromBasis, transport, rotateAbout,
  add, sub, scale, dot, cross, length, distance, normalize, reject, copy, v3, anyPerpendicular,
} from './PlanetFrame';
export type {PlanetConfig, SurfaceBasis, GeodesicStep, Quat} from './PlanetFrame';

export {PlanetCollision} from './PlanetCollision';
export type {RayHit, CapsuleHit, SupportSample} from './PlanetCollision';
export {capsuleTriangle, sweepCapsuleTriangle} from './OrientedCapsule';
export type {CapsuleContact, CapsuleSweep} from './OrientedCapsule';

export {PlanetMotor, PLANET_MOTOR_TUNING} from './PlanetMotor';
export type {PlanetInput, PlanetMotorTuning, PlanetMotorOptions, PlanetMotorListener} from './PlanetMotor';

export {PlanetCamera, PLANET_CAMERA_TUNING, tangentAngle, turnTangent} from './PlanetCamera';
export type {CameraPose, PlanetCameraTuning} from './PlanetCamera';

export {PLANET_LAYOUT, ISLAND_SLOTS, BRIDGE_SPANS, EQUATORIAL_LOOP, islandSlot} from './PlanetLayout';
export type {IslandSlot, IslandSlotId, BridgeSpanPlan} from './PlanetLayout';

export {islandPlacement, islandPlacementFor, bridgeSpan, bridgeSpanFor, arcPoints} from './PlanetTransform';
export type {Placement, BridgeOptions, BridgePath} from './PlanetTransform';

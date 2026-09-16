import {describe, expect, it} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {RadialCamera} from '../src/camera/RadialCamera';
import {PlanetFrame, dot} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';

const poles = [
  {x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:1,z:0},
  {x:0,y:-1,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1},
];

describe('original camera presentation on a radial world', () => {
  it('respects wall obstruction after increasing camera distance', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const frame = new PlanetFrame();
    const at = frame.fromDirection({x:0,y:1,z:0});
    const world = new PlanetCollision();
    world.setGeometry([-10,at.y-10,-1,10,at.y-10,-1,10,at.y+20,-1,-10,at.y+20,-1],[0,1,2,0,2,3]);
    const camera = new RadialCamera(scene,frame,at,world,{x:0,y:0,z:1});
    try {
      camera.preferredDistance=6;
      for(let i=0;i<60;i++) camera.update(at,0,0,1/60);
      expect(camera.camera.position.z).toBeGreaterThan(-.9);
    } finally {scene.dispose();engine.dispose();}
  });
  for (const pole of poles) it(`keeps rendered aim, local up and skill framing at ${JSON.stringify(pole)}`, () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const frame = new PlanetFrame();
    const at = frame.fromDirection(pole);
    const camera = new RadialCamera(scene, frame, at);
    try {
      camera.update(at,0,0,1/60);
      const check = () => {
        camera.camera.getViewMatrix(true);
        const renderedForward = camera.camera.getDirection(Vector3.Forward()).normalize();
        expect(Vector3.Dot(renderedForward,camera.forward)).toBeGreaterThan(.99999);
        const renderedUp = camera.camera.getDirection(Vector3.Up()).normalize();
        expect(dot(renderedUp,pole)).toBeGreaterThan(.7);
        expect([camera.camera.position.x,camera.camera.position.y,camera.camera.position.z]).toSatisfy(
          (values:number[]) => values.every(Number.isFinite),
        );
      };
      check();
      const before = {...camera.heading};
      camera.update(at,.3,0,1/60);
      expect(dot(before,camera.heading)).toBeLessThan(.999);
      expect(Math.abs(dot(camera.heading,pole))).toBeLessThan(1e-6);
      check();
      for (const tier of [1,2,3] as const) {
        camera.update(at,.3,0,1/60);
        camera.skillClose(at,0,tier,.5);
        check();
      }
      camera.update(at,.3,0,1/60);
      const standingFov = camera.camera.fov;
      camera.setSprint(true);
      for (let i=0;i<60;i++) camera.update(at,.3,0,1/60);
      expect(camera.camera.fov).toBeGreaterThan(standingFov);
      const beforeHit = camera.forward.clone();
      camera.hurt(1,-1);
      camera.update(at,.3,0,1/60);
      expect(Vector3.Distance(beforeHit,camera.forward)).toBeGreaterThan(.001);
      check();
    } finally {scene.dispose();engine.dispose();}
  });
});

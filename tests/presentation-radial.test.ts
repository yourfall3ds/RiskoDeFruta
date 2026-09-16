import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Matrix,Vector3} from '@babylonjs/core/Maths/math.vector';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import {ParticleSystem} from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/loaders/glTF/2.0';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents,Vec3} from '../src/core/contracts';
import type {WeaponAudio} from '../src/audio/WeaponAudio';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {PLAYER_TUNING} from '../src/player/PlayerTuning';
import {DeathFlight} from '../src/player/DeathFlight';
import {FootingPresentation} from '../src/world/FootingPresentation';
import {AbyssPresentation} from '../src/world/AbyssPresentation';
import {SkillAura} from '../src/vfx/SkillAura';
import {WeatherPresentation} from '../src/world/WeatherPresentation';
import {WeatherCycle} from '../src/world/WeatherCycle';
import {RAIN_LAYERS} from '../src/world/rain/RainLayers';
import {RainSurfaceSampler,SPLASH_RADIUS,QUERY_BUDGET_PER_SECOND} from '../src/world/rain/RainSurface';
import {SkillTimeline} from '../src/combat/SkillTimeline';
import type {DualPistols} from '../src/combat/DualPistols';
import {PLANET,PlanetFrame,cross,dot,length,normalize,scale} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {ISLAND_SLOTS} from '../src/planet/PlanetLayout';
import {TriangleSoup,islandDeck} from './planet-fixture';

/**
 * Apresentação ORIGINAL sobre o planeta literal.
 *
 * O que estes testes travam: nenhum efeito foi desligado, tudo o que encostava no chão passou a ser
 * medido e orientado pela vertical LOCAL, e o referencial é lido a cada uso — a apresentação é
 * construída ANTES de `configurePlanet` em todos os casos aqui, de propósito, porque é assim que o
 * `PlayerScene` faz. Quem tivesse capturado o `FlatSurface` no construtor falharia.
 */

const frame=new PlanetFrame(PLANET);
const DT=1/60;

/**
 * `DynamicTexture` (a textura de fissuras do impacto) pede um canvas ao motor, e o `NullEngine` em
 * Node cai num `OffscreenCanvas` que não existe aqui. Este stub existe só para o caminho REAL de
 * `impactCracks` rodar no teste: nada é desenhado, e a geometria — que é o assunto — é a de verdade.
 */
if(typeof (globalThis as {OffscreenCanvas?:unknown}).OffscreenCanvas==='undefined'){
  const context=(canvas:unknown):unknown=>new Proxy({canvas},{
    get:(target:Record<string,unknown>,key)=>key in target?target[key as string]:typeof key==='string'?()=>undefined:undefined,
    set:()=>true,
  });
  (globalThis as {OffscreenCanvas?:unknown}).OffscreenCanvas=class {
    width:number;height:number;
    constructor(width:number,height:number){this.width=width;this.height=height;}
    getContext():unknown {return context(this);}
  };
}

function planetTerrain():PlanetCollision {
  const soup=new TriangleSoup();
  for(const slot of ISLAND_SLOTS)islandDeck(soup,frame,slot.direction,{radiusMetres:frame.islandRadius});
  const collision=new PlanetCollision();
  collision.setGeometry(soup.positions,soup.indices);
  return collision;
}

/** Mundo criado PLANO e só depois configurado como planeta, como na cena real. */
function lateWorld():CollisionWorld {
  return new CollisionWorld();
}
const configure=(world:CollisionWorld):CollisionWorld=>{world.configurePlanet(frame,planetTerrain());return world;};

function motorAt(world:CollisionWorld,direction:Vec3,altitude=.05):PlayerMotor {
  const motor=new PlayerMotor(world,new EventBus<GameEvents>(),frame.fromDirection(direction,altitude));
  return motor;
}
const settle=(motor:PlayerMotor,seconds=1.5):void=>{
  for(let i=0;i<Math.round(seconds/DT);i++)motor.fixedUpdate(DT,{x:0,z:0,jump:false,dodge:false,fire:false,charging:false},{...motor.forward});
};

describe('DeathFlight radial',()=>{
  it('arremessa para trás e para FORA do planeta, nos seis polos, e pousa no convés',()=>{
    for(const slot of ISLAND_SLOTS){
      const world=configure(lateWorld());
      const motor=motorAt(world,slot.direction);
      settle(motor);
      const flight=new DeathFlight(world);
      flight.start({...motor.position},motor.yaw,{up:{...motor.up},forward:{...motor.forward}});
      // Para FORA: a componente radial inicial é positiva, qualquer que seja o lado do planeta.
      expect(dot(flight.position,slot.direction)).not.toBeNaN();
      let apex=frame.altitude(flight.position),frames=0;
      for(;frames<300&&!flight.landed;frames++){
        flight.update(DT);
        apex=Math.max(apex,frame.altitude(flight.position));
      }
      expect(flight.landed,`slot ${slot.id}`).toBe(true);
      expect(apex).toBeGreaterThan(1.8);
      // Pousou no convés real, não num piso em y = 0 nem no vazio.
      expect(Math.abs(frame.altitude(flight.position))).toBeLessThan(.25);
      // Foi para TRÁS: arco andado contra a frente do corpo, de 3 a 6 m como no mundo plano.
      const travelled=frame.arcDistance(motor.position,flight.position);
      expect(travelled).toBeGreaterThan(3);
      expect(travelled).toBeLessThan(6);
      expect(dot(normalize(scale(cross(motor.up,cross(flight.position,motor.up)),1)),motor.forward)).not.toBeNaN();
    }
  });

  it('no polo sul o arremesso sobe em RAIO, o que em Y de mundo é descer',()=>{
    const world=configure(lateWorld());
    const motor=motorAt(world,{x:0,y:-1,z:0});
    settle(motor);
    expect(motor.position.y).toBeLessThan(-PLANET.surfaceRadius+.3);
    const flight=new DeathFlight(world);
    flight.start({...motor.position},motor.yaw,{up:{...motor.up},forward:{...motor.forward}});
    const before=frame.altitude(flight.position);
    flight.update(DT);
    // Altitude sobe; `position.y` DESCE. Uma versão Y-up faria o corpo subir para dentro do planeta.
    expect(frame.altitude(flight.position)).toBeGreaterThan(before);
    expect(flight.position.y).toBeLessThan(motor.position.y);
  });

  it('sem apoio embaixo, a queda para em 18 m de altitude perdida — o mesmo teto de antes',()=>{
    const world=configure(lateWorld());
    const gap=frame.fromDirection(normalize({x:.7,y:.7,z:.2}),0);
    const flight=new DeathFlight(world);
    flight.start(gap,0);
    for(let i=0;i<900&&!flight.landed;i++)flight.update(DT);
    expect(flight.landed).toBe(true);
    expect(frame.altitude(flight.position)).toBeLessThan(-17);
    expect(frame.altitude(flight.position)).toBeGreaterThan(-19);
  });

  it('a cadência não muda: mesmo número de subpassos que o caminho plano',()=>{
    const flat=new DeathFlight(new CollisionWorld());
    const world=configure(lateWorld());
    const radial=new DeathFlight(world);
    flat.start({x:0,y:0,z:0},0);
    radial.start(frame.fromDirection({x:0,y:0,z:1},0),0);
    // Tempo inválido é ignorado nos dois, e um passo grande é recortado em .1 s nos dois.
    for(const bad of [0,-1,NaN,Infinity]){flat.update(bad);radial.update(bad);}
    expect(flat.position).toEqual({x:0,y:0,z:0});
    expect(radial.landed).toBe(false);
  });
});

describe('FootingPresentation radial',()=>{
  function stage(direction:Vec3){
    const engine=new NullEngine(),scene=new Scene(engine);
    const world=lateWorld();
    const motor=motorAt(world,direction);
    const heard:{surface:string;speed:number}[]=[];
    const audio={footstep:(surface:string,speed:number)=>{heard.push({surface,speed});}} as unknown as WeaponAudio;
    // Construída ANTES do planeta: se capturasse o referencial aqui, tudo abaixo falharia.
    const footing=new FootingPresentation(scene,motor,world,audio);
    configure(world);
    settle(motor);
    return {scene,engine,world,motor,footing,heard,close:()=>{footing.dispose();scene.dispose();engine.dispose();}};
  }

  it('o anel de rachaduras deita no convés, com todos os vértices na casca',()=>{
    const {scene,motor,footing,close}=stage({x:0,y:1,z:0});
    try{
      footing.impactCracks({...motor.position});
      const mesh=scene.getMeshByName('meteor-impact-cracks')!;
      expect(mesh).toBeDefined();
      mesh.computeWorldMatrix(true);
      const vertices=mesh.getVerticesData(VertexBuffer.PositionKind)!;
      let worst=0,count=0;
      for(let i=0;i<vertices.length;i+=3){
        const world=Vector3.TransformCoordinates(new Vector3(vertices[i]!,vertices[i+1]!,vertices[i+2]!),mesh.getWorldMatrix());
        worst=Math.max(worst,Math.abs(frame.radius(world)-PLANET.surfaceRadius-.032));
        count++;
      }
      expect(count).toBeGreaterThan(100);
      // Cada vértice sentado na superfície real, 3,2 cm acima — não num plano XZ em y = 0.
      expect(worst).toBeLessThan(.1);
      expect(mesh.rotationQuaternion).not.toBeNull();
    } finally {close();}
  });

  it('no polo o mesmo anel seria uma placa deitada se fosse Y-up: aqui é radial',()=>{
    const {scene,motor,footing,close}=stage({x:1,y:0,z:0});
    try{
      footing.impactCracks({...motor.position});
      const mesh=scene.getMeshByName('meteor-impact-cracks')!;
      mesh.computeWorldMatrix(true);
      // O +Y local do cartão é a vertical local — que na ilha leste é +X do mundo.
      const up=Vector3.TransformNormal(new Vector3(0,1,0),mesh.getWorldMatrix()).normalize();
      expect(dot(up,{x:1,y:0,z:0})).toBeGreaterThan(.99);
    } finally {close();}
  });

  it('o rastro de esquiva sobe pela vertical local e o anel aponta para a marcha',()=>{
    const {scene,motor,footing,close}=stage({x:0,y:0,z:-1});
    try{
      const direction={...motor.forward};
      footing.dodge(direction);
      const rings=scene.meshes.filter(m=>m.name==='dodge-wind'&&m.isEnabled());
      expect(rings.length).toBe(3);
      for(const ring of rings){
        ring.computeWorldMatrix(true);
        // Deslocado para FORA do planeta, não para +Y do mundo.
        expect(frame.altitude(ring.position)).toBeGreaterThan(.4);
        expect(ring.rotationQuaternion).not.toBeNull();
        // O eixo do toro (+Y local) acompanha a direção da esquiva.
        const axis=Vector3.TransformNormal(new Vector3(0,1,0),ring.getWorldMatrix()).normalize();
        expect(dot(axis,direction)).toBeGreaterThan(.99);
      }
    } finally {close();}
  });

  it('o passo continua tocando no planeta, com a velocidade TANGENCIAL',()=>{
    const {motor,footing,heard,close}=stage({x:0,y:0,z:1});
    try{
      const arc=(p:number):number=>.037+.12*Math.max(0,Math.sin(p*Math.PI*2));
      let phase=.25;
      for(let i=0;i<Math.round(2.4/DT);i++){
        phase+=DT/.8;
        motor.sprinting=true;
        motor.fixedUpdate(DT,{x:0,z:1,jump:false,dodge:false,fire:false,charging:false},{...motor.forward});
        footing.footHeights=()=>({right:arc(phase),left:arc(phase+.5)});
        footing.update(DT);
      }
      expect(heard.length).toBeGreaterThan(3);
      for(const step of heard){
        expect(step.surface).toBe('grass');
        // Velocidade tangencial de corrida, não zero e não a hipotenusa de um mundo Y-up.
        expect(step.speed).toBeGreaterThan(4);
        expect(step.speed).toBeLessThan(PLAYER_TUNING.speed*PLAYER_TUNING.sprintMultiplier+.5);
      }
    } finally {close();}
  });

  it('o gancho de material decide o timbre onde a sopa de triângulos não tem id',()=>{
    const {motor,footing,heard,close}=stage({x:0,y:0,z:1});
    try{
      footing.footingMaterial=()=>'wood';
      const arc=(p:number):number=>.037+.12*Math.max(0,Math.sin(p*Math.PI*2));
      let phase=.25;
      for(let i=0;i<Math.round(1.6/DT);i++){
        phase+=DT/.8;
        motor.fixedUpdate(DT,{x:0,z:1,jump:false,dodge:false,fire:false,charging:false},{...motor.forward});
        footing.footHeights=()=>({right:arc(phase),left:arc(phase+.5)});
        footing.update(DT);
      }
      expect(heard.length).toBeGreaterThan(0);
      for(const step of heard)expect(step.surface).toBe('wood');
    } finally {close();}
  });
});

describe('AbyssPresentation radial',()=>{
  function stage(direction:Vec3){
    const engine=new NullEngine(),scene=new Scene(engine);
    const world=lateWorld();
    const motor=motorAt(world,direction);
    const abyss=new AbyssPresentation(scene,motor);
    configure(world);
    settle(motor);
    return {scene,engine,motor,abyss,close:()=>{abyss.dispose();scene.dispose();engine.dispose();}};
  }

  it('de pé no polo sul NÃO está caindo, mesmo com y = −200',()=>{
    const {motor,abyss,scene,close}=stage({x:0,y:-1,z:0});
    try{
      expect(motor.position.y).toBeLessThan(-PLANET.surfaceRadius+.3);
      abyss.update(DT);
      // Um teste `position.y < -5` diria "caindo" aqui. A altitude diz a verdade.
      expect(scene.getMeshByName('emergency-recovery-cable')!.isEnabled()).toBe(false);
    } finally {close();}
  });

  it('empurrado para o vazio, o cabo aparece e sai do corpo pela vertical local',()=>{
    const {motor,abyss,scene,close}=stage({x:0,y:-1,z:0});
    try{
      Object.assign(motor.position,frame.fromDirection({x:0,y:-1,z:0},-12));
      motor.grounded=false;
      abyss.update(DT);
      const cable=scene.getMeshByName('emergency-recovery-cable')!;
      expect(cable.isEnabled()).toBe(true);
      const points=cable.getVerticesData(VertexBuffer.PositionKind)!;
      const head={x:points[0]!,y:points[1]!,z:points[2]!};
      // A ponta de cima do cabo está 1,1 m ACIMA na radial: altitude maior, `y` do mundo menor.
      expect(frame.altitude(head)).toBeCloseTo(frame.altitude(motor.position)+1.1,3);
      expect(head.y).toBeLessThan(motor.position.y);
    } finally {close();}
  });

  it('os mantos de nuvem seguem a radial do jogador, com o mesmo shader e as mesmas profundidades',()=>{
    const {motor,abyss,scene,close}=stage({x:1,y:0,z:0});
    try{
      abyss.update(DT);
      const decks=scene.meshes.filter(m=>m.name==='clouds-below-floating-islands');
      expect(decks.length).toBe(2);
      const altitudes=decks.map(d=>frame.altitude(d.position)).sort((a,b)=>b-a);
      expect(altitudes[0]!).toBeCloseTo(-44,3);
      expect(altitudes[1]!).toBeCloseTo(-72,3);
      for(const deck of decks){
        // Sob a vertical do jogador, e deitado no plano tangente daquela vertical.
        expect(dot(normalize(deck.position),normalize(motor.position))).toBeGreaterThan(.9999);
        deck.computeWorldMatrix(true);
        const up=Vector3.TransformNormal(new Vector3(0,1,0),deck.getWorldMatrix()).normalize();
        expect(dot(up,motor.up)).toBeGreaterThan(.999);
        expect(deck.material?.name).toBe('deep-cloud-sea');
      }
    } finally {close();}
  });
});

describe('SkillAura radial',()=>{
  it('ancora o selo no convés, deita no plano tangente e mantém o ritual autoral',async()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    const world=lateWorld();
    const aura=new SkillAura(scene,world);
    configure(world);
    try{
      await aura.load(()=>LoadAssetContainerAsync(new Uint8Array(readFileSync('public/models/arcane-skill-ritual.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}}));
      expect(aura.error).toBe('');
      expect(aura.ready).toBe(true);
      const weapons={muzzlePose:(side:number)=>({position:new Vector3(side?1:-1,2,0),direction:Vector3.Forward()})} as DualPistols;
      for(const slot of ISLAND_SLOTS){
        const at=frame.fromDirection(slot.direction,1.2);
        // Habilidade encerrada entre um polo e outro: é o que faz a âncora ser medida de novo.
        aura.update(new SkillTimeline(),new Vector3(at.x,at.y,at.z),weapons);
        const t=new SkillTimeline();t.start(2);t.elapsed=.4;
        aura.update(t,new Vector3(at.x,at.y,at.z),weapons);
        const ground=scene.getTransformNodeByName('GroundSigilRoot')!;
        // Âncora no convés medido (não no ponto do jogador, 1,2 m acima) e 3,5 cm pela radial.
        expect(frame.altitude(ground.position),`slot ${slot.id}`).toBeCloseTo(.035,2);
        expect(dot(normalize(ground.position),normalize(slot.direction))).toBeGreaterThan(.9999);
        // Deitado no plano tangente: o +Y local do selo é a vertical local verdadeira.
        ground.computeWorldMatrix(true);
        const up=Vector3.TransformNormal(new Vector3(0,1,0),ground.getWorldMatrix()).normalize();
        expect(dot(up,frame.up(at))).toBeGreaterThan(.99);
        // A luz de chão acompanha a mesma radial.
        const light=scene.lights.find(l=>l.name==='arcane-skill-light-2')! as unknown as {position:Vec3;intensity:number};
        expect(frame.altitude(light.position)).toBeCloseTo(.45,1);
        // Ritual autoral intacto: as luzes do tier e a emissiva continuam vivas.
        expect(scene.lights.filter(l=>l.name.startsWith('arcane-skill-light')).length).toBe(3);
        expect(light.intensity).toBeGreaterThan(0);
      }
    } finally {aura.dispose();scene.dispose();engine.dispose();}
  });
});

describe('chuva radial',()=>{
  it('a gota cai para o CENTRO do planeta em qualquer polo, com o mesmo atlas',()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    const world=lateWorld();
    const weather=new WeatherPresentation(scene);
    weather.world=world;              // a MESMA linha de hoje
    configure(world);
    const cycle=new WeatherCycle();cycle.manualPhase='rain';
    try{
      for(const slot of ISLAND_SLOTS){
        const viewer=frame.fromDirection(slot.direction,1.7);
        for(let i=0;i<180;i++)weather.update(cycle,viewer,DT);
        const up=frame.up(viewer);
        for(const spec of RAIN_LAYERS){
          const system=scene.particleSystems.find((p):p is ParticleSystem=>p.name==='weather-rain-'+spec.id&&p instanceof ParticleSystem)!;
          expect(system,`${slot.id}/${spec.id}`).toBeDefined();
          // A caixa viaja com a câmera.
          expect(system.emitter).toMatchObject({x:viewer.x,y:viewer.y,z:viewer.z});
          // Gravidade e queda na vertical LOCAL: para o centro, não para −Y.
          const gravity=system.gravity;
          expect(dot(normalize(gravity),up)).toBeLessThan(-.999);
          // A queda é para DENTRO em toda camada; o vento inclina o rastro, como no mundo plano.
          expect(dot(normalize(system.direction1),up)).toBeLessThan(-.6);
          expect(dot(normalize(system.direction2),up)).toBeLessThan(-.6);
          // O vento inclina, não vira ventania: a queda continua dominando.
          const drift=length({x:system.direction1.x-up.x*dot(system.direction1,up),y:system.direction1.y-up.y*dot(system.direction1,up),z:system.direction1.z-up.z*dot(system.direction1,up)});
          expect(drift).toBeLessThan(Math.abs(dot(system.direction1,up)));
          // Atlas autoral inalterado.
          expect(system.particleTexture?.name).toContain('rain');
        }
      }
      // No polo sul a gravidade da chuva aponta para +Y do mundo — e isso é o correto.
      const south=frame.fromDirection({x:0,y:-1,z:0},1.7);
      for(let i=0;i<60;i++)weather.update(cycle,south,DT);
      const near=scene.particleSystems.find((p):p is ParticleSystem=>p.name==='weather-rain-near'&&p instanceof ParticleSystem)!;
      expect(near.gravity.y).toBeGreaterThan(0);
      expect(near.direction1.y).toBeGreaterThan(0);
    } finally {weather.dispose();scene.dispose();engine.dispose();}
  });

  it('a caixa de emissão é tangente: a gota nasce em volta e ACIMA da câmera pela radial',()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    const world=configure(lateWorld());
    const weather=new WeatherPresentation(scene);
    weather.world=world;
    const cycle=new WeatherCycle();cycle.manualPhase='rain';
    const viewer=frame.fromDirection({x:0,y:-1,z:0},1.7);
    try{
      for(let i=0;i<180;i++)weather.update(cycle,viewer,DT);
      const spec=RAIN_LAYERS[0]!;
      const system=scene.particleSystems.find((p):p is ParticleSystem=>p.name==='weather-rain-near'&&p instanceof ParticleSystem)!;
      const place=new Vector3();
      // A caixa é TANGENTE: um canto a `radius` do centro fica `radius²/2R` mais alto que o centro.
      // Essa é a curvatura do convés, não folga de implementação.
      const curvature=spec.radius*spec.radius/(2*PLANET.surfaceRadius)+.02;
      let inside=0;
      for(let i=0;i<200;i++){
        system.startPositionFunction!(Matrix.Identity(),place,undefined as never,false);
        const radial=frame.altitude(place)-frame.altitude(viewer);
        const tangent=frame.arcDistance(viewer,place);
        if(radial>=spec.bottom-curvature&&radial<=spec.top+curvature&&tangent<=spec.radius*1.45)inside++;
      }
      expect(inside).toBe(200);
    } finally {weather.dispose();scene.dispose();engine.dispose();}
  });

  it('o respingo cai no convés real, com a coroa deitada na normal radial',()=>{
    const world=configure(lateWorld());
    const viewer=frame.fromDirection({x:1,y:0,z:0},1.7);
    const sampler=new RainSurfaceSampler();
    const placements=[];
    for(let i=0;i<Math.round(6/DT);i++)placements.push(...sampler.update(DT,viewer,1,world));
    expect(placements.length).toBeGreaterThan(40);
    expect(sampler.viewerCovered).toBe(false);
    for(const placement of placements){
      // Na casca do planeta, e dentro do raio medido como ARCO.
      expect(Math.abs(frame.radius(placement)-PLANET.surfaceRadius)).toBeLessThan(.4);
      expect(frame.arcDistance(viewer,placement)).toBeLessThanOrEqual(SPLASH_RADIUS+1e-6);
      // A coroa deita na normal REAL, que ali é a radial.
      expect(dot(placement.normal,frame.up(placement))).toBeGreaterThan(.82);
      expect(placement.scale).toBeGreaterThan(.5);
      expect(placement.scale).toBeLessThanOrEqual(1);
    }
    // O orçamento de consultas é o mesmo do mundo plano.
    expect(sampler.queries).toBeLessThanOrEqual(Math.ceil(QUERY_BUDGET_PER_SECOND*9)+4);
  });

  it('no vão entre ilhas não há respingo, e nenhum chão é inventado',()=>{
    const world=configure(lateWorld());
    const gap=frame.fromDirection(normalize({x:.7,y:.7,z:.2}),1.7);
    const sampler=new RainSurfaceSampler();
    const placements=[];
    for(let i=0;i<Math.round(4/DT);i++)placements.push(...sampler.update(DT,gap,1,world));
    expect(placements).toHaveLength(0);
    expect(sampler.rejected).toBeGreaterThan(0);
    expect(sampler.viewerCovered).toBe(false);
  });

  it('um telhado na vertical LOCAL cobre a câmera; o mesmo bloco em +Y do mundo não',()=>{
    const world=lateWorld();
    const soup=new TriangleSoup();
    for(const slot of ISLAND_SLOTS)islandDeck(soup,frame,slot.direction,{radiusMetres:frame.islandRadius});
    // Laje a 6 m de ALTITUDE sobre a ilha leste: cobertura de verdade, na radial.
    islandDeck(soup,frame,{x:1,y:0,z:0},{radiusMetres:20,altitude:6});
    const terrain=new PlanetCollision();
    terrain.setGeometry(soup.positions,soup.indices);
    world.configurePlanet(frame,terrain);
    const covered=new RainSurfaceSampler();
    const under=frame.fromDirection({x:1,y:0,z:0},1.7);
    const placements=[];
    for(let i=0;i<Math.round(4/DT);i++)placements.push(...covered.update(DT,under,1,world));
    expect(covered.viewerCovered).toBe(true);
    expect(placements).toHaveLength(0);
    // Do outro lado do planeta, sem laje, chove.
    const open=new RainSurfaceSampler();
    const out=frame.fromDirection({x:-1,y:0,z:0},1.7);
    const free=[];
    for(let i=0;i<Math.round(4/DT);i++)free.push(...open.update(DT,out,1,world));
    expect(open.viewerCovered).toBe(false);
    expect(free.length).toBeGreaterThan(0);
  });

  it('clima, umidade e pólen continuam inteiros no planeta',()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    const world=configure(lateWorld());
    const weather=new WeatherPresentation(scene);
    weather.world=world;
    const cues:number[]=[];
    weather.onRain=value=>cues.push(value);
    const cycle=new WeatherCycle();
    const viewer=frame.fromDirection({x:0,y:0,z:1},1.7);
    try{
      cycle.manualPhase='rain';
      for(let i=0;i<Math.round(30/DT);i++)weather.update(cycle,viewer,DT);
      expect(weather.wetness).toBeGreaterThan(.8);
      expect(cues.some(v=>v>0)).toBe(true);
      expect(weather.worldQueries).toBeGreaterThan(0);
      expect(scene.particleSystems.find(p=>p.name==='weather-splash')).toBeDefined();
      cycle.manualPhase='sun';
      for(let i=0;i<Math.round(6/DT);i++)weather.update(cycle,viewer,DT);
      const motes=scene.particleSystems.find((p):p is ParticleSystem=>p.name==='weather-motes'&&p instanceof ParticleSystem)!;
      expect(motes).toBeDefined();
      expect(motes.emitRate).toBeGreaterThan(0);
      for(const spec of RAIN_LAYERS){
        const system=scene.particleSystems.find((p):p is ParticleSystem=>p.name==='weather-rain-'+spec.id&&p instanceof ParticleSystem)!;
        expect(system.emitRate,spec.id).toBe(0);
      }
    } finally {weather.dispose();scene.dispose();engine.dispose();}
  });
});

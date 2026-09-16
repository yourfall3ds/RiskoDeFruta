import {describe,expect,it} from 'vitest';
import {Ray} from '@babylonjs/core/Culling/ray';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {RadialProps,type PropBox} from '../src/physics/RadialProps';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {PLAYER_TUNING as t} from '../src/player/PlayerTuning';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents,Vec3} from '../src/core/contracts';
import type {InputFrame} from '../src/input/InputFrame';
import {PLANET,PlanetFrame,add,dot,normalize,scale} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {ISLAND_SLOTS} from '../src/planet/PlanetLayout';
import {TriangleSoup,islandDeck} from './planet-fixture';

/**
 * Corpos compactos de runtime (baús, altares, cálice) ligados pelo hook COMPARTILHADO do
 * `CollisionWorld`, como o ROOT decidiu.
 *
 * O ponto da decisão: o `PlayerMotor` ORIGINAL lê `world.surface` por conta própria a cada passo.
 * Se o envoltório de props fosse montado na cena, o motor consultaria o `SphereSurface` cru e
 * atravessaria o baú. Aqui NADA na cena é remendado — os testes usam o motor original e o
 * `collision.surface` de verdade.
 */

const frame=new PlanetFrame(PLANET);
const DT=1/60;
const IDLE:InputFrame={x:0,z:0,jump:false,dodge:false,fire:false,charging:false};
const FORWARD:InputFrame={...IDLE,z:1};
/** Meias-extensões autoradas do baú, iguais às da `BoxCollider` da fazenda. */
const CHEST={x:.53,y:.34,z:.43};
const CHEST_TOP=CHEST.y*2;
const ISLAND:Vec3={x:0,y:0,z:1};

function planetTerrain():PlanetCollision {
  const soup=new TriangleSoup();
  for(const slot of ISLAND_SLOTS)islandDeck(soup,frame,slot.direction,{radiusMetres:frame.islandRadius});
  const collision=new PlanetCollision();
  collision.setGeometry(soup.positions,soup.indices);
  return collision;
}

/** Corpo com a vertical do planeta como `up`, exatamente como o `RunInteractables` monta. */
function chestBox(id:string,deck:Vec3,half=CHEST):PropBox {
  const up=frame.up(deck),basis=frame.basisAt(deck,{x:0,y:1,z:0});
  return {id,centre:add(deck,scale(up,half.y)),right:basis.right,up,forward:basis.forward,half};
}

const deckAt=(direction=ISLAND):Vec3=>frame.fromDirection(direction,0);
const headingAt=(p:Vec3):Vec3=>frame.basisAt(p,{x:0,y:1,z:0}).forward;
/** Ponto no convés a `metres` de arco à frente. */
const ahead=(from:Vec3,metres:number):Vec3=>frame.geodesicStep(from,scale(headingAt(from),metres)).position;

function motorAt(world:CollisionWorld,spawn:Vec3):PlayerMotor {
  return new PlayerMotor(world,new EventBus<GameEvents>(),spawn);
}
function drive(motor:PlayerMotor,seconds:number,input:InputFrame,sprint=false):void {
  for(let i=0;i<Math.round(seconds/DT);i++){
    if(sprint)motor.sprinting=true;
    motor.fixedUpdate(DT,input,{...motor.forward});
  }
}
/** Raio radial de cima para baixo sobre a coluna de um ponto do convés. */
function column(p:Vec3,altitude=5,length=12):Ray {
  const from=frame.atAltitude(p,altitude),down=frame.down(from);
  return new Ray(new Vector3(from.x,from.y,from.z),new Vector3(down.x,down.y,down.z),length);
}

interface Stage {world:CollisionWorld;planet:PlanetCollision;props:RadialProps;deck:Vec3;spot:Vec3}
/** Mundo do planeta com um baú 2,5 m à frente do centro da ilha, registrado como `'loot'`. */
function stage(attach=true):Stage {
  const world=new CollisionWorld(),planet=planetTerrain();
  world.configurePlanet(frame,planet);
  const deck=deckAt(),spot=ahead(deck,2.5);
  const props=new RadialProps();
  props.add(chestBox('chest-1',spot));
  if(attach)world.attachRadialProps('loot',props);
  return {world,planet,props,deck,spot};
}

describe('attachRadialProps — o PlayerMotor ORIGINAL fica em pé no baú',()=>{
  it('cai sobre o baú e para no TOPO dele, não no convés',()=>{
    const {world,spot}=stage();
    const motor=motorAt(world,frame.atAltitude(spot,3));
    drive(motor,3,IDLE);
    expect(motor.grounded).toBe(true);
    // 0,68 m: as meias-extensões autoradas do baú, medidas em ALTITUDE.
    expect(motor.altitude).toBeGreaterThan(CHEST_TOP-.08);
    expect(motor.altitude).toBeLessThan(CHEST_TOP+.08);
    // Não foi tratado como estar dentro de sólido: nenhum teleporte para o ponto seguro.
    expect(motor.solidRecoveries).toBe(0);
    expect(motor.respawns).toBe(0);
  });

  it('sem o registro, o MESMO motor atravessa e pousa no convés — é o defeito que isto corrige',()=>{
    const {world,spot}=stage(false);
    const motor=motorAt(world,frame.atAltitude(spot,3));
    drive(motor,3,IDLE);
    expect(motor.grounded).toBe(true);
    expect(Math.abs(motor.altitude)).toBeLessThan(.12);
  });

  it('em pé no baú o corpo não trava: dá para andar e cair dele',()=>{
    const {world,spot,deck}=stage();
    const motor=motorAt(world,frame.atAltitude(spot,3));
    drive(motor,2.5,IDLE);
    expect(motor.altitude).toBeGreaterThan(CHEST_TOP-.08);
    const from={...motor.position};
    motor.setHeading(headingAt(motor.position));
    drive(motor,2,FORWARD);
    // Saiu de cima do baú e voltou ao convés — nada de ficar preso na face de cima.
    expect(frame.arcDistance(from,motor.position)).toBeGreaterThan(1);
    expect(Math.abs(motor.altitude)).toBeLessThan(.15);
    expect(motor.solidRecoveries).toBe(0);
    void deck;
  });

  it('o apoio consultado pelo próprio collision.surface é o do baú',()=>{
    const {world,spot}=stage();
    const probe=frame.atAltitude(spot,.9);
    const support=world.surface.support(probe,.2,4,t.maxSlopeDegrees)!;
    expect(support).toBeDefined();
    expect(frame.altitude(support.point)).toBeCloseTo(CHEST_TOP,2);
    expect(dot(support.normal,frame.up(spot))).toBeGreaterThan(.99);
  });
});

describe('attachRadialProps — não se atravessa o baú de lado',()=>{
  it('andar para a frente encosta e para a um raio de cápsula da face',()=>{
    const {world,deck}=stage();
    const motor=motorAt(world,frame.fromDirection(ISLAND,.05));
    drive(motor,1,IDLE);
    motor.setHeading(headingAt(motor.position));
    drive(motor,3,FORWARD,true);
    const travelled=frame.arcDistance(deck,motor.position);
    // Baú a 2,5 m; a cápsula encosta a `half.z + radius` = 0,75 m dele ⇒ ~1,75 m de arco.
    expect(travelled).toBeGreaterThan(1.3);
    expect(travelled).toBeLessThan(2.2);
    // E NÃO subiu: 0,68 m é mais alto que o degrau jogável de 0,5 m.
    expect(motor.altitude).toBeLessThan(.3);
    expect(motor.grounded).toBe(true);
  });

  it('CONTATO SUSTENTADO: empurrar contra o baú por 6 s não fura a face em nenhum quadro',()=>{
    const {world,spot}=stage();
    const box=world.surface;void box;
    const chest=frame.geodesicStep(deckAt(),scale(headingAt(deckAt()),2.5)).position;
    const forward=headingAt(chest);
    const motor=motorAt(world,frame.fromDirection(ISLAND,.05));
    drive(motor,1,IDLE);
    motor.setHeading(headingAt(motor.position));
    let deepest=-Infinity;
    for(let i=0;i<Math.round(6/DT);i++){
      motor.sprinting=true;
      motor.fixedUpdate(DT,FORWARD,{...motor.forward});
      // Profundidade ao longo da frente do baú: negativa = ainda do lado de fora da face.
      deepest=Math.max(deepest,dot({x:motor.position.x-chest.x,y:motor.position.y-chest.y,z:motor.position.z-chest.z},forward));
    }
    // A face está a −0,43 do centro; a cápsula tem raio 0,32. Nunca cruzou a face.
    expect(deepest).toBeLessThan(-.43);
    // E não houve laço de teleporte por "dentro de sólido".
    expect(motor.solidRecoveries).toBe(0);
    expect(motor.respawns).toBe(0);
    expect(motor.grounded).toBe(true);
    void spot;
  });

  it('em pé AO LADO do baú não é estar enterrado; dentro dele é',()=>{
    const {world,spot}=stage();
    const surface=world.surface;
    // Cintura sobre a pegada do baú, pé no convés: NÃO é enterrado. Um teste que esticasse a caixa
    // pela meia-altura do corpo diria que é, e o motor teleportaria para o ponto seguro em laço.
    const beside=frame.geodesicStep(deckAt(),scale(headingAt(deckAt()),2.15)).position;
    expect(surface.insideSolid(beside,t.height)).toBe(false);
    // O centro do corpo, esse sim, está dentro.
    expect(surface.insideSolid(add(spot,scale(frame.up(spot),CHEST.y)),t.height)).toBe(true);
    // Longe do baú, nada.
    expect(surface.insideSolid(frame.fromDirection(ISLAND,.05),t.height)).toBe(false);
  });

  it('sem o registro o mesmo trajeto passa por cima do lugar do baú',()=>{
    const {world,deck}=stage(false);
    const motor=motorAt(world,frame.fromDirection(ISLAND,.05));
    drive(motor,1,IDLE);
    motor.setHeading(headingAt(motor.position));
    drive(motor,3,FORWARD,true);
    expect(frame.arcDistance(deck,motor.position)).toBeGreaterThan(4);
  });
});

describe('raycast radial inclui os corpos compactos',()=>{
  it('o raio encosta no topo do baú e devolve Vector3 radial',()=>{
    const {world,spot}=stage();
    const hit=world.raycast(column(spot))!;
    expect(hit).toBeDefined();
    expect(hit.point).toBeInstanceOf(Vector3);
    expect(hit.normal).toBeInstanceOf(Vector3);
    expect(frame.altitude(hit.point)).toBeCloseTo(CHEST_TOP,2);
    expect(dot(normalize(hit.normal),frame.up(spot))).toBeGreaterThan(.99);
    // O corpo ganha do convés porque está mais perto — e o convés continua respondendo ao lado.
    expect(hit.distance).toBeCloseTo(5-CHEST_TOP,1);
    expect(frame.altitude(world.raycast(column(ahead(spot,3)))!.point)).toBeCloseTo(0,1);
  });

  it('sem o registro o mesmo raio vai até o convés',()=>{
    const {world,spot}=stage(false);
    expect(frame.altitude(world.raycast(column(spot))!.point)).toBeCloseTo(0,1);
  });

  it('a varredura de esfera do mundo também vê o corpo',()=>{
    const {world,spot}=stage();
    const from=frame.atAltitude(ahead(spot,-1.4),.35);
    const heading=headingAt(from);
    const hit=world.surface.sweep(from,scale(heading,2),t.radius);
    expect(hit).toBeDefined();
    expect(hit!.time).toBeGreaterThan(0);
    expect(hit!.time).toBeLessThan(1);
    expect(hit!.id).toBe('chest-1');
  });
});

describe('cálice em registro SEPARADO',()=>{
  it('os dois registros são sólidos, e soltar um não solta o outro',()=>{
    const {world,spot}=stage();
    const cupSpot=ahead(spot,4);
    const chalice=new RadialProps();
    chalice.add(chestBox('chalice-body',cupSpot,{x:.45,y:.55,z:.45}));
    world.attachRadialProps('chalice',chalice);
    expect(world.radialPropRegistries).toEqual(['loot','chalice']);
    // Baú e cálice, cada um com a sua altura autorada.
    expect(frame.altitude(world.raycast(column(spot))!.point)).toBeCloseTo(CHEST_TOP,2);
    expect(frame.altitude(world.raycast(column(cupSpot))!.point)).toBeCloseTo(1.1,2);

    world.detachRadialProps('loot');
    expect(world.radialPropRegistries).toEqual(['chalice']);
    // O baú sumiu da colisão; o cálice continua sólido.
    expect(frame.altitude(world.raycast(column(spot))!.point)).toBeCloseTo(0,1);
    expect(frame.altitude(world.raycast(column(cupSpot))!.point)).toBeCloseTo(1.1,2);

    // E o motor original bate no cálice, pelo mesmo caminho compartilhado.
    const motor=motorAt(world,frame.atAltitude(ahead(cupSpot,-2.5),.05));
    drive(motor,1,IDLE);
    motor.setHeading(headingAt(motor.position));
    const start={...motor.position};
    drive(motor,3,FORWARD,true);
    const travelled=frame.arcDistance(start,motor.position);
    expect(travelled).toBeGreaterThan(1.2);
    expect(travelled).toBeLessThan(2.3);
  });

  it('desanexar um id que não existe é silencioso',()=>{
    const {world}=stage();
    const before=world.surface;
    world.detachRadialProps('nao-existe');
    expect(world.surface).toBe(before);
    expect(world.radialPropRegistries).toEqual(['loot']);
  });
});

describe('cache, registro vivo e zero reconstrução',()=>{
  it('o cache de surface é invalidado em attach e em detach',()=>{
    const {world,props}=stage(false);
    const bare=world.surface;
    expect(world.surface).toBe(bare);
    world.attachRadialProps('loot',props);
    const wrapped=world.surface;
    expect(wrapped).not.toBe(bare);
    // Registrar o MESMO par duas vezes não reconstrói nada.
    world.attachRadialProps('loot',props);
    expect(world.surface).toBe(wrapped);
    world.detachRadialProps('loot');
    expect(world.surface).not.toBe(wrapped);
  });

  it('o registro é VIVO: baú criado em tempo de execução já é sólido, sem re-attach',()=>{
    const {world,props,spot}=stage();
    const wrapped=world.surface;
    const late=ahead(spot,6);
    expect(frame.altitude(world.raycast(column(late))!.point)).toBeCloseTo(0,1);
    props.add(chestBox('chest-late',late));
    // Nada invalidado — é a MESMA instância de surface — e o corpo novo já responde.
    expect(world.surface).toBe(wrapped);
    expect(frame.altitude(world.raycast(column(late))!.point)).toBeCloseTo(CHEST_TOP,2);
    // E remover em tempo de execução também vale na hora.
    expect(props.remove('chest-late')).toBe(true);
    expect(frame.altitude(world.raycast(column(late))!.point)).toBeCloseTo(0,1);
  });

  it('nada da BVH do planeta é reconstruído, em nenhum momento',()=>{
    const {world,planet,props,spot}=stage();
    const triangles=planet.triangleCount;
    for(let i=0;i<200;i++)props.add(chestBox('bulk-'+i,ahead(spot,4+i*.1)));
    world.detachRadialProps('loot');
    world.attachRadialProps('loot',props);
    expect(planet.triangleCount).toBe(triangles);
    expect(world.planet?.collision).toBe(planet);
    // A malha do planeta continua fora do `CollisionWorld`: nenhuma cópia foi feita.
    expect(world.geometry).toBeUndefined();
    expect(world.hasTerrain).toBe(true);
    expect(props.count).toBe(201);
  });

  it('registrar ANTES de configurePlanet funciona: o registro sobrevive à configuração',()=>{
    const world=new CollisionWorld();
    const deck=deckAt(),spot=ahead(deck,2.5);
    const props=new RadialProps();
    props.add(chestBox('chest-1',spot));
    world.attachRadialProps('loot',props);
    expect(world.surface.kind).toBe('flat');
    world.configurePlanet(frame,planetTerrain());
    expect(world.radialPropRegistries).toEqual(['loot']);
    expect(frame.altitude(world.raycast(column(spot))!.point)).toBeCloseTo(CHEST_TOP,2);
  });

  it('id vazio é rejeitado em vez de virar um registro anônimo',()=>{
    const {world,props}=stage(false);
    expect(()=>world.attachRadialProps('',props)).toThrow();
    expect(world.radialPropRegistries).toEqual([]);
  });
});

describe('mundo plano intocado',()=>{
  it('registrar props num mundo plano não muda um número: movingBoxes continua o caminho',()=>{
    const world=new CollisionWorld();
    world.surfaces.push({id:'floor',x:0,z:0,width:60,depth:60,height:0});
    const props=new RadialProps();
    props.add({id:'flat-chest',centre:{x:2,y:CHEST.y,z:2},
      right:{x:1,y:0,z:0},up:{x:0,y:1,z:0},forward:{x:0,y:0,z:1},half:CHEST});
    world.attachRadialProps('loot',props);
    expect(world.surface.kind).toBe('flat');
    expect(world.radialPropRegistries).toEqual(['loot']);
    // O apoio a (2,2) continua sendo o piso, não o topo do corpo: props é só para a esfera.
    expect(world.groundAt(2,2)).toBe(0);
    expect(world.surface.support({x:2,y:1,z:2},1,Infinity)!.point.y).toBe(0);
    // E o raio plano não vê o corpo.
    expect(world.raycast(new Ray(new Vector3(2,4,2),new Vector3(0,-1,0),10))).toBeUndefined();
    // O caminho plano de caixa de runtime é o de sempre.
    world.movingBoxes.push({id:'moving-chest',min:{x:1.47,y:0,z:1.57},max:{x:2.53,y:CHEST_TOP,z:2.43}});
    expect(world.raycast(new Ray(new Vector3(2,4,2),new Vector3(0,-1,0),10))!.point.y).toBeCloseTo(CHEST_TOP,6);
  });

  it('o motor plano não sente os props registrados',()=>{
    const world=new CollisionWorld();
    world.surfaces.push({id:'floor',x:0,z:0,width:60,depth:60,height:0});
    const props=new RadialProps();
    props.add({id:'flat-chest',centre:{x:0,y:CHEST.y,z:2.5},
      right:{x:1,y:0,z:0},up:{x:0,y:1,z:0},forward:{x:0,y:0,z:1},half:CHEST});
    world.attachRadialProps('loot',props);
    const motor=motorAt(world,{x:0,y:0,z:0});
    drive(motor,1,IDLE);
    drive(motor,3,FORWARD,true);
    // Andou direto: no mundo plano quem barra é `movingBoxes`, e ele está vazio.
    expect(motor.position.z).toBeGreaterThan(4);
    expect(motor.position.y).toBe(0);
  });
});

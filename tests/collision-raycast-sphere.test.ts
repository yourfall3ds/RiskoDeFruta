import {describe,expect,it} from 'vitest';
import {Ray} from '@babylonjs/core/Culling/ray';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PLANET,PlanetFrame,distance,dot,normalize,scale,sub} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {ISLAND_SLOTS} from '../src/planet/PlanetLayout';
import {TriangleSoup,islandDeck} from './planet-fixture';

/**
 * O ROOT levantou que `configurePlanet` só trocava o referencial de superfície: `raycast` continuava
 * plano, e o portão de geometria do `DualPistols.worldPick` deixaria o terreno radial NÃO SÓLIDO
 * para as balas. Estes testes travam as duas coisas.
 */

const frame=new PlanetFrame(PLANET);

function planetCollision():PlanetCollision {
  const soup=new TriangleSoup();
  for(const slot of ISLAND_SLOTS)islandDeck(soup,frame,slot.direction,{radiusMetres:frame.islandRadius});
  const collision=new PlanetCollision();
  collision.setGeometry(soup.positions,soup.indices);
  return collision;
}

/** Raio da altitude 30 apontando para o CENTRO do planeta, sobre o slot dado. */
function inward(direction:{x:number;y:number;z:number},altitude=30):Ray {
  const from=frame.fromDirection(direction,altitude);
  const down=frame.down(from);
  return new Ray(new Vector3(from.x,from.y,from.z),new Vector3(down.x,down.y,down.z),altitude+60);
}

describe('CollisionWorld.raycast com backend de esfera',()=>{
  it('sem configurePlanet o raio é o de sempre e não existe terreno de planeta',()=>{
    const world=new CollisionWorld();
    expect(world.hasTerrain).toBe(false);
    expect(world.raycast(inward({x:0,y:0,z:1}))).toBeUndefined();
    world.setGeometry([-5,0,-5,5,0,-5,5,0,5,-5,0,5],[0,1,2,0,2,3]);
    world.prepareRaycasts();
    expect(world.hasTerrain).toBe(true);
    const hit=world.raycast(new Ray(new Vector3(0,4,0),new Vector3(0,-1,0),20));
    expect(hit).toBeDefined();
    expect(hit!.distance).toBeCloseTo(4,6);
    expect(hit!.point.y).toBeCloseTo(0,6);
  });

  it('no planeta o raio encosta no convés, com ponto e normal RADIAIS em Vector3',()=>{
    const world=new CollisionWorld();
    world.configurePlanet(frame,planetCollision());
    for(const slot of ISLAND_SLOTS){
      const hit=world.raycast(inward(slot.direction));
      expect(hit,`slot ${slot.id}`).toBeDefined();
      // Bateu no convés nominal: raio 200, não num piso falso em y = 0.
      expect(Math.abs(frame.radius(hit!.point)-PLANET.surfaceRadius)).toBeLessThan(.6);
      expect(hit!.distance).toBeCloseTo(30,1);
      // Tipos: quem já consumia `raycast` recebe `Vector3`, como antes.
      expect(hit!.point).toBeInstanceOf(Vector3);
      expect(hit!.normal).toBeInstanceOf(Vector3);
      // A normal é a vertical local daquele lado do planeta, e aponta PARA FORA — contra o raio.
      // A geometria autoral não tem winding confiável, então a orientação é feita na fronteira.
      expect(dot(normalize(hit!.normal),normalize(slot.direction))).toBeGreaterThan(.99);
      expect(dot(hit!.normal,inward(slot.direction).direction)).toBeLessThan(0);
    }
  });

  it('o mais próximo vence entre malha plana, caixa móvel e planeta',()=>{
    const world=new CollisionWorld();
    world.configurePlanet(frame,planetCollision());
    const deckOnly=world.raycast(inward({x:0,y:0,z:1}))!;
    // Uma caixa móvel a 10 m de altitude fica ANTES do convés e tem de ganhar.
    const at=frame.fromDirection({x:0,y:0,z:1},10);
    world.movingBoxes.push({id:'moving-lift',min:{x:at.x-4,y:at.y-.2,z:at.z-4},max:{x:at.x+4,y:at.y+.2,z:at.z+4}});
    const closer=world.raycast(inward({x:0,y:0,z:1}))!;
    expect(closer.distance).toBeLessThan(deckOnly.distance);
    // A caixa é um AABB de mundo: o raio entra pela face próxima (z = 214), a 16 m da origem.
    expect(closer.distance).toBeCloseTo(16,0);
    world.movingBoxes.length=0;
    expect(world.raycast(inward({x:0,y:0,z:1}))!.distance).toBeCloseTo(deckOnly.distance,9);
  });

  it('destruição vale para a bala: triângulo removido deixa o raio passar',()=>{
    const planet=planetCollision();
    const world=new CollisionWorld();
    world.configurePlanet(frame,planet);
    expect(world.raycast(inward({x:0,y:1,z:0}))).toBeDefined();
    // Remove a calota inteira do polo norte: o raio atravessa onde ela estava.
    planet.disableTriangles(0,planet.triangleCount);
    expect(planet.disabledCount).toBe(planet.triangleCount);
    expect(world.raycast(inward({x:0,y:1,z:0}))).toBeUndefined();
    planet.clearDisabledTriangles();
    expect(world.raycast(inward({x:0,y:1,z:0}))).toBeDefined();
  });

  it('hasTerrain enxerga o planeta, a região anexada e nada duplica geometria',()=>{
    const planet=planetCollision();
    const triangles=planet.triangleCount;
    const world=new CollisionWorld();
    expect(world.hasTerrain).toBe(false);
    world.configurePlanet(frame,planet);
    // É o portão que o `worldPick` precisa: `geometry` continua indefinida de propósito.
    expect(world.hasTerrain).toBe(true);
    expect(world.spherical).toBe(true);
    expect(world.geometry).toBeUndefined();
    // Sem duplicação: é a MESMA instância e o MESMO número de triângulos, nenhuma segunda BVH.
    expect(world.planet?.collision).toBe(planet);
    expect(planet.triangleCount).toBe(triangles);

    // Região anexada também conta como terreno, no mundo plano de sempre.
    const region=new CollisionWorld();
    region.setGeometry([-2,1,-2,2,1,-2,2,1,2],[0,1,2]);
    region.prepareRaycasts();
    const host=new CollisionWorld();
    expect(host.hasTerrain).toBe(false);
    const detach=host.attachRegion('ilha',region);
    expect(host.hasTerrain).toBe(true);
    detach();
    expect(host.hasTerrain).toBe(false);
  });

  it('o raio radial atravessa o vão entre ilhas sem inventar chão',()=>{
    const world=new CollisionWorld();
    world.configurePlanet(frame,planetCollision());
    // Direção que não cai em nenhuma das seis calotas.
    const gap=normalize({x:.7,y:.7,z:.2});
    expect(world.raycast(inward(gap))).toBeUndefined();
    // E um raio tangente rasante sobre o vão também não encosta em nada.
    const from=frame.fromDirection(gap,4);
    const tangent=frame.basisAt(from,{x:0,y:1,z:0}).forward;
    expect(world.raycast(new Ray(new Vector3(from.x,from.y,from.z),new Vector3(tangent.x,tangent.y,tangent.z),20))).toBeUndefined();
    // Já sobre a ilha, o mesmo rasante de 40 m encontra o convés à frente.
    const island=frame.fromDirection({x:0,y:0,z:1},6);
    const into=normalize(sub(frame.fromDirection({x:0,y:0,z:1},-2),island));
    const shot=world.raycast(new Ray(new Vector3(island.x,island.y,island.z),new Vector3(into.x,into.y,into.z),40));
    expect(shot).toBeDefined();
    expect(distance(shot!.point,frame.fromDirection({x:0,y:0,z:1}))).toBeLessThan(2);
    void scale;
  });
});

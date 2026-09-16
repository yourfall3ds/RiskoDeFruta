import {describe,it,expect,beforeAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/InputFrame';
import {WALK_SPEED} from '../src/player/PlayerTuning';
import {sculptRegion,worldTerrain,type OutcropShape,type SculptedRegion} from '../src/world/terrain/WorldTerrain';
import {HIGHLAND_ISLANDS,highlandElevation,HIGHLAND_TRAILS,reliefPlansFor} from '../src/world/terrain/ReliefPlans';
import {HIGHLAND_CHESTS} from '../src/world/HighlandSites';
import {ringVolumes,carveVolumes} from '../src/world/terrain/RockOutcrops';

/**
 * Relevo, caminhos e afloramentos.
 *
 * Todo teste aqui compara a SUPERFÍCIE GERADA com o PISO DE COLISÃO montado a partir dos mesmos
 * arquivos que o jogo carrega — não com uma maquete. É essa comparação que responde ao requisito
 * "superfície visível e colisão DEVEM coincidir": a malha desenhada pelo cliente é literalmente o
 * array `positions/indices` que entra no `CollisionWorld` abaixo.
 */

const read=(name:string)=>JSON.parse(readFileSync('public/models/'+name,'utf8'));

function baseSource(){
 const authored=read('farm-collision.json'),mesh=read('world-collision-mesh.json'),solid=read('solid-island-collision.json');
 return{authored,mesh,solid,boxes:[...authored.boxes,...mesh.boxes,...solid.boxes]};
}

/** Mundo de colisão do campo inicial, com ou sem o relevo esculpido. */
function baseWorld(sculpted:boolean):{world:CollisionWorld;relief:SculptedRegion|undefined}{
 const {authored,mesh,solid,boxes}=baseSource();
 const geometry={positions:[...mesh.positions as number[]],indices:[...mesh.indices as number[]]};
 const offset=geometry.positions.length/3;
 for(const value of solid.positions as number[])geometry.positions.push(value);
 for(const index of solid.indices as number[])geometry.indices.push(index+offset);
 const relief=sculpted?sculptRegion('base',{...geometry,boxes}):undefined;
 const world=new CollisionWorld();
 world.boxes.push(...mesh.boxes,...solid.boxes,...authored.boxes);
 world.surfaces.push(...authored.surfaces);
 world.setGeometry(geometry.positions,geometry.indices);
 return{world,relief};
}

let shape:OutcropShape;
let highland:{world:CollisionWorld;relief:SculptedRegion};
beforeAll(()=>{
 shape=read('outcrop-rocks.json') as OutcropShape;
 const data=read('highland-farms-collision.json');
 const relief=sculptRegion('highland-farms',data,shape);
 const world=new CollisionWorld();
 world.boxes.push(...data.boxes);
 world.setGeometry(data.positions,data.indices);
 highland={world,relief};
});

describe('relevo esculpido: superfície e colisão',()=>{
 it('devolve como piso exatamente a altura da malha gerada, no campo e nos planaltos',()=>{
  const {world,relief}=baseWorld(true);
  const terrain=relief!.terrain!;
  // O teto de amostragem é 5 cm: qualquer prop ou estrutura mais alto fica de fora da conta, e o
  // piso devolvido só pode ser a superfície esculpida — nunca o chão antigo, metros abaixo.
  let samples=0,worst=0,raised=0;
  for(let x=-22;x<=22;x+=.5)for(let z=-24;z<=24;z+=.5){
   const expected=terrain.heightAt(x,z);if(expected===undefined)continue;
   samples++;
   worst=Math.max(worst,Math.abs(world.groundAt(x,z,expected+.05,55)-expected));
   if(expected>.05)raised++;
  }
  expect(samples).toBeGreaterThan(3000);
  expect(raised/samples).toBeGreaterThan(.8);
  expect(worst).toBeLessThan(.06);

  const island=HIGHLAND_ISLANDS[0]!;let highlandSamples=0,highlandWorst=0;
  for(let i=0;i<70;i++)for(let j=0;j<70;j++){
   const x=island.x+(-.7+1.4*i/69)*island.rx,z=island.z+(-.7+1.4*j/69)*island.rz;
   const expected=highland.relief.terrain!.heightAt(x,z);if(expected===undefined)continue;
   highlandSamples++;
   highlandWorst=Math.max(highlandWorst,Math.abs(highland.world.groundAt(x,z,expected+.05,55)-expected));
  }
  expect(highlandSamples).toBeGreaterThan(1500);
  expect(highlandWorst).toBeLessThan(.06);
 });

 it('sobe o chão de verdade em vez de deixar o piso plano sob um relevo só visual',()=>{
  const flat=baseWorld(false).world,{world,relief}=baseWorld(true);
  let lifted=0,total=0,peak=0;
  for(let x=-20;x<=20;x+=1)for(let z=-22;z<=22;z+=1){
   const before=flat.groundAt(x,z,3,55),after=world.groundAt(x,z,3,55);
   if(!Number.isFinite(before))continue;
   total++;const gain=after-before;
   if(gain>.15)lifted++;peak=Math.max(peak,gain);
  }
  expect(total).toBeGreaterThan(500);
  // O campo era plano em y=0; agora a maior parte da área aberta tem cota própria.
  expect(lifted/total).toBeGreaterThan(.35);
  expect(peak).toBeGreaterThan(1);
  expect(relief!.terrain!.triangles).toBeGreaterThan(500);
 });

 it('não mexe em nenhuma estrutura, ponte, rampa ou âncora de recompensa',()=>{
  const {relief}=baseWorld(true),{boxes}=baseSource();
  const field=(x:number,z:number)=>Math.max(...relief!.terrain!.patches.map(patch=>patch.field.offsetAt(x,z)));
  for(const box of boxes){
   if(/^(moving-|.*-chest-)/.test(box.id))continue;
   const x=(box.min.x+box.max.x)/2,z=(box.min.z+box.max.z)/2;
   // O campo de relevo é exatamente zero sobre a estrutura...
   expect(field(x,z),box.id).toBe(0);
   // ...e a malha, que é discreta, não passa do degrau de borda de 2 cm mais a interpolação da
   // célula vizinha. Nada de pé de cerca enterrado nem porta suspensa.
   expect(relief!.offsetAt(x,z),box.id).toBeLessThan(.1);
  }
  // Chegada do jogador e rampa autorada continuam na cota original.
  for(const [x,z] of [[0,-16],[2,-16],[-2,-12],[0,10],[0,18],[0,26]] as const){
   expect(field(x,z),`${x},${z}`).toBe(0);
   expect(relief!.offsetAt(x,z),`${x},${z}`).toBeLessThan(.1);
  }

  const data=read('highland-farms-collision.json');
  const highlandField=(x:number,z:number)=>Math.max(...highland.relief.terrain!.patches.map(patch=>patch.field.offsetAt(x,z)));
  for(const link of data.walkableLinks as {a:{x:number;z:number};b:{x:number;z:number}}[])
   for(const end of [link.a,link.b]){
    expect(highlandField(end.x,end.z)).toBe(0);
    expect(highland.relief.offsetAt(end.x,end.z)).toBeLessThan(.1);
   }
  for(const chest of HIGHLAND_CHESTS){
   expect(highlandField(chest.x,chest.z),chest.id).toBe(0);
   expect(highland.world.groundAt(chest.x,chest.z,chest.y+.5,50),chest.id).toBeCloseTo(chest.y,2);
   expect(Math.abs(highland.world.groundAt(chest.x+1.3,chest.z,chest.y+1,50)-chest.y),chest.id).toBeLessThan(.5);
  }
 });

 it('não gera nenhuma face acima da inclinação caminhável, nem no relevo nem nos afloramentos',()=>{
  const walkable=Math.cos(50*Math.PI/180);
  for(const [name,geometries] of [
   ['campo',[baseWorld(true).relief!.terrain!.collisionGeometry()]],
   ['planaltos',[highland.relief.terrain!.collisionGeometry()]],
  ] as const){
   for(const geometry of geometries){
    let steep=0,total=0,gentle=0;
    for(let i=0;i<geometry.indices.length;i+=3){
     const a=geometry.indices[i]!*3,b=geometry.indices[i+1]!*3,c=geometry.indices[i+2]!*3;
     const ux=geometry.positions[b]!-geometry.positions[a]!,uy=geometry.positions[b+1]!-geometry.positions[a+1]!,uz=geometry.positions[b+2]!-geometry.positions[a+2]!;
     const vx=geometry.positions[c]!-geometry.positions[a]!,vy=geometry.positions[c+1]!-geometry.positions[a+1]!,vz=geometry.positions[c+2]!-geometry.positions[a+2]!;
     const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,length=Math.hypot(nx,ny,nz)||1;
     total++;if(Math.abs(ny)/length<walkable)steep++;if(Math.abs(ny)/length>Math.cos(12*Math.PI/180))gentle++;
    }
    expect(steep,name).toBe(0);
    // Nem tudo pode ser rampa de 2°: a maior parte é suave, mas existe desnível de verdade.
    expect(gentle/total,name).toBeLessThan(.96);
   }
  }
 });

 it('fecha a borda de todo retalho rente ao chão antigo, sem degrau de conexão',()=>{
  const {relief}=baseWorld(true);
  for(const source of [relief!,highland.relief])for(const patch of source.terrain!.patches){
   const {geometry,plan}=patch;
   if(!geometry.indices.length)continue;
   // Aresta usada por UM triângulo só é aresta de contorno: é ali que o retalho encontra o chão antigo.
   const uses=new Map<string,number>();
   for(let i=0;i<geometry.indices.length;i+=3){
    const triangle=[geometry.indices[i]!,geometry.indices[i+1]!,geometry.indices[i+2]!];
    for(let e=0;e<3;e++){
     const a=triangle[e]!,b=triangle[(e+1)%3]!;
     const key=a<b?`${a}_${b}`:`${b}_${a}`;
     uses.set(key,(uses.get(key)??0)+1);
    }
   }
   const perimeter=new Set<number>();
   for(const [key,count] of uses)if(count===1)for(const index of key.split('_'))perimeter.add(Number(index));
   expect(perimeter.size,plan.id).toBeGreaterThan(20);
   let worst=0;
   for(const index of perimeter){
    const x=geometry.positions[index*3]!,y=geometry.positions[index*3+1]!,z=geometry.positions[index*3+2]!;
    worst=Math.max(worst,y-plan.base(x,z));
   }
   // O contorno é o degrau mínimo por construção (`minLift`), muito abaixo de qualquer altura de passo.
   expect(worst,plan.id).toBeLessThanOrEqual(plan.minLift*2+1e-6);
  }
 });
});

describe('caminhos e travessia',()=>{
 it('mantém todas as trilhas dos planaltos contínuas, caminháveis e com desnível real',()=>{
  let climbed=0;
  const nearest=(x:number,z:number)=>HIGHLAND_ISLANDS.reduce((best,candidate)=>
   Math.hypot(x-candidate.x,z-candidate.z)<Math.hypot(x-best.x,z-best.z)?candidate:best);
  for(const trail of HIGHLAND_TRAILS){
   let previous:number|undefined,low=Infinity,high=-Infinity;
   for(let i=0;i+1<trail.points.length;i++){
    const a=trail.points[i]!,b=trail.points[i+1]!,length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    for(let s=0;s<=Math.ceil(length);s++){
     const t=Math.min(1,s/Math.max(1,length));
     const x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
     // Teto de 6 m acima da cota autorada: telhado de celeiro e passarela não entram na leitura
     // do piso (a trilha do celeiro passa por baixo da construção).
     const ground=highland.world.groundAt(x,z,highlandElevation(x,z,nearest(x,z))+6,50);
     expect(Number.isFinite(ground),`${trail.id} ${x.toFixed(0)},${z.toFixed(0)}`).toBe(true);
     if(previous!==undefined)expect(Math.abs(ground-previous),`${trail.id} ${x.toFixed(0)},${z.toFixed(0)}`).toBeLessThan(.6);
     previous=ground;low=Math.min(low,ground);high=Math.max(high,ground);
    }
   }
   climbed=Math.max(climbed,high-low);
  }
  // As trilhas conectam os desníveis em vez de contorná-los.
  expect(climbed).toBeGreaterThan(2);
 });

 it('atravessa fisicamente o relevo do campo sem cair, sem travar e ganhando altura',()=>{
  const {world}=baseWorld(true);
  const start={x:6,y:0,z:-6},goal={x:16.5,z:-15};
  const player=new PlayerMotor(world,new EventBus(),{...start});
  const yaw=Math.atan2(goal.x-start.x,goal.z-start.z);
  // Exatamente o tempo de percurso: além do terraço vem a beira da ilha, e cair de lá seria outro teste.
  const steps=Math.ceil(Math.hypot(goal.x-start.x,goal.z-start.z)/WALK_SPEED*60);
  let peak=-Infinity;
  for(let i=0;i<steps;i++){
   player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},yaw);
   peak=Math.max(peak,player.position.y);
   expect(player.position.y,`passo ${i}`).toBeGreaterThan(-1);
  }
  // Chegou ao terraço em vez de travar na subida.
  expect(Math.hypot(player.position.x-goal.x,player.position.z-goal.z)).toBeLessThan(3.5);
  expect(Math.abs(player.position.y-world.groundAt(player.position.x,player.position.z,player.position.y+.3,55))).toBeLessThan(.25);
  expect(player.respawns).toBe(0);
  expect(player.solidRecoveries).toBe(0);
  // Subiu o terraço leste em vez de escorregar de volta ou travar na saia da subida.
  expect(peak).toBeGreaterThan(.8);
  expect(Math.hypot(player.position.x-start.x,player.position.z-start.z)).toBeGreaterThan(6);
 });
});

describe('afloramentos de rocha',()=>{
 it('apaga a colisão das 41 instâncias repetidas da borda e esconde o mesmo conjunto',()=>{
  const volumes=ringVolumes();
  expect(volumes).toHaveLength(41);
  expect(highland.relief.retired).toHaveLength(41);
  // 899 triângulos por instância: a remoção é completa, não parcial.
  expect(highland.relief.carvedTriangles).toBe(volumes.length*899);

  // Idempotência sobre a malha ORIGINAL: depois da primeira passada não sobra um triângulo sequer
  // das instâncias antigas dentro dos mesmos volumes.
  const original=read('highland-farms-collision.json');
  const first=carveVolumes(original.positions,original.indices,volumes);
  expect(first.removed).toBe(volumes.length*899);
  expect(carveVolumes(original.positions,first.indices,volumes).removed).toBe(0);

  // O que saiu era pico de verdade, não enchimento enterrado: milhares de vértices acima da cota
  // autorada, chegando a ~2,6 m — exatamente a fileira que a direção de arte reprovou no horizonte.
  const kept=new Set(first.indices);
  const touched=new Set<number>();
  for(let i=0;i<original.indices.length;i+=3){
   const triangle=[original.indices[i]!,original.indices[i+1]!,original.indices[i+2]!];
   if(triangle.every(index=>kept.has(index)))continue;
   for(const index of triangle)touched.add(index);
  }
  let emerged=0,highest=0;
  for(const index of touched){
   const x=original.positions[index*3]!,y=original.positions[index*3+1]!,z=original.positions[index*3+2]!;
   const island=HIGHLAND_ISLANDS.reduce((best,candidate)=>
    Math.hypot(x-candidate.x,z-candidate.z)<Math.hypot(x-best.x,z-best.z)?candidate:best);
   const floor=highlandElevation(x,z,island);
   if(y>floor+.3)emerged++;
   highest=Math.max(highest,y-floor);
  }
  expect(emerged).toBeGreaterThan(3000);
  expect(highest).toBeGreaterThan(2);
 });

 it('entrega afloramentos variados, com topo pisável que é a própria malha e sem pedra flutuante',()=>{
  const placements=highland.relief.placements;
  expect(placements.length).toBeGreaterThan(20);
  const widths=placements.map(p=>p.size[0]),heights=placements.map(p=>p.size[1]);
  // Distribuição orgânica: nada de escala única, giro único ou silhueta repetida.
  expect(new Set(widths.map(w=>w.toFixed(2))).size).toBeGreaterThan(placements.length-3);
  expect(new Set(placements.map(p=>p.rotation.toFixed(2))).size).toBeGreaterThan(placements.length-3);
  expect(Math.max(...widths)/Math.min(...widths)).toBeGreaterThan(1.8);
  expect(Math.max(...heights)/Math.min(...heights)).toBeGreaterThan(1.8);
  expect(new Set(placements.map(p=>p.warp.toFixed(5))).size).toBeGreaterThan(placements.length-3);

  // Cume de cada afloramento: a colisão ali é a própria malha desenhada, é caminhável e NÃO existe
  // nada de sólido acima dela — nenhuma caixa invisível por cima do visual.
  const vertices=shape.positions.length/3;
  let landable=0,apexes=0;
  for(const group of highland.relief.outcrops){
   for(let rock=0;rock*vertices*3<group.geometry.positions.length;rock++){
    let apex={x:0,y:-Infinity,z:0};
    for(let v=0;v<vertices;v++){
     const i=(rock*vertices+v)*3,y=group.geometry.positions[i+1]!;
     if(y>apex.y)apex={x:group.geometry.positions[i]!,y,z:group.geometry.positions[i+2]!};
    }
    const label=`${group.id}#${rock}`;
    const surface=highland.world.surfaceAt(apex.x,apex.z,apex.y+.05);
    expect(surface,label).toBeDefined();
    expect(Math.abs(surface!.height-apex.y),label).toBeLessThan(.35);
    // Nada sólido acima do cume: o que existe de colisão é exatamente o que se vê.
    expect(highland.world.groundAt(apex.x,apex.z,Infinity,89),label).toBeLessThan(apex.y+.35);
    if(highland.world.groundAt(apex.x,apex.z,apex.y+.05,55)>apex.y-.6)landable++;
    apexes++;
   }
  }
  expect(apexes).toBe(placements.length);
  // Cume pisável na grande maioria dos afloramentos; alguns são lascas inclinadas de propósito.
  expect(landable/apexes).toBeGreaterThan(.6);

  for(const placement of placements){
   const island=HIGHLAND_ISLANDS.reduce((best,candidate)=>
    Math.hypot(placement.x-candidate.x,placement.z-candidate.z)<Math.hypot(placement.x-best.x,placement.z-best.z)?candidate:best);
   const floor=highlandElevation(placement.x,placement.z,island)+highland.relief.offsetAt(placement.x,placement.z);
   // Nasce enterrada: a base fica abaixo do terreno, então não existe pedra boiando.
   expect(placement.y,placement.id).toBeLessThan(floor);
   expect(placement.y+placement.size[1],placement.id).toBeGreaterThan(floor);
  }
 });

 it('deixa ponte, âncora de recompensa e trilha livres de afloramento',()=>{
  const data=read('highland-farms-collision.json');
  for(const placement of highland.relief.placements){
   for(const chest of HIGHLAND_CHESTS)expect(Math.hypot(placement.x-chest.x,placement.z-chest.z),`${placement.id}/${chest.id}`).toBeGreaterThan(6.5);
   for(const link of data.walkableLinks as {a:{x:number;z:number};b:{x:number;z:number};width:number}[]){
    const dx=link.b.x-link.a.x,dz=link.b.z-link.a.z;
    const t=Math.max(0,Math.min(1,((placement.x-link.a.x)*dx+(placement.z-link.a.z)*dz)/Math.max(1e-9,dx*dx+dz*dz)));
    expect(Math.hypot(placement.x-link.a.x-t*dx,placement.z-link.a.z-t*dz),placement.id).toBeGreaterThan(link.width/2);
   }
   for(const trail of HIGHLAND_TRAILS)for(let i=0;i+1<trail.points.length;i++){
    const a=trail.points[i]!,b=trail.points[i+1]!,dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((placement.x-a[0])*dx+(placement.z-a[1])*dz)/Math.max(1e-9,dx*dx+dz*dz)));
    expect(Math.hypot(placement.x-a[0]-t*dx,placement.z-a[1]-t*dz),`${placement.id}/${trail.id}`).toBeGreaterThan(trail.width/2);
   }
  }
 });
});

describe('determinismo entre cliente e servidor',()=>{
 it('gera exatamente os mesmos triângulos a partir dos mesmos dados de colisão',()=>{
  const first=read('highland-farms-collision.json'),second=read('highland-farms-collision.json');
  const a=sculptRegion('highland-farms',first,shape),b=sculptRegion('highland-farms',second,shape);
  expect(first.indices.length).toBe(second.indices.length);
  expect(first.positions.length).toBe(second.positions.length);
  for(let i=0;i<first.positions.length;i+=997)expect(first.positions[i]).toBe(second.positions[i]);
  expect(a.carvedTriangles).toBe(b.carvedTriangles);
  expect(a.placements.map(p=>`${p.id}:${p.x.toFixed(6)}:${p.y.toFixed(6)}`)).toEqual(b.placements.map(p=>`${p.id}:${p.x.toFixed(6)}:${p.y.toFixed(6)}`));
 });

 it('o servidor autoritativo carrega o mesmo piso esculpido que o cliente desenha',async()=>{
  const {loadCollision}=await import('../server/rooms/FarmRoom');
  const {FarmSimulation}=await import('../server/FarmSimulation');
  const simulation=new FarmSimulation('relief-server',loadCollision());
  const {relief}=baseWorld(true);
  let checked=0;
  for(let x=-18;x<=18;x+=2)for(let z=-20;z<=20;z+=2){
   const expected=relief!.terrain!.heightAt(x,z);if(expected===undefined||expected<.1)continue;
   expect(simulation.collision.groundAt(x,z,expected+.002,55),`${x},${z}`).toBeCloseTo(expected,2);
   checked++;
  }
  expect(checked).toBeGreaterThan(100);
  for(const chest of HIGHLAND_CHESTS)expect(Math.abs(simulation.collision.groundAt(chest.x+1.3,chest.z,chest.y+1)-chest.y),chest.id).toBeLessThan(.5);
 });
});

describe('plano de relevo',()=>{
 it('deriva exclusões dos dados reais de colisão, não de uma lista fixa',()=>{
  const {boxes}=baseSource();
  const rich=reliefPlansFor('base',{boxes})[0]!;
  const poor=reliefPlansFor('base',{boxes:[]})[0]!;
  expect(rich.exclusions.length).toBeGreaterThan(poor.exclusions.length+100);
  expect(reliefPlansFor('solar-frontier',{boxes})).toHaveLength(0);
  expect(worldTerrain('rootwood',{boxes})).toBeUndefined();
 });

 it('nivela as trilhas com rampa limitada em vez de copiar cada solavanco do terreno',()=>{
  const plans=reliefPlansFor('highland-farms',{boxes:read('highland-farms-collision.json').boxes,walkableLinks:read('highland-farms-collision.json').walkableLinks});
  const paths=plans.flatMap(plan=>plan.paths);
  expect(paths.length).toBeGreaterThan(5);
  for(const path of paths)for(let i=0;i+1<path.points.length;i++){
   const a=path.points[i]!,b=path.points[i+1]!;
   const run=Math.hypot(b[0]-a[0],b[1]-a[1]);
   if(run<.01)continue;
   expect(Math.abs(b[2]-a[2])/run,path.id).toBeLessThan(.31);
  }
 });
});

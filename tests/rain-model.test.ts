import {describe,it,expect} from 'vitest';
import {rainWind,windDrift,WIND_MAX_SPEED} from '../src/world/rain/RainWind';
import {RAIN_LAYERS,RAIN_TOTAL_CAPACITY,layerIntensity,steadyPopulation} from '../src/world/rain/RainLayers';
import {
 RainSurfaceSampler,SPLASH_RADIUS,SPLASH_CAPACITY,QUERY_BUDGET_PER_SECOND,SHELTER_HEAD_ROOM,
 SPLASH_ABOVE_VIEWER,SPLASH_BELOW_VIEWER,type RainWorldQuery,type RainSurfaceSample,
} from '../src/world/rain/RainSurface';
import {WetnessField,absorbency,WET_RISE_SECONDS,WET_DRY_SECONDS} from '../src/world/rain/WetnessField';

const VIEWER={x:12,y:4,z:-30};
const flat=(height:number,normalY=1):RainSurfaceSample=>({height,normal:{x:0,y:normalY,z:Math.sqrt(Math.max(0,1-normalY*normalY))},slopeDegrees:Math.acos(normalY)*180/Math.PI});

/** Mundo de teste que conta consultas, como o `CollisionWorld` real seria consultado. */
function world(surface:(x:number,z:number)=>RainSurfaceSample|undefined,inside=false){
 const calls:{x:number;z:number}[]=[];
 const query:RainWorldQuery={surfaceAt:(x,z)=>{calls.push({x,z});return surface(x,z);},insideSolid:()=>inside};
 return {query,calls};
}
const run=(sampler:RainSurfaceSampler,query:RainWorldQuery|undefined,seconds:number,rain=1,viewer=VIEWER)=>{
 const out=[];
 for(let i=0;i<Math.round(seconds*60);i++)out.push(...sampler.update(1/60,viewer,rain,query));
 return out;
};

describe('vento coerente',()=>{
 it('é contínuo, limitado e igual em qualquer máquina',()=>{
  let previous=rainWind(0,1);
  for(let i=1;i<60*60*10;i++){
   const now=rainWind(i/60,1);
   // Sem salto entre quadros: é o que separa um vento de um sorteio por quadro.
   expect(Math.hypot(now.x-previous.x,now.z-previous.z)).toBeLessThan(.02);
   expect(Math.abs(now.speed-previous.speed)).toBeLessThan(.06);
   expect(Math.hypot(now.x,now.z)).toBeCloseTo(1,6);
   expect(now.speed).toBeLessThanOrEqual(WIND_MAX_SPEED+1e-9);
   expect(now.speed).toBeGreaterThan(0);
   previous=now;
  }
  // Determinístico: mesmo relógio, mesmo vento — dois clientes de co-op veem a mesma chuva.
  expect(rainWind(123.75,.6)).toEqual(rainWind(123.75,.6));
  // E gira de verdade ao longo do tempo, em vez de ficar travado numa direção: ao longo de uma
  // volta lenta a deriva passa pelos quatro quadrantes.
  const quadrants=new Set<string>();
  for(let t=0;t<120;t+=.5){const w=rainWind(t,1);quadrants.add(`${w.x>=0?'+':'-'}${w.z>=0?'+':'-'}`);}
  expect(quadrants.size).toBe(4);
 });

 it('as três camadas compartilham a mesma direção, com forças diferentes',()=>{
  const wind=rainWind(31.4,1);
  const drifts=RAIN_LAYERS.map(layer=>({id:layer.id,...windDrift(wind,layer.windFactor)}));
  for(const drift of drifts){
   const length=Math.hypot(drift.x,drift.z);
   // Mesma direção, sempre.
   expect(drift.x/length).toBeCloseTo(wind.x,6);
   expect(drift.z/length).toBeCloseTo(wind.z,6);
  }
  // …com intensidades distintas: o véu distante deriva menos que a gota de perto.
  const near=drifts.find(d=>d.id==='near')!,far=drifts.find(d=>d.id==='far')!;
  expect(Math.hypot(near.x,near.z)).toBeGreaterThan(Math.hypot(far.x,far.z)*1.5);
 });

 it('sem chuva o vento não some de repente',()=>{
  expect(rainWind(10,0).speed).toBeGreaterThan(0);
  expect(rainWind(10,0).speed).toBeLessThan(rainWind(10,1).speed);
 });
});

describe('camadas',()=>{
 it('gasta menos partículas que a versão rejeitada e separa perto, meio e longe',()=>{
  expect(RAIN_TOTAL_CAPACITY).toBeLessThan(900);
  const ids=RAIN_LAYERS.map(l=>l.id);
  expect(ids).toEqual(['near','mid','far']);
  const near=RAIN_LAYERS[0]!,mid=RAIN_LAYERS[1]!,far=RAIN_LAYERS[2]!;
  // Escala, alcance, opacidade e vida crescem/diminuem com a profundidade.
  expect(near.maxSize).toBeGreaterThan(mid.maxSize);
  expect(far.maxSize).toBeGreaterThan(near.maxSize);
  expect(far.radius).toBeGreaterThan(mid.radius);
  expect(mid.radius).toBeGreaterThan(near.radius);
  expect(near.alpha).toBeGreaterThan(far.alpha*3);
  expect(near.fall).toBeGreaterThan(far.fall*2);
  expect(mid.capacity).toBeGreaterThan(near.capacity);
  // Nenhuma camada emite mais do que o próprio teto aguenta: passar disso recicla partícula viva
  // e a chuva pisca. Folga de pelo menos 10%.
  for(const spec of RAIN_LAYERS)
   expect(steadyPopulation(spec),`${spec.id} vive ${Math.round(steadyPopulation(spec))} para um teto de ${spec.capacity}`)
    .toBeLessThan(spec.capacity*.9);
 });

 it('as camadas entram em ordem, em vez de aparecerem todas de uma vez',()=>{
  const [near,mid,far]=RAIN_LAYERS as unknown as [typeof RAIN_LAYERS[0],typeof RAIN_LAYERS[0],typeof RAIN_LAYERS[0]];
  // Chuva fraquíssima: só o véu distante.
  expect(layerIntensity(far,.1)).toBeGreaterThan(0);
  expect(layerIntensity(near,.1)).toBe(0);
  // Aguaceiro: as três cheias.
  for(const layer of RAIN_LAYERS)expect(layerIntensity(layer,1)).toBeCloseTo(1,6);
  // Seco: nada.
  for(const layer of RAIN_LAYERS)expect(layerIntensity(layer,0)).toBe(0);
  // E cada uma cresce monotonicamente, sem degrau.
  for(const layer of RAIN_LAYERS){
   let previous=0;
   for(let r=0;r<=1.0001;r+=.01){const now=layerIntensity(layer,r);expect(now).toBeGreaterThanOrEqual(previous-1e-9);expect(now-previous).toBeLessThan(.05);previous=now;}
  }
  expect(layerIntensity(mid,.5)).toBeGreaterThan(0);
 });
});

describe('respingos em superfície real',()=>{
 it('não inventa chão: sem consulta de mundo, não existe respingo',()=>{
  const sampler=new RainSurfaceSampler();
  expect(run(sampler,undefined,10)).toHaveLength(0);
  expect(sampler.queries).toBe(0);
  expect(sampler.viewerCovered).toBe(false);
 });

 it('põe a coroa exatamente na superfície devolvida pelo mundo, dentro do raio',()=>{
  const ground=world((x,z)=>flat(2+Math.sin(x*.1)*.5+Math.cos(z*.1)*.5));
  const sampler=new RainSurfaceSampler();
  const placements=run(sampler,ground.query,6);
  expect(placements.length).toBeGreaterThan(50);
  for(const placement of placements){
   const expected=2+Math.sin(placement.x*.1)*.5+Math.cos(placement.z*.1)*.5;
   expect(placement.y).toBeCloseTo(expected,6);
   expect(Math.hypot(placement.x-VIEWER.x,placement.z-VIEWER.z)).toBeLessThanOrEqual(SPLASH_RADIUS+1e-6);
   expect(placement.normal.y).toBeGreaterThan(.8);
   expect(placement.scale).toBeGreaterThan(.5);
   expect(placement.scale).toBeLessThanOrEqual(1);
  }
  // Respingos mais longe nascem menores.
  const near=placements.filter(p=>Math.hypot(p.x-VIEWER.x,p.z-VIEWER.z)<4);
  const far=placements.filter(p=>Math.hypot(p.x-VIEWER.x,p.z-VIEWER.z)>11);
  expect(Math.min(...near.map(p=>p.scale))).toBeGreaterThan(Math.max(...far.map(p=>p.scale)));
 });

 it('respeita um orçamento de consultas: nada de um raycast por partícula',()=>{
  const ground=world(()=>flat(2));
  const sampler=new RainSurfaceSampler();
  const seconds=20;
  run(sampler,ground.query,seconds);
  // 60 quadros por segundo por 20 s seriam 1200 oportunidades; o orçamento corta bem antes.
  expect(sampler.queries).toBeLessThanOrEqual(Math.ceil(QUERY_BUDGET_PER_SECOND*seconds)+2);
  expect(ground.calls.length).toBe(sampler.queries);
  expect(sampler.queries/seconds).toBeLessThan(QUERY_BUDGET_PER_SECOND+1);
  // …e o orçamento não é gasto à toa quando não chove.
  const dry=new RainSurfaceSampler(),quiet=world(()=>flat(2));
  run(dry,quiet.query,20,0);
  expect(dry.queries).toBeLessThan(sampler.queries/4);
 });

 it('o respingo cai no telhado, nunca no piso debaixo dele',()=>{
  // Coluna com laje a 6 m: a consulta devolve o TOPO, então a coroa nunca aparece no chão coberto.
  const roofed=world(()=>flat(VIEWER.y+5.5));
  const sampler=new RainSurfaceSampler();
  const placements=run(sampler,roofed.query,6);
  for(const placement of placements)expect(placement.y).toBeCloseTo(VIEWER.y+5.5,6);
  // Céu aberto sobre a câmera, mas telhados altos em volta: as colunas cobertas são recusadas
  // (o respingo estaria fora de quadro) sem desligar a chuva de quem está no aberto.
  const mixed=world((x,z)=>Math.hypot(x-VIEWER.x,z-VIEWER.z)<1
   ?flat(VIEWER.y-1.6)
   :flat(VIEWER.y+SPLASH_ABOVE_VIEWER+4));
  const high=new RainSurfaceSampler();
  expect(run(high,mixed.query,6)).toHaveLength(0);
  expect(high.viewerCovered).toBe(false);
  expect(high.rejected).toBeGreaterThan(0);
  expect(high.shelter).toBeGreaterThan(.9);
 });

 it('recusa vazio, abismo e rampa íngreme',()=>{
  const empty=new RainSurfaceSampler();
  expect(run(empty,world(()=>undefined).query,6)).toHaveLength(0);
  expect(empty.rejected).toBeGreaterThan(0);

  const abyss=new RainSurfaceSampler();
  expect(run(abyss,world(()=>flat(VIEWER.y-SPLASH_BELOW_VIEWER-5)).query,6)).toHaveLength(0);

  // Rampa de ~55°: a água escorre, não forma coroa.
  const slope=new RainSurfaceSampler();
  expect(run(slope,world(()=>flat(VIEWER.y,.57)).query,6)).toHaveLength(0);
  // Rampa suave continua respingando.
  const gentle=new RainSurfaceSampler();
  expect(run(gentle,world(()=>flat(VIEWER.y,.95)).query,6).length).toBeGreaterThan(0);
 });

 it('sob cobertura a câmera para de receber chuva e respingo',()=>{
  const sheltered=world(()=>flat(VIEWER.y+SHELTER_HEAD_ROOM+3));
  const sampler=new RainSurfaceSampler();
  const placements=run(sampler,sheltered.query,4);
  expect(sampler.viewerCovered).toBe(true);
  expect(placements).toHaveLength(0);
  // Coberto, o amostrador nem sorteia colunas: o custo cai a uma consulta de cobertura por vez.
  expect(sampler.queries).toBeLessThan(4*4+2);

  // Saindo para o aberto, volta a chover — e o estado se recupera sozinho.
  const open=world(()=>flat(VIEWER.y-1.6));
  const recovered=new RainSurfaceSampler();
  expect(run(recovered,open.query,3).length).toBeGreaterThan(0);
  expect(recovered.viewerCovered).toBe(false);
  expect(recovered.shelter).toBeLessThan(.1);

  // Meio a meio: a fração coberta das colunas sorteadas acompanha o abrigo real do lugar.
  const half=world(x=>flat(x>VIEWER.x?VIEWER.y+SHELTER_HEAD_ROOM+3:VIEWER.y-1.6));
  const partial=new RainSurfaceSampler();
  run(partial,half.query,8);
  expect(partial.shelter).toBeGreaterThan(.25);
  expect(partial.shelter).toBeLessThan(.75);
 });

 it('usa insideSolid quando existe, mesmo sem telhado acima',()=>{
  const cave=world(()=>flat(VIEWER.y-1.5),true);
  const sampler=new RainSurfaceSampler();
  expect(run(sampler,cave.query,3)).toHaveLength(0);
  expect(sampler.viewerCovered).toBe(true);
 });

 it('nunca estoura o teto de respingos por quadro e reinicia limpo',()=>{
  const ground=world(()=>flat(1));
  const sampler=new RainSurfaceSampler();
  for(let i=0;i<600;i++){
   // Passo grande de propósito: mesmo com engasgo, um quadro não pode cuspir centenas de coroas.
   const frame=sampler.update(.25,VIEWER,1,ground.query);
   expect(frame.length).toBeLessThanOrEqual(SPLASH_CAPACITY);
  }
  expect(sampler.queries).toBeGreaterThan(0);
  sampler.reset();
  expect(sampler.queries).toBe(0);expect(sampler.shelter).toBe(0);expect(sampler.viewerCovered).toBe(false);
 });

 it('ignora dt inválido e chuva inválida sem consultar o mundo',()=>{
  const ground=world(()=>flat(1));
  const sampler=new RainSurfaceSampler();
  for(const bad of [0,-1,NaN,Number.POSITIVE_INFINITY])expect(sampler.update(bad,VIEWER,1,ground.query)).toHaveLength(0);
  expect(ground.calls).toHaveLength(0);
  expect(sampler.update(1/60,VIEWER,NaN,ground.query)).toHaveLength(0);
 });
});

describe('umidade com histerese',()=>{
 it('molha em segundos e seca em minutos',()=>{
  const field=new WetnessField();
  for(let i=0;i<WET_RISE_SECONDS*60;i++)field.update(1/60,1);
  const soaked=field.level;
  expect(soaked).toBeGreaterThan(.9);
  // Passados os mesmos segundos com a chuva desligada, ainda está bem molhado.
  for(let i=0;i<WET_RISE_SECONDS*60;i++)field.update(1/60,0);
  expect(field.level).toBeGreaterThan(soaked*.6);
  // Só bem depois é que seca.
  for(let i=0;i<WET_DRY_SECONDS*60;i++)field.update(1/60,0);
  expect(field.level).toBeLessThan(.06);
  expect(field.level).toBeGreaterThanOrEqual(0);
 });

 it('nunca ultrapassa os limites nem depende da taxa de quadros',()=>{
  const fast=new WetnessField(),slow=new WetnessField();
  for(let i=0;i<60*30;i++)fast.update(1/60,1);
  for(let i=0;i<30*30;i++)slow.update(1/30,1);
  expect(Math.abs(fast.level-slow.level)).toBeLessThan(.01);
  expect(fast.level).toBeLessThanOrEqual(1);
  const field=new WetnessField();
  for(const bad of [NaN,-1,Number.POSITIVE_INFINITY])field.update(bad,1);
  expect(field.level).toBe(0);
  field.update(1/60,5);expect(field.level).toBeLessThanOrEqual(1);
  field.update(1/60,-3);expect(field.level).toBeGreaterThanOrEqual(0);
 });

 it('materiais diferentes respondem diferente, sempre do mesmo jeito',()=>{
  // Absorvência estável: o mesmo nome dá o mesmo valor em qualquer sessão.
  expect(absorbency('Leaf litter soil')).toBe(absorbency('Leaf litter soil'));
  expect(absorbency('Leaf litter soil')).toBeGreaterThan(absorbency('Cliff stone'));
  // Dois materiais da mesma família não respondem idênticos.
  expect(absorbency('Leaf litter soil')).not.toBe(absorbency('Exposed soil strata'));

  const field=new WetnessField();
  field.track('Leaf litter soil');field.track('Cliff stone');
  for(let i=0;i<60*60;i++)field.update(1/60,1);
  const soil=field.wetnessOf('Leaf litter soil'),stone=field.wetnessOf('Cliff stone');
  expect(soil).toBeGreaterThan(stone);
  // E a terra segura a água por muito mais tempo depois que a chuva passa.
  for(let i=0;i<60*60;i++)field.update(1/60,0);
  expect(field.wetnessOf('Leaf litter soil')).toBeGreaterThan(field.wetnessOf('Cliff stone')*1.3);
 });

 it('esquece materiais descartados e reinicia limpo',()=>{
  const field=new WetnessField();
  field.track('soil');field.track('rock');
  expect(field.tracked).toBe(2);
  field.forget('soil');
  expect(field.tracked).toBe(1);
  field.clear();
  expect(field.tracked).toBe(0);expect(field.level).toBe(0);
 });
});

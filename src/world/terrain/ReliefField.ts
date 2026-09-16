/**
 * Campo de relevo determinístico, em espaço de MUNDO, compartilhado por cliente e servidor.
 *
 * Regra central do sistema: o relevo é uma função pura de (x,z) e o deslocamento resultante é
 * SEMPRE >= 0 em relação ao chão autorado. Isso é o que permite acrescentar terreno sem reescrever
 * um único byte das malhas e colisões já assadas: o piso antigo continua existindo, só que
 * enterrado, e `CollisionWorld.groundAt`/`surfaceAt` (que tomam o máximo) passam a devolver a
 * superfície nova. A mesma função gera a malha visível E os triângulos de colisão — os dois saem do
 * mesmo array de floats, então não existe "shader que levanta o visual e deixa o piso plano".
 *
 * Nada aqui usa Babylon, Math.random nem tempo: o servidor autoritativo calcula exatamente o mesmo
 * terreno que o cliente desenha.
 */

/** Interpolação suave clássica; `t` já deve estar em 0..1. */
function smoothstep(t:number):number{return t<=0?0:t>=1?1:t*t*(3-2*t);}

/** Distância de um ponto ao segmento (a,b), no plano XZ. */
function segmentDistance(x:number,z:number,ax:number,az:number,bx:number,bz:number):{distance:number;t:number}{
 const dx=bx-ax,dz=bz-az,length=dx*dx+dz*dz;
 const t=length<1e-9?0:Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/length));
 return{distance:Math.hypot(x-ax-t*dx,z-az-t*dz),t};
}

/**
 * Áreas de influência.
 *
 * As extensões (`rx`/`rz`, `hx`/`hz`, `halfWidth`) são SEMPRE a borda EXTERNA, onde o peso chega a
 * zero; `feather` é a largura em metros da transição suave para dentro dela. Ou seja, o miolo de
 * peso 1 é a extensão menos `feather`. É essa convenção que garante que nenhuma feição termine em
 * degrau, e que uma exclusão de estrutura realmente zere o relevo EM CIMA da estrutura, e não só
 * na borda do halo.
 */
export type ReliefArea=
 |{shape:'disc';x:number;z:number;rx:number;rz:number;feather:number}
 |{shape:'rect';x:number;z:number;hx:number;hz:number;angle?:number;feather:number}
 |{shape:'path';points:readonly(readonly[number,number])[];halfWidth:number;feather:number};

/** Peso 0..1 da área no ponto: 1 no miolo, 0 fora, transição suave de `feather` metros. */
export function areaWeight(area:ReliefArea,x:number,z:number):number{
 if(area.shape==='disc'){
  const rx=Math.max(area.rx,1e-3),rz=Math.max(area.rz,1e-3);
  const r=Math.hypot((x-area.x)/rx,(z-area.z)/rz);
  // (1-r) normalizado vezes o menor raio ≈ quantos metros o ponto está para dentro da borda.
  return smoothstep((1-r)*Math.min(rx,rz)/Math.max(area.feather,1e-3));
 }
 if(area.shape==='rect'){
  const angle=area.angle??0,cos=Math.cos(angle),sin=Math.sin(angle);
  const dx=x-area.x,dz=z-area.z,lx=dx*cos+dz*sin,lz=-dx*sin+dz*cos;
  const inside=Math.min(area.hx-Math.abs(lx),area.hz-Math.abs(lz));
  return smoothstep(inside/Math.max(area.feather,1e-3));
 }
 let nearest=Infinity;
 for(let i=0;i+1<area.points.length;i++){
  const a=area.points[i]!,b=area.points[i+1]!;
  nearest=Math.min(nearest,segmentDistance(x,z,a[0],a[1],b[0],b[1]).distance);
 }
 if(area.points.length===1){const a=area.points[0]!;nearest=Math.hypot(x-a[0],z-a[1]);}
 return smoothstep((area.halfWidth-nearest)/Math.max(area.feather,1e-3));
}

/**
 * Feições de relevo.
 *
 * `plateau` cobre crista, terraço, afloramento e bacia: é sempre "altura × peso da área", e o peso
 * suave da área é justamente o talude. Altura negativa escava.
 * `undulation` é o ruído de baixa frequência que tira o chão do plano perfeito.
 */
export type ReliefFeature=
 |{kind:'plateau';id?:string;area:ReliefArea;height:number}
 |{kind:'undulation';id?:string;amplitude:number;scale:number;seed:number;area?:ReliefArea};

/** Caminho jogável: dentro do corredor o campo é puxado para um perfil longitudinal controlado. */
export interface ReliefPath {
 id:string;
 /** Nós `[x,z,alturaRelativa]`. A altura é o deslocamento desejado NAQUELE nó, em metros. */
 points:readonly(readonly[number,number,number])[];
 halfWidth:number;
 feather:number;
}

/** Hash determinístico 2D → 0..1. Sem estado, sem Math.random. */
function hash2(ix:number,iz:number,seed:number):number{
 let h=Math.imul(ix|0,73856093)^Math.imul(iz|0,19349663)^Math.imul(seed|0,83492791);
 h=Math.imul(h^(h>>>15),2246822507);h=Math.imul(h^(h>>>13),3266489909);
 return((h^(h>>>16))>>>0)/4294967296;
}

/** Ruído de valor bilinear suavizado. */
function valueNoise(x:number,z:number,seed:number):number{
 const ix=Math.floor(x),iz=Math.floor(z),fx=smoothstep(x-ix),fz=smoothstep(z-iz);
 const a=hash2(ix,iz,seed),b=hash2(ix+1,iz,seed),c=hash2(ix,iz+1,seed),d=hash2(ix+1,iz+1,seed);
 return(a+(b-a)*fx)+((c+(d-c)*fx)-(a+(b-a)*fx))*fz;
}

/** Duas oitavas, centradas em zero. Escalas incomensuráveis para não desenhar grade. */
function undulationAt(x:number,z:number,scale:number,seed:number):number{
 const s=Math.max(scale,1e-3);
 return(valueNoise(x/s,z/s,seed)-.5)*1.3+(valueNoise(x/(s*.413)+7.7,z/(s*.413)-3.1,seed+101)-.5)*.55;
}

/**
 * Piso suave em zero: devolve um valor sempre >= 0 sem criar quina dura em v=0.
 * `k` é a largura da curva; 0 devolveria `max(v,0)` com dobra visível.
 */
function softFloor(v:number,k:number):number{
 if(k<=1e-6)return Math.max(0,v);
 return(v+Math.sqrt(v*v+k*k))*.5-k*.5;
}

/** Plano de relevo de uma região. Tudo autorado; nada é descoberto em tempo de execução. */
export interface ReliefPlan {
 id:string;
 /** Retângulo amostrado ao gerar a malha. */
 bounds:{minX:number;maxX:number;minZ:number;maxZ:number};
 /** Espaçamento da grade em metros. */
 resolution:number;
 /** Chão autorado sob o ponto — a base sobre a qual o deslocamento é somado. */
 base(x:number,z:number):number;
 /** Onde o relevo PODE existir. Fora das zonas o deslocamento é zero por definição. */
 zones:readonly ReliefArea[];
 /** Onde o relevo NÃO pode existir: construções, portas, pontes, âncoras de loot, rampas. */
 exclusions:readonly ReliefArea[];
 features:readonly ReliefFeature[];
 paths:readonly ReliefPath[];
 /** Elevação constante somada dentro das zonas, para as bacias poderem descer sem furar a base. */
 pedestal:number;
 /** Altura mínima da malha nova sobre a antiga. Evita coplanaridade (z-fighting) e empate no max(). */
 minLift:number;
 /** Escala de UV do material de chão da região (metros por repetição). */
 uvScale:number;
}

/** Retângulo que contém toda a influência da área (peso zero fora dele). */
export function areaBounds(area:ReliefArea):{minX:number;maxX:number;minZ:number;maxZ:number}{
 if(area.shape==='disc')return{minX:area.x-area.rx,maxX:area.x+area.rx,minZ:area.z-area.rz,maxZ:area.z+area.rz};
 if(area.shape==='rect'){
  const reach=Math.hypot(area.hx,area.hz);
  return{minX:area.x-reach,maxX:area.x+reach,minZ:area.z-reach,maxZ:area.z+reach};
 }
 let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
 for(const [x,z] of area.points){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
 return{minX:minX-area.halfWidth,maxX:maxX+area.halfWidth,minZ:minZ-area.halfWidth,maxZ:maxZ+area.halfWidth};
}

const INDEX_CELL=10;

/**
 * Índice de grade das exclusões.
 *
 * O campo inicial tem 700+ exclusões derivadas das caixas de colisão. Percorrer todas por amostra
 * transformava a geração do retalho num custo de ativação visível — e a ativação de região já é o
 * ponto mais caro do streaming. Cada exclusão entra nas células do seu retângulo de influência e a
 * consulta olha uma célula só.
 */
class AreaIndex {
 private readonly cells=new Map<string,ReliefArea[]>();
 constructor(areas:readonly ReliefArea[]){
  for(const area of areas){
   const bounds=areaBounds(area);
   for(let cx=Math.floor(bounds.minX/INDEX_CELL);cx<=Math.floor(bounds.maxX/INDEX_CELL);cx++)
    for(let cz=Math.floor(bounds.minZ/INDEX_CELL);cz<=Math.floor(bounds.maxZ/INDEX_CELL);cz++){
     const key=`${cx},${cz}`,list=this.cells.get(key);
     if(list)list.push(area);else this.cells.set(key,[area]);
    }
  }
 }
 at(x:number,z:number):readonly ReliefArea[]{return this.cells.get(`${Math.floor(x/INDEX_CELL)},${Math.floor(z/INDEX_CELL)}`)??[];}
}

/** Avaliador do plano. Barato o bastante para ser chamado por vértice e por prop. */
export class ReliefField {
 private readonly excluded:AreaIndex;
 constructor(readonly plan:ReliefPlan){this.excluded=new AreaIndex(plan.exclusions);}

 /** Peso combinado das zonas menos as exclusões, 0..1. */
 maskAt(x:number,z:number):number{
  let inside=0;
  for(const zone of this.plan.zones){inside=Math.max(inside,areaWeight(zone,x,z));if(inside>=1)break;}
  if(inside<=0)return 0;
  let blocked=0;
  for(const exclusion of this.excluded.at(x,z)){blocked=Math.max(blocked,areaWeight(exclusion,x,z));if(blocked>=1)return 0;}
  return inside*(1-blocked);
 }

 /** Deslocamento vertical em metros, sempre >= 0. */
 offsetAt(x:number,z:number):number{
  const mask=this.maskAt(x,z);
  if(mask<=0)return 0;
  let raw=this.plan.pedestal;
  for(const feature of this.plan.features){
   if(feature.kind==='plateau'){raw+=feature.height*areaWeight(feature.area,x,z);continue;}
   const local=feature.area?areaWeight(feature.area,x,z):1;
   if(local>0)raw+=feature.amplitude*local*undulationAt(x,z,feature.scale,feature.seed);
  }
  for(const path of this.plan.paths){
   const weight=areaWeight({shape:'path',points:path.points.map(p=>[p[0],p[1]] as const),halfWidth:path.halfWidth,feather:path.feather},x,z);
   if(weight>0)raw=raw+(this.pathLevel(path,x,z)-raw)*weight;
  }
  return softFloor(raw,.35)*mask;
 }

 /** Altura absoluta da superfície esculpida. */
 heightAt(x:number,z:number):number{return this.plan.base(x,z)+this.offsetAt(x,z);}

 /** Normal da superfície esculpida por diferenças centrais — a mesma usada para sombrear a malha. */
 normalAt(x:number,z:number,step=this.plan.resolution*.5):{x:number;y:number;z:number}{
  const dx=(this.heightAt(x+step,z)-this.heightAt(x-step,z))/(2*step);
  const dz=(this.heightAt(x,z+step)-this.heightAt(x,z-step))/(2*step);
  const length=Math.hypot(dx,1,dz);
  return{x:-dx/length,y:1/length,z:-dz/length};
 }

 /** Inclinação da superfície esculpida em graus. */
 slopeAt(x:number,z:number):number{return Math.acos(Math.min(1,this.normalAt(x,z).y))*180/Math.PI;}

 /** Altura-alvo do caminho no ponto, interpolando os níveis dos nós pelo segmento mais próximo. */
 private pathLevel(path:ReliefPath,x:number,z:number):number{
  let best=Infinity,level=path.points[0]?.[2]??0;
  for(let i=0;i+1<path.points.length;i++){
   const a=path.points[i]!,b=path.points[i+1]!;
   const {distance,t}=segmentDistance(x,z,a[0],a[1],b[0],b[1]);
   if(distance<best){best=distance;level=a[2]+(b[2]-a[2])*t;}
  }
  return level;
 }
}

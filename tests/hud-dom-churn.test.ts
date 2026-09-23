import {describe,it,expect,afterEach} from 'vitest';
import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import {Viewport} from '@babylonjs/core/Maths/math.viewport';
import type {Camera} from '@babylonjs/core/Cameras/camera';
import type {EnemySwarm,DamageLabel} from '../src/game/EnemySwarm';
import type {RunInteractables} from '../src/run/RunInteractables';
import {RunProgression} from '../src/run/RunProgression';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents} from '../src/core/contracts';
import {RunHUD} from '../src/ui/CombatHUD';
import {installCountingDom,uninstallCountingDom,copyMetrics,deltaMetrics,domWrites,domNodes,type FakeElement} from './support/counting-dom';

/**
 * Custo de DOM do HUD de combate, medido sobre a implementação real de `RunHUD`.
 *
 * LIMITES HONESTOS DESTA MEDIÇÃO — ela NÃO é FPS:
 * - o DOM é o de `tests/support/counting-dom.ts`, que conta escritas e nós; não há layout, style
 *   recalc, composite nem paint, que é onde o browser gasta de verdade;
 * - o baseline de browser em `.temp/horde-perf-browser-baseline.md` é um snapshot, não benchmark;
 *   nada aqui autoriza afirmar ganho de FPS. O que estes testes provam é que o HUD deixou de
 *   reconstruir a árvore a cada atualização e passou a escrever só o que mudou.
 * - o custo de projeção (`Vector3.Project`) e as regras de CSS continuam fora da conta.
 */

const WIDTH=1920,HEIGHT=1080;

/** Câmera determinística com a matemática real do Babylon, sem engine nem `document`. */
class FakeCamera {
 readonly position=new Vector3(0,1.6,-12);
 readonly viewport=new Viewport(0,0,1,1);
 yaw=0;
 private readonly transform=Matrix.Identity();
 private readonly engine={getRenderWidth:():number=>WIDTH,getRenderHeight:():number=>HEIGHT};
 private forward():Vector3 {return new Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw));}
 getForwardRay():{direction:Vector3} {return {direction:this.forward()};}
 getTransformationMatrix():Matrix {
  const view=Matrix.LookAtLH(this.position,this.position.add(this.forward()),Vector3.Up());
  view.multiplyToRef(Matrix.PerspectiveFovLH(.8,WIDTH/HEIGHT,.1,400),this.transform);
  return this.transform;
 }
 getEngine():{getRenderWidth():number;getRenderHeight():number} {return this.engine;}
}

type SwarmActor=EnemySwarm['actors'][number];
interface Probe {health:{current:number;maximum:number;dead:boolean};healthTrail:number;hit:number;active:boolean;position:Vector3}

/** Ator com apenas o que o HUD lê: posição, caixa, vida, rastro de vida e piscada de dano. */
function fakeActor(x:number,z:number):SwarmActor&Probe {
 const position=new Vector3(x,0,z);
 return {
  active:true,kind:'tomato',variant:'normal',position,
  root:{position},
  body:{getBoundingInfo:():{boundingBox:{maximumWorld:{y:number}}}=>({boundingBox:{maximumWorld:{y:1.7}}})},
  health:{current:60,maximum:60,dead:false},
  healthTrail:60,hit:0,
 } as unknown as SwarmActor&Probe;
}

interface Supply {x:number;y:number;z:number;cost:number;used:boolean}

function harness(){
 const dom=installCountingDom();
 const run=new RunProgression(new EventBus<GameEvents>());
 const camera=new FakeCamera();
 const director={state:1,hordeMode:false,wave:1,intermission:0,time:0,waveQuota:12,spawned:0,completedWaves:0};
 const swarm={director,count:0,populationCap:24,kills:0,boss:undefined as unknown,bossHP:0,bossMaxHP:100,bossDeadTime:-1,labels:[] as DamageLabel[],actors:[] as (SwarmActor&Probe)[]};
 const interact={entries:[] as Supply[],districtContract:undefined as unknown,waveRewardGuide:undefined as unknown,nearest:undefined as unknown,nearestLoot:undefined as unknown,atRift:false,message:'',messageTime:0};
 const hud=new RunHUD();
 // `RunHUD` só deixa passar uma atualização a cada .1 s de tempo de run; .105 é o menor passo que
 // atravessa esse portão com folga para o erro de ponto flutuante acumulado.
 const tick=(dt=.105):void=>{run.time+=dt;hud.update(run,swarm as unknown as EnemySwarm,interact as unknown as RunInteractables,camera as unknown as Camera);};
 const panel=(selector:string):FakeElement=>dom.querySelector(selector)!;
 return {dom,run,swarm,interact,camera,hud,tick,panel};
}

let active:{hud:RunHUD}|undefined;
afterEach(()=>{active?.hud.dispose();active=undefined;uninstallCountingDom();});

/** Horda em leque à frente da câmera: todos dentro dos 28 m e dentro do frustum. */
function populate(swarm:{actors:(SwarmActor&Probe)[];count:number},count:number):void {
 swarm.actors.length=0;
 for(let i=0;i<count;i++)swarm.actors.push(fakeActor(-5+(i%5)*2.5,2+Math.floor(i/5)*3));
 swarm.count=count;
}

describe('churn de DOM do HUD de combate',()=>{
 it('monta o HUD uma vez e não escreve nada enquanto nada muda',()=>{
  const t=harness();active=t;
  t.run.time=10.05;populate(t.swarm,20);
  t.hud.update(t.run,t.swarm as unknown as EnemySwarm,t.interact as unknown as RunInteractables,t.camera as unknown as Camera);
  const built=copyMetrics(t.dom.metrics);
  expect(domNodes(built)).toBeGreaterThan(50); // montagem inicial: shell + painéis + 12 barras

  // Nove atualizações dentro do mesmo segundo de relógio: todo texto do HUD é idêntico.
  for(let i=0;i<9;i++)t.tick();
  const idle=deltaMetrics(built,t.dom.metrics);
  expect(idle).toEqual({elementsCreated:0,elementsParsed:0,innerHTML:0,style:0,text:0,attribute:0,className:0,hidden:0,inserted:0,removed:0});
 });

 it('em dez segundos parados só o relógio é reescrito',()=>{
  const t=harness();active=t;
  t.run.time=10.05;populate(t.swarm,20);t.tick(0);
  const built=copyMetrics(t.dom.metrics);
  for(let i=0;i<100;i++)t.tick();
  const idle=deltaMetrics(built,t.dom.metrics);
  expect(t.run.time).toBeCloseTo(20.55,6);
  expect(idle.innerHTML).toBe(10); // um por virada de segundo, só o painel .run-clock
  expect(idle.style+idle.text+idle.attribute+idle.className+idle.hidden+idle.inserted+idle.removed).toBe(0);
  expect(idle.elementsCreated).toBe(0);
  expect(idle.elementsParsed).toBe(40); // <b><span><strong><em> do relógio, dez vezes
 });

 it('dano numa praga muda largura e rótulo da barra, sem recriar nó algum',()=>{
  const t=harness();active=t;
  t.run.time=10.05;populate(t.swarm,20);t.tick(0);
  const bars=t.panel('.enemy-health-bars');
  expect(bars.querySelectorAll('.enemy-health')).toHaveLength(12);
  const first=bars.children[0]!;
  expect(first.className).toBe('enemy-health variant-normal');
  expect(first.getAttribute('role')).toBe('img');
  expect(first.getAttribute('aria-label')).toContain('60 de 60 de vida');
  const track=first.firstElementChild!;
  expect(track.children.map(i=>i.className)).toEqual(['health-trail','']);
  expect(track.children[1]!.style.width).toBe('100%');

  const target=t.swarm.actors.reduce((a,b)=>a.position.z<b.position.z?a:b);
  target.health.current=15;
  const before=copyMetrics(t.dom.metrics);
  t.tick();
  const hit=deltaMetrics(before,t.dom.metrics);
  expect(hit.elementsCreated+hit.elementsParsed).toBe(0);
  expect(hit.innerHTML).toBe(0);
  expect(hit.style).toBe(1);     // só a largura do preenchimento
  expect(hit.attribute).toBe(1); // só o aria-label
  expect(bars.querySelectorAll('.enemy-health').map(b=>b.firstElementChild!.children[1]!.style.width)).toContain('25%');
  expect(bars.querySelectorAll('.enemy-health').some(b=>(b.getAttribute('aria-label')??'').includes('15 de 60'))).toBe(true);
 });

 it('girar a câmera reposiciona as barras sem criar nós nem reescrever HTML de marcadores',()=>{
  const t=harness();active=t;
  t.run.time=10.05;populate(t.swarm,20);t.tick(0);
  const before=copyMetrics(t.dom.metrics);
  t.camera.yaw=.06;
  t.tick();
  const turn=deltaMetrics(before,t.dom.metrics);
  expect(turn.elementsCreated).toBe(0);
  expect(turn.style).toBeGreaterThan(0);          // as barras andaram
  expect(turn.innerHTML).toBeLessThanOrEqual(1);  // no máximo a bússola
  expect(t.panel('.enemy-health-bars').children).toHaveLength(12);
 });

 it('o pool não vaza: horda cresce e some dezenas de vezes e o DOM para de crescer',()=>{
  const t=harness();active=t;
  t.run.time=10.05;
  populate(t.swarm,20);t.tick(0);
  const settled=copyMetrics(t.dom.metrics);
  for(let cycle=0;cycle<60;cycle++){
   populate(t.swarm,cycle%2===0?0:20);
   t.tick();
  }
  const churn=deltaMetrics(settled,t.dom.metrics);
  expect(churn.elementsCreated).toBe(0); // nenhum marcador novo: os doze nós originais rodam o ciclo inteiro
  expect(t.hud.pooledMarkers).toBe(12);
  expect(t.panel('.enemy-health-bars').children).toHaveLength(12);
  // As doze ficam escondidas quando a horda some, em vez de serem destruídas e recriadas.
  populate(t.swarm,0);t.tick();
  expect(t.panel('.enemy-health-bars').children.every(bar=>bar.style.display==='none')).toBe(true);
  populate(t.swarm,20);t.tick();
  expect(t.panel('.enemy-health-bars').children.every(bar=>bar.style.display==='')).toBe(true);
 });

 it('números de dano e caixas de suprimento reusam os mesmos nós',()=>{
  const t=harness();active=t;
  t.run.time=10.05;
  for(let i=0;i<6;i++)t.swarm.labels.push({position:{x:-2+i,y:1.8,z:4},amount:10+i,crit:i===0,time:.7});
  for(let i=0;i<4;i++)t.interact.entries.push({x:-3+i*2,y:0,z:6+i,cost:25+i,used:false});
  t.tick(0);
  const labels=t.panel('.damage-labels'),supplies=t.panel('.world-supplies');
  expect(labels.children).toHaveLength(6);
  expect(labels.children[0]!.className).toBe('crit');
  expect(labels.children[0]!.textContent).toBe('10!');
  expect(labels.children[1]!.textContent).toBe('11');
  expect(supplies.children).toHaveLength(4);
  expect(supplies.children[0]!.textContent).toBe('◈BAÚ · 25 ◈');

  const originalLabels=[...labels.children],originalSupplies=[...supplies.children];
  t.swarm.labels.splice(0,4);
  t.interact.entries[0]!.used=true;
  t.tick();
  // O guia troca para o próximo baú; os marcadores continuam reutilizados.
  expect([...labels.children]).toEqual(originalLabels);
  expect([...supplies.children]).toEqual(originalSupplies);
  expect(labels.children).toHaveLength(6);   // quatro apagados, não removidos
  expect(labels.children.filter(l=>l.style.display==='none')).toHaveLength(4);
  expect(supplies.children.filter(s=>s.style.display==='none')).toHaveLength(1);
  expect(labels.children[0]!.textContent).toBe('14');
 });

 it('reescreve painéis quando os valores mudam de verdade',()=>{
  const t=harness();active=t;
  t.run.time=10.05;populate(t.swarm,4);t.tick(0);

  t.run.addItem('pruner');
  t.tick();
  expect(t.panel('.run-inventory').querySelectorAll('div')).toHaveLength(1);
  expect(t.panel('.run-inventory').querySelector('b')!.textContent).toBe('×1');
  expect(t.panel('.run-stats').querySelector('h2')!.textContent).toBe('EXTERMINADOR · NÍVEL 1');
  expect(t.panel('.run-stats').querySelector('.inventory-detail')!.children).toHaveLength(1);

  t.interact.message='Baú aberto';t.interact.messageTime=3;
  t.tick();
  expect(t.panel('.run-toast').textContent).toBe('Baú aberto');

  t.swarm.boss=t.swarm.actors[0];t.swarm.bossHP=40;
  t.tick();
  const boss=t.panel('.run-boss');
  expect(boss.hidden).toBe(false);
  expect(boss.querySelector('i')!.style.width).toBe('40%');
  expect(boss.querySelector('small')!.textContent).toBe('40 / 100');

  t.run.xp=20;
  t.tick();
  expect(t.panel('.run-xp').querySelector('span')!.textContent).toBe('NV. 1 · 20 / 45 XP');

  // Sem baú aberto o painel de contrato mostra a mensagem de rota concluída; com recompensa da
  // horda, a dica entra como último filho do MESMO painel (antes era um insertAdjacentHTML).
  t.interact.waveRewardGuide={drop:{item:{name:'Bateria'},landing:{x:4,y:0,z:9},waveField:'CAMPO NORTE'},distance:12.4};
  t.tick();
  const contract=t.panel('.district-contract');
  expect(contract.children[contract.children.length-1]!.className).toBe('wave-reward-guide');
  expect(contract.textContent).toContain('Bateria');
  expect(contract.textContent).toContain('CAMPO NORTE');
 });

 it('o painel TAB só é reconstruído quando nível, modo, atributos ou inventário mudam',()=>{
  const t=harness();active=t;
  t.run.time=10.05;t.tick(0);
  const stats=t.panel('.run-stats');
  expect(stats.querySelector('p')!.textContent).toContain('Contenha a infestação');

  const before=copyMetrics(t.dom.metrics);
  for(let i=0;i<9;i++)t.tick();
  expect(deltaMetrics(before,t.dom.metrics).innerHTML).toBe(0);

  t.swarm.director.hordeMode=true;
  t.tick();
  expect(stats.querySelector('p')!.textContent).toContain('Vença cada horda');

  t.run.addXP(200);
  t.tick();
  expect(stats.querySelector('h2')!.textContent).toBe('EXTERMINADOR · NÍVEL 3');
  expect(stats.querySelector('dd')!.textContent).toBe('154');
 });

 it('TAB alterna o painel e dispose solta o ouvinte e o HUD inteiro',()=>{
  const t=harness();active=t;
  const panel=t.panel('.run-stats');
  expect(panel.hidden).toBe(true);
  expect(t.dom.window.dispatchKey('Tab')).toBe(true);
  expect(panel.hidden).toBe(false);
  t.dom.window.dispatchKey('Tab');
  expect(panel.hidden).toBe(true);
  t.dom.window.dispatchKey('KeyE');
  expect(panel.hidden).toBe(true);

  expect(t.dom.window.listenerCount).toBe(1);
  expect(t.dom.body.children).toHaveLength(1);
  t.hud.dispose();active=undefined;
  expect(t.dom.window.listenerCount).toBe(0);
  expect(t.dom.body.children).toHaveLength(0);
 });

 /**
  * MAPA SEM BAÚS — o Test Map V1.0. `interact` chega `undefined` e o HUD de corrida tem de seguir
  * inteiro. Antes, `interact.entries` lançava na primeira atualização, e o laço de desenho do
  * Babylon morria nesse `TypeError`: jogo congelado na entrada, ENTER sem efeito, nenhum aviso.
  */
 it('mapa sem baús: atualiza sem lançar e o resto do HUD de corrida segue de pé',()=>{
  const t=harness();active=t;
  t.run.time=10.05;populate(t.swarm,4);
  const semBaus=():void=>t.hud.update(t.run,t.swarm as unknown as EnemySwarm,undefined,t.camera as unknown as Camera);
  expect(semBaus).not.toThrow();
  // Nada da economia de baús: sem contrato, sem etiqueta de suprimento, sem prompt de interação.
  expect(t.panel('.district-contract').textContent).toBe('');
  expect(t.panel('.world-supplies').children).toHaveLength(0);
  expect(t.panel('.run-interact').hidden).toBe(true);
  // O que não depende de baú continua: relógio, contagem da horda e barras de vida.
  expect(t.panel('.run-clock').textContent).toContain('00:10');
  expect(t.panel('.run-hostiles').textContent).toContain('4 / 24');
  expect(t.panel('.enemy-health-bars').children).toHaveLength(4);
  t.run.time+=.105;
  expect(semBaus).not.toThrow();
 });

 it('recomeço de tentativa com o tempo zerado redesenha o HUD em vez de ficar preso',()=>{
  const t=harness();active=t;
  t.run.time=300;populate(t.swarm,8);t.swarm.kills=41;t.tick(0);
  expect(t.panel('.run-hostiles').textContent).toContain('41 abatidos');
  t.run.reset();t.swarm.kills=0;populate(t.swarm,0);
  t.hud.update(t.run,t.swarm as unknown as EnemySwarm,t.interact as unknown as RunInteractables,t.camera as unknown as Camera);
  expect(t.panel('.run-hostiles').textContent).toContain('0 abatidos');
  expect(t.panel('.enemy-health-bars').children.every(bar=>bar.style.display==='none')).toBe(true);
 });
});

describe('quanto o pool economiza por atualização',()=>{
 it('mede nós e escritas por atualização com doze barras na tela',()=>{
  const t=harness();active=t;
  t.run.time=10.05;populate(t.swarm,20);t.tick(0);

  // Movimento contínuo: é o pior caso realista, tudo reposiciona todo quadro de HUD.
  const before=copyMetrics(t.dom.metrics);
  const rounds=30;
  for(let i=0;i<rounds;i++){
   for(const actor of t.swarm.actors)actor.position.z+=.05;
   t.camera.yaw+=.004;
   t.tick();
  }
  const moving=deltaMetrics(before,t.dom.metrics);

  // Referência: o markup que a versão anterior reconstruía por `innerHTML` a cada atualização.
  // Contamos apenas quantos nós esse HTML produz — sem inventar FPS.
  const scratch=t.dom.createElement('div');
  const legacy=copyMetrics(t.dom.metrics);
  scratch.innerHTML=Array.from({length:12},()=>'<div class="enemy-health variant-normal" style="left:50%;top:50%" role="img" aria-label="Tomate : 60 de 60 de vida"><div><i class="health-trail" style="width:100%"></i><i style="width:100%"></i></div></div>').join('');
  const perLegacyUpdate=deltaMetrics(legacy,t.dom.metrics).elementsParsed;

  expect(moving.elementsCreated).toBe(0);            // nenhum marcador recriado
  expect(moving.elementsParsed).toBeLessThan(rounds); // menos de um nó por atualização, só texto de painel
  expect(perLegacyUpdate).toBe(48);
  process.stdout.write(
   `\n[hud-dom] ${rounds} atualizações com 12 barras + câmera e pragas em movimento\n`+
   `  nós criados/parseados agora: ${domNodes(moving)} (${(domNodes(moving)/rounds).toFixed(1)}/atualização)\n`+
   `  só as barras, pelo markup anterior: ${perLegacyUpdate*rounds} (${perLegacyUpdate}/atualização)\n`+
   `  escritas de DOM agora: ${domWrites(moving)} (${(domWrites(moving)/rounds).toFixed(1)}/atualização: posição das barras, dos rótulos e da bússola)\n`+
   '  medição de nós e escritas, não de FPS: sem layout, paint nem GPU\n');
 });
});

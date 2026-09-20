import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import '@babylonjs/loaders/glTF';
import {ExpeditionSites,SITE_LOAD_ATTEMPTS} from '../src/world/ExpeditionSites';
import {CHALICE_NODES} from '../src/vfx/HarvestChaliceVisual';
import {ExpeditionObjectives,CHALICE_SIGNAL_SECONDS,FINAL_CHALICE_JUICE,TOTEM_RADIUS,
  type TotemProgress,type TotemSite} from '../src/run/ExpeditionObjectives';
import {StageJourney,JOURNEY_HARVEST_SECONDS,JOURNEY_BOARD_SECONDS,JOURNEY_MIN_TRAVEL_SECONDS} from '../src/stages/StageJourney';
import {RunProgression} from '../src/run/RunProgression';
import {PlayerClassChoice} from '../src/run/PlayerClass';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents} from '../src/core/contracts';

/**
 * Confiabilidade do cálice: ele existe em campo, ou o estágio NÃO fica pronto.
 *
 * O sintoma relatado foi "explorei o planeta inteiro e não achei cálice nenhum". A causa não era
 * sorteio: `ExpeditionSites.load` marcava `ready` assim que o SELO de runas chegava e largava
 * `void chalice.load()` no ar. Um GLB de copo que falhasse deixava o sítio com runas no chão, uma
 * luz de alcance 14 e nenhum objetivo visível — sem erro na tela e sem nova tentativa.
 *
 * Aqui se exercita o módulo REAL com os bytes REAIS dos dois GLB (`NullEngine`, sem navegador), e as
 * falhas são provocadas por injeção de asset corrompido — que é o análogo honesto, no teste, de uma
 * leitura de rede perdida.
 */

const SEAL=new Uint8Array(readFileSync('public/models/arcane-skill-ritual.glb'));
const CUP=new Uint8Array(readFileSync('public/models/harvest-chalice.glb'));
/** Bytes que NÃO são um `.glb`: o leitor recusa o cabeçalho e a promessa rejeita. */
const BROKEN=new Uint8Array([0x6e,0x6f,0x70,0x65,1,2,3,4,5,6,7,8]);

const siteAt=(x:number,z:number,name='Ilha do Cálice'):TotemSite=>
  ({id:'chalice-island',name,index:0,position:{x,y:0,z},radius:TOTEM_RADIUS,juiceTarget:FINAL_CHALICE_JUICE});
const totemOf=(site:TotemSite):TotemProgress=>({site,charged:0,state:'available'});

/** Uma cena por caso: o `NullEngine` não desenha nada, mas carrega e monta de verdade. */
function stage(options:{cup?:Uint8Array;seal?:Uint8Array}={}){
  const engine=new NullEngine(),scene=new Scene(engine);
  const sites=new ExpeditionSites(scene,undefined,undefined,
    {source:options.cup??CUP,pluginExtension:'.glb'},options.seal??SEAL,'.glb');
  const bowls=():number=>scene.meshes.filter(mesh=>mesh.name===CHALICE_NODES.bowl).length;
  return {scene,sites,bowls,meshCount:()=>scene.meshes.length,
    close:()=>{sites.dispose();scene.dispose();engine.dispose();}};
}

describe('o sítio do cálice só fica pronto com o copo em cena',()=>{
  it('a promessa de `load` é esperável: nada está pronto antes dela resolver',async()=>{
    const {scene,sites,bowls,close}=stage();
    try{
      const loading=sites.load([totemOf(siteAt(140,0))]);
      // O ponto da correção: durante a carga o sítio NÃO se declara pronto.
      expect(sites.ready).toBe(false);
      expect(sites.status).toBe('loading');
      expect(bowls()).toBe(0);
      expect(await loading).toBe(true);
      expect(sites.ready).toBe(true);
      expect(sites.status).toBe('ready');
      expect(sites.error).toBe('');
      expect(sites.attempts).toBe(1);
      // O copo AUTORAL está na cena, e não só o selo de runas.
      expect(bowls()).toBe(1);
      for(const name of [CHALICE_NODES.bowl,CHALICE_NODES.frame,CHALICE_NODES.juice])
        expect(scene.meshes.some(mesh=>mesh.name===name),name).toBe(true);
    } finally {close();}
  });

  it('um copo que não carrega reprova o sítio INTEIRO, mesmo com o selo perfeito',async()=>{
    const {sites,bowls,close}=stage({cup:BROKEN});
    try{
      expect(await sites.load([totemOf(siteAt(140,0))])).toBe(false);
      // Era exatamente este o estado jogável de antes: selo pronto, copo ausente, ninguém avisado.
      expect(sites.ready).toBe(false);
      expect(sites.status).toBe('failed');
      expect(sites.error).not.toBe('');
      expect(bowls()).toBe(0);
    } finally {close();}
  });

  it('a repetição é limitada e some com o estado parcial entre as tentativas',async()=>{
    const {sites,meshCount,close}=stage({cup:BROKEN});
    try{
      const before=meshCount();
      expect(await sites.load([totemOf(siteAt(140,0))])).toBe(false);
      // Três tentativas, não uma e não um laço infinito.
      expect(sites.attempts).toBe(SITE_LOAD_ATTEMPTS);
      expect(sites.error).toContain(`${SITE_LOAD_ATTEMPTS}/${SITE_LOAD_ATTEMPTS}`);
      // Nenhum selo órfão sobrou das tentativas fracassadas.
      expect(meshCount()).toBe(before);
    } finally {close();}
  });

  it('um selo que não carrega também não libera o sítio',async()=>{
    const {sites,bowls,close}=stage({seal:BROKEN});
    try{
      expect(await sites.load([totemOf(siteAt(140,0))])).toBe(false);
      expect(sites.ready).toBe(false);
      expect(sites.status).toBe('failed');
      expect(sites.attempts).toBe(SITE_LOAD_ATTEMPTS);
      expect(bowls()).toBe(0);
    } finally {close();}
  });

  it('`dispose` no meio da carga devolve `false` e não deixa nada em cena',async()=>{
    const {scene,sites,bowls,close}=stage();
    try{
      const before=scene.meshes.length;
      const loading=sites.load([totemOf(siteAt(140,0))]);
      // Troca de estágio/reinício no quadro seguinte ao pedido: a carga em voo tem de desistir.
      sites.dispose();
      expect(await loading).toBe(false);
      expect(sites.ready).toBe(false);
      expect(bowls()).toBe(0);
      expect(scene.meshes.length).toBe(before);
    } finally {close();}
  });

  /**
   * Um cálice visível por estágio — que é o caminho REAL da cena: cada plano constrói um
   * `ExpeditionSites` novo e descarta o anterior. Este teste percorre esse ciclo duas vezes.
   *
   * ATENÇÃO (limitação conhecida, ver o relatório): `load` NÃO é reentrante na mesma instância.
   * Chamá-lo duas vezes sem `dispose` no meio empilha o sítio anterior (dois copos em cena), porque
   * `teardownBuilt` só roda entre TENTATIVAS fracassadas. A cena não faz isso hoje; um caminho novo
   * que recarregue o mesmo objeto precisa de `dispose` antes — ou de um `teardownBuilt` no início
   * de `load`.
   */
  it('exatamente um cálice em cena a cada estágio, e o sítio anterior sai inteiro',async()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    const bowls=():number=>scene.meshes.filter(mesh=>mesh.name===CHALICE_NODES.bowl).length;
    const build=()=>new ExpeditionSites(scene,undefined,undefined,
      {source:CUP,pluginExtension:'.glb'},SEAL,'.glb');
    try{
      const first=build();
      expect(await first.load([totemOf(siteAt(140,0))])).toBe(true);
      expect(bowls()).toBe(1);
      // Viagem: o sítio do estágio 1 é descartado e o do 2 é montado do zero.
      first.dispose();
      expect(bowls()).toBe(0);
      const second=build();
      expect(await second.load([totemOf(siteAt(-90,60,'Outra Ilha'))])).toBe(true);
      expect(bowls()).toBe(1);
      second.dispose();
      expect(bowls()).toBe(0);
      expect(scene.meshes.length).toBe(0);
    } finally {scene.dispose();engine.dispose();}
  });
});

describe('a busca do cálice nunca é infinita',()=>{
  const objectives=():ExpeditionObjectives=>{
    const o=new ExpeditionObjectives();
    o.setSites([siteAt(400,400,'Planalto Distante')]);
    return o;
  };
  /** Longe do cálice: nenhuma descoberta por proximidade interfere no relógio da busca. */
  const FAR={x:0,y:0,z:0};
  const explore=(o:ExpeditionObjectives,seconds:number,searching=true,alive=true):void=>{
    for(let i=0;i<Math.round(seconds*60);i++)o.update(1/60,FAR,alive,searching);
  };

  it('revela o rumo depois de `CHALICE_SIGNAL_SECONDS` de busca ATIVA',()=>{
    const o=objectives();
    explore(o,CHALICE_SIGNAL_SECONDS-1);
    expect(o.discovered).toBe(false);
    expect(o.signalAcquired).toBe(false);
    expect(o.searchSeconds).toBeCloseTo(CHALICE_SIGNAL_SECONDS-1,1);
    explore(o,1.2);
    expect(o.discovered).toBe(true);
    expect(o.signalAcquired).toBe(true);
    // O anúncio é audível na interface: mensagem viva com o nome da ilha.
    expect(o.messageTime).toBeGreaterThan(0);
    expect(o.message).toContain('SINAL');
    expect(o.message).toContain('Planalto Distante');
    // E o evento NÃO começa sozinho: revelar não é ativar.
    expect(o.phase).toBe('totems');
    expect(o.current).toBeUndefined();
  });

  it('menu, entrada pela nave, viagem e pausa não creditam segundo nenhum',()=>{
    const o=objectives();
    explore(o,CHALICE_SIGNAL_SECONDS*3,false);
    expect(o.searchSeconds).toBe(0);
    expect(o.discovered).toBe(false);
    // Retomado o controle, a busca conta a partir do zero e ainda leva o tempo cheio.
    explore(o,CHALICE_SIGNAL_SECONDS-2);
    expect(o.discovered).toBe(false);
    explore(o,3);
    expect(o.discovered).toBe(true);
  });

  it('morto não busca: o relógio para enquanto o exterminador está no chão',()=>{
    const o=objectives();
    explore(o,CHALICE_SIGNAL_SECONDS*2,true,false);
    expect(o.searchSeconds).toBe(0);
    expect(o.discovered).toBe(false);
  });

  it('achar o cálice andando é descoberta, não sinal',()=>{
    const o=new ExpeditionObjectives();
    o.setSites([siteAt(0,0,'Campo Vizinho')]);
    o.update(1/60,{x:10,y:0,z:0},true,true);
    expect(o.discovered).toBe(true);
    expect(o.signalAcquired).toBe(false);
    expect(o.message).toContain('ENCONTRADO');
  });

  it('`reset` zera o relógio da busca — estágio novo começa às cegas de novo',()=>{
    const o=objectives();
    explore(o,CHALICE_SIGNAL_SECONDS+1);
    expect(o.signalAcquired).toBe(true);
    o.reset();
    expect(o.discovered).toBe(false);
    expect(o.signalAcquired).toBe(false);
    expect(o.searchSeconds).toBe(0);
    // E o sinal não volta de graça: o tempo tem de ser gasto outra vez.
    explore(o,CHALICE_SIGNAL_SECONDS-5);
    expect(o.discovered).toBe(false);
  });
});

/**
 * Travessia do estágio 1 para o 2 com a lógica PURA que a cena usa: objetivos, viagem e progressão.
 * A classe é deliberadamente externa a `RunProgression` — é ela que sobrevive a estágio e a morte.
 */
describe('o embarque no cálice atravessa o estágio sem custo',()=>{
  function run(){
    const events=new EventBus<GameEvents>();
    const progression=new RunProgression(events);
    const objectives=new ExpeditionObjectives();
    const journey=new StageJourney();
    const store=new Map<string,string>();
    const choice=new PlayerClassChoice({getItem:k=>store.get(k)??null,setItem:(k,v)=>{store.set(k,v);}});
    choice.choose('soldier');
    const site=siteAt(140,0);
    objectives.setSites([site]);
    for(const id of ['pruner','pruner','belt','battery'])progression.addItem(id);
    for(let i=0;i<40;i++)progression.reward();
    return {progression,objectives,journey,choice,site};
  }

  it('cálice cheio + chefe morto + `E` levam ao estágio 2 com itens, nível e classe intactos',()=>{
    const {progression,objectives,journey,choice,site}=run();
    const at=site.position;
    objectives.activate(at);
    let sequence=0;
    while(objectives.current&&objectives.current.state!=='complete')
      objectives.harvest({sequence:++sequence,kind:'watermelon',position:at},at,true);
    objectives.bossSpawned=true;objectives.onBossKilled(at);
    expect(objectives.phase).toBe('extract');

    const inventory=new Map(progression.inventory),level=progression.level;
    const damage=progression.stats.damage,maxHP=progression.stats.maxHP;
    expect(progression.credits).toBeGreaterThan(0);

    expect(objectives.collect(at)).toBeDefined();
    expect(journey.begin(1,'Bosque Gigante')).toBe(true);
    let advances=0;
    const pending=siteAt(-260,120,'Outra Ilha');
    for(let i=0;i<Math.round((JOURNEY_HARVEST_SECONDS+JOURNEY_BOARD_SECONDS+JOURNEY_MIN_TRAVEL_SECONDS+1)*60);i++){
      journey.update(1/60);
      if(journey.takeLoadRequest())journey.routeReady();
      if(journey.takeArrival()){
        if(journey.consumeAdvance()){progression.advanceStage();advances++;}
        objectives.reset();objectives.setSites([pending]);
      }
      if(journey.phase==='arrival')journey.arrived();
      if(journey.phase==='done')journey.reset();
    }

    expect(advances).toBe(1);
    expect(progression.stage).toBe(2);
    expect(new Map(progression.inventory)).toEqual(inventory);
    expect(progression.level).toBeGreaterThanOrEqual(level);
    expect(progression.stats.damage).toBeGreaterThanOrEqual(damage-1e-9);
    expect(progression.stats.maxHP).toBeGreaterThanOrEqual(maxHP);
    // Regra existente e anunciada: os créditos restantes viram XP no embarque.
    expect(progression.credits).toBe(0);
    // A classe é da TENTATIVA, não do estágio.
    expect(choice.id).toBe('soldier');
    // E o estágio 2 começa com um cálice por achar, do zero.
    expect(objectives.totems).toHaveLength(1);
    expect(objectives.totems[0]!.site.name).toBe('Outra Ilha');
    expect(objectives.totems[0]!.charged).toBe(0);
    expect(objectives.phase).toBe('totems');
    expect(objectives.discovered).toBe(false);
    expect(objectives.searchSeconds).toBe(0);
    expect(objectives.collected).toBe(false);
  });
});

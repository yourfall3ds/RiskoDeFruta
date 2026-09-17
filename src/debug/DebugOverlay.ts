export interface DebugSnapshot {
  backend: string; renderer:string;gpuMs:number; seed: string; tick: number; droppedSeconds: number; steps: number;
  fps: number; frameMs: number; drawCalls: number; activeMeshes: number; triangles: number;
  entities: number; aiJobs: number; aiTicks: number; poolActive: number; poolCapacity: number;
  poolPeak: number; poolMisses: number; definitions: number; listeners: number;
  player?: string;
  paused?: boolean;
  simulationMs?:number;presentationMs?:number;
}
export interface DebugActions { restartSame(): void; restartNew(): void; pause(): boolean; configure(name: string,value: number): void }

export class DebugOverlay {
  private readonly panel = document.createElement('aside');
  private readonly metrics = document.createElement('pre');
  private readonly toggle = document.createElement('button');
  private elapsed = 0;
  private pauseButton!:HTMLButtonElement;
  private readonly keydown = (event: KeyboardEvent): void => {
    if (event.code === 'F1') { event.preventDefault(); this.setVisible(this.panel.hidden); }
  };

  constructor(actions: DebugActions) {
    this.panel.id = 'debug';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Diagnóstico do jogo');
    const title = document.createElement('h1');
    title.textContent = 'MUTANT FARM · DIAGNÓSTICO';
    const description = document.createElement('p');
    description.textContent = 'Métricas e controles de validação da run.';
    this.panel.append(title, description, this.metrics);
    const buttons = document.createElement('div');
    const entries: [string, () => void][] = [
      ['Reiniciar mesma seed', () => actions.restartSame()],
      ['Nova seed', () => actions.restartNew()],
      ['Pausar simulação', () => { this.pauseButton.textContent = actions.pause() ? 'Retomar simulação' : 'Pausar simulação'; }],
    ];
    for (const [label, callback] of entries) {
      const button = document.createElement('button'); button.textContent = label;
      button.addEventListener('click', callback); buttons.append(button); if(label==='Pausar simulação')this.pauseButton=button;
    }
    this.panel.append(buttons);
    const tools=document.createElement('div');tools.className='debug-tools';
    for(const [name,label] of [['review-loot','Revisar compra de baú (QA)'],['review-crate','Revisar caixa quebrável (QA)'],['eggplant-rush','Testar atropelamento'],['carrot-laser','Testar laser da cenoura'],['city','Visitar cidade agrícola'],['frontier','Visitar pomar dos ventos'],['grain-port','Visitar porto dos grãos'],['glasshouse','Visitar distrito das estufas'],['highlands','Visitar planaltos agrícolas'],['rootwood','Visitar bosque gigante'],['horizon-review','Revisar horizonte das estufas'],['sky-raw','Céu sem mistura (QA)'],['sky-blended','Céu com mistura (QA)'],['tomato-fire','Testar tomate incendiário'],['camera-audit','Auditar obstrução da câmera'],['element-fire','VFX Fogo'],['element-water','VFX Água'],['element-earth','VFX Terra'],['element-electricity','VFX Eletricidade'],['element-darkness','VFX Trevas'],['element-explosion','VFX Explosão'],['element-off','Encerrar prévia VFX'],['pose-skill1','Pose heroica I (QA)'],['pose-skill2','Pose heroica II (QA)'],['pose-skill3','Pose heroica III (QA)'],['pose-end','Sair da revisão de pose'],['intro-replay','Entrada: reencenar da nave'],['intro-skip','Entrada: pular'],['melee-review','Corpo a corpo: revisar combo'],['melee-previous','Corpo a corpo: etapa anterior'],['melee-next','Corpo a corpo: próxima etapa'],['melee-contact','Corpo a corpo: pose de contato'],['melee-frame-back','Corpo a corpo: −1 quadro'],['melee-frame','Corpo a corpo: +1 quadro'],['melee-play','Corpo a corpo: voltar ao ciclo'],['melee-rate','Corpo a corpo: trocar ritmo'],['melee-end','Corpo a corpo: sair da revisão'],['reload','Recarga acrobática (QA)'],['reload-run','Recarga correndo (QA)'],['skinning-cpu','Personagem na CPU (QA)'],['skinning-gpu','Personagem na GPU (QA)'],['wave-clear','Finalizar horda (QA)'],['wave5','Revisar horda 5 (QA)'],['all-perks','Receber 90 itens (QA)'],['heal','Restaurar vida'],['hit-player','Receber dano (QA)'],['fatal-player','Revisar morte (QA)'],['invincible','Alternar invulnerabilidade'],['review-enemies','Revisar 5 originais'],['hit-enemy','Dano no próximo (QA)'],['kill-enemy','Ragdoll no próximo (QA)'],['population','Testar 50 hostis'],['population100','Benchmark 100 hostis'],['population150','Benchmark 150 hostis'],['boss','Convocar Praga Alfa'],['clear-boss','Finalizar chefe (QA)'],['ferry','Ir à ilha móvel'],['review-cliff','Revisar encosta'],['review-east-bridge','Revisar ponte leste'],['safe-return','Testar retorno da queda'],['review-chalice','Revisar cálice'],['normal-horde','Horda normal (24)'],['barn','Ir ao celeiro'],['shop','Ir ao mercado'],['loot','Receber item (QA)'],['skill1','Leque ricocheteante (QA)'],['skill2','Mortal (QA)'],['skill3','Tempestade (QA)'],['weather-sun','Clima: sol (QA)'],['weather-overcast','Clima: nublado (QA)'],['weather-rain','Clima: chuva (QA)'],['weather-dusk','Clima: crepúsculo (QA)'],['weather-night','Clima: noite (QA)'],['weather-auto','Clima: voltar ao ciclo']] as const){const button=document.createElement('button');button.textContent=label;button.onclick=()=>actions.configure(name,1);tools.append(button);}
    // Estúdio de sons: abre em outra aba e as trocas chegam a esta partida pelo BroadcastChannel.
    const studio=document.createElement('a');studio.className='debug-studio';studio.href='/audio-lab.html';studio.target='_blank';studio.rel='noopener';
    studio.textContent='Trocar sons dos inimigos ↗';studio.title='Ouvir e substituir cada som de inimigo. A partida aberta recebe as mudanças sem recarregar.';
    tools.append(studio);
    const extraction=document.createElement('button');extraction.textContent='Concluir cálice e chefe (QA)';
    extraction.onclick=()=>actions.configure('complete-chalice',1);tools.append(extraction);
    this.panel.append(tools);
    for(const [name,label,min,max,step,value] of [['distance','Distância da câmera',1.5,9,.05,2.25],['fov','Campo de visão',50,100,1,60],['shake','Intensidade de shake',0,1,.05,.35]] as const) {
      const row=document.createElement('label');row.className='debug-setting';row.textContent=label;
      const input=document.createElement('input');input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(value);input.setAttribute('aria-label',label);
      const output=document.createElement('output');output.textContent=String(value);
      input.oninput=()=>{output.textContent=input.value;actions.configure(name,Number(input.value));};
      row.append(input,output);this.panel.append(row);
    }
    this.toggle.id = 'debug-toggle';
    this.toggle.textContent = 'F1 · Diagnóstico';
    this.toggle.setAttribute('aria-controls', 'debug');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.onclick = () => this.setVisible(this.panel.hidden);
    document.body.append(this.panel, this.toggle);
    window.addEventListener('keydown', this.keydown);
  }
  private setVisible(visible: boolean): void {
    this.panel.hidden = !visible;
    this.toggle.setAttribute('aria-expanded', String(visible));
    this.elapsed = 1;
  }
  update(dt: number, read: () => DebugSnapshot): void {
    this.elapsed += dt;
    if (this.panel.hidden || this.elapsed < 0.2) return;
    this.elapsed = 0;
    const m = read();
    this.pauseButton.textContent=m.paused?'Retomar simulação':'Pausar simulação';
    this.metrics.textContent = [
      `Backend          ${m.backend}`,
      `GPU              ${m.renderer}`,
      `Seed             ${m.seed}`,
      `FPS              ${m.fps.toFixed(0)}`,
      `Simulação CPU    ${(m.simulationMs??0).toFixed(2)} ms/quadro`,
      `Apresentação CPU ${(m.presentationMs??0).toFixed(2)} ms/quadro`,
      `Cena Babylon     ${m.frameMs.toFixed(2)} ms`,
      `Frame GPU        ${m.gpuMs>0?m.gpuMs.toFixed(2)+' ms':'indisponível'}`,
      `Draw calls       ${m.drawCalls}`,
      `Meshes ativos    ${m.activeMeshes}`,
      `Triângulos       ${m.triangles}`,
      `Tick 60 Hz       ${m.tick}`,
      `Passos/frame     ${m.steps}`,
      `Tempo descartado ${m.droppedSeconds.toFixed(3)} s`,
      `Entidades        ${m.entities}`,
      `IA jobs/ticks    ${m.aiJobs} / ${m.aiTicks}`,
      `Pool ativo/total ${m.poolActive} / ${m.poolCapacity}`,
      `Tiros pico/falhas ${m.poolPeak} / ${m.poolMisses}`,
      `Definições       ${m.definitions}`,
      `Event listeners  ${m.listeners}`,
      m.player??'',
      '', 'População e recursos: consultar HUD',
      'VFX: atividade indicada no pool acima',
      'Controles QA não são aplicados em uma nova run.',
    ].join('\n');
  }
  dispose(): void {
    window.removeEventListener('keydown', this.keydown);
    this.panel.remove(); this.toggle.remove();
  }
}




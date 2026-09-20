import {describe,it,expect,vi,afterEach} from 'vitest';
import {WeaponAudio} from '../src/audio/RecordedAudio';
import {EnemyAudioOverrides} from '../src/audio/EnemyAudioOverrides';
import {ENEMY_ATTACK_LAYERS,enemyAudioGroup} from '../src/audio/EnemyAudioCatalog';

/** Contexto de áudio falso que registra cada fonte iniciada. */
function stubAudio(){
  const played:{buffer:unknown;gain:number;rate:number}[]=[];
  const parameter=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},setTargetAtTime(){}});
  const node=()=>({connect(){},disconnect(){},gain:parameter(),pan:parameter()});
  class Context {
    state='running';currentTime=10;destination={};
    resume(){return Promise.resolve();}
    close(){return Promise.resolve();}
    createGain(){const g=node();return g;}
    createStereoPanner(){return node();}
    decodeAudioData(){return Promise.resolve({duration:.25} as AudioBuffer);}
    createBufferSource(){
      const source={...node(),buffer:null as unknown,playbackRate:parameter(),
        start(){played.push({buffer:source.buffer,gain:(source as {_gain?:number})._gain??0,rate:source.playbackRate.value});},
        stop(){},onended:null};
      return source;
    }
  }
  // O ganho é definido no GainNode, não na fonte: interceptamos pelo createGain mais recente.
  let lastGain=0;
  const context=new Context();
  const originalGain=context.createGain.bind(context);
  context.createGain=()=>{const g=originalGain();Object.defineProperty(g.gain,'value',{get:()=>lastGain,set:(v:number)=>{lastGain=v;},configurable:true});return g;};
  const originalSource=context.createBufferSource.bind(context);
  context.createBufferSource=()=>{const s=originalSource();const start=s.start.bind(s);s.start=()=>{played.push({buffer:s.buffer,gain:lastGain,rate:s.playbackRate.value});void start;};return s;};
  return {Context:class {constructor(){return context;}},played,context};
}

const manifest={
  spawn:['/spawn.wav'],growl:['/growl.wav'],attack:['/attack.wav'],hurt:['/hurt.wav'],death:['/death.wav'],
  swish:['/swish.wav'],heavy:['/heavy.wav'],pistol:['/pistol.wav'],throw:['/throw.wav'],charge:['/charge.wav'],impact:['/impact.wav'],
  'enemy-corn-attack':['/corn-attack.wav'],
};

function makeAudio(overrides?:EnemyAudioOverrides|null){
  const stub=stubAudio();
  vi.stubGlobal('AudioContext',stub.Context);
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>manifest,arrayBuffer:async()=>new ArrayBuffer(8)})));
  const audio=new WeaponAudio(overrides===undefined?{}:{enemyOverrides:overrides});
  return {audio,played:stub.played,context:stub.context};
}
afterEach(()=>vi.unstubAllGlobals());

async function settled(audio:WeaponAudio,played:unknown[]){
  audio.unlock();
  await vi.waitFor(()=>expect(played.length).toBe(0),{timeout:2000}).catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,60));
}

describe('estúdio de sons ligado ao jogo',()=>{
  it('o ataque toca voz e ruído como dois eventos independentes',async()=>{
    const overrides=new EnemyAudioOverrides({storage:null,channel:null,manifest});
    await overrides.ready;
    const {audio,played}=makeAudio(overrides);
    await settled(audio,played);
    const before=played.length;
    audio.enemy('attack','corn',2);
    expect(played.length-before).toBe(2); // voz + ruído
    audio.dispose();overrides.dispose();
  });
  it('silenciar só o ruído mantém a voz do ataque',async()=>{
    const overrides=new EnemyAudioOverrides({storage:null,channel:null,manifest});
    await overrides.ready;
    await overrides.setMuted('corn','attack-layer',true);
    const {audio,played}=makeAudio(overrides);
    await settled(audio,played);
    const before=played.length;
    audio.enemy('attack','corn',2);
    expect(played.length-before).toBe(1);
    audio.dispose();overrides.dispose();
  });
  it('silenciar a voz mantém o ruído',async()=>{
    const overrides=new EnemyAudioOverrides({storage:null,channel:null,manifest});
    await overrides.ready;
    await overrides.setMuted('corn','attack',true);
    const {audio,played}=makeAudio(overrides);
    await settled(audio,played);
    const before=played.length;
    audio.enemy('attack','corn',2);
    expect(played.length-before).toBe(1);
    audio.dispose();overrides.dispose();
  });
  it('silenciar o ruído do milho NÃO silencia a pistola do jogador',async()=>{
    const overrides=new EnemyAudioOverrides({storage:null,channel:null,manifest});
    await overrides.ready;
    await overrides.setMuted('corn','attack-layer',true);
    expect(ENEMY_ATTACK_LAYERS.corn).toBe('throw'); // agora com grupo próprio, sem compartilhar com a pistola do jogador
    const {audio,played}=makeAudio(overrides);
    await settled(audio,played);
    const before=played.length;
    audio.shot(false);
    expect(played.length-before).toBe(1);
    audio.dispose();overrides.dispose();
  });
  it('silenciar um evento de uma espécie não afeta as outras',async()=>{
    const overrides=new EnemyAudioOverrides({storage:null,channel:null,manifest});
    await overrides.ready;
    await overrides.setMuted('eggplant','spawn',true);
    const {audio,played}=makeAudio(overrides);
    await settled(audio,played);
    let before=played.length;
    audio.enemy('spawn','eggplant',2);
    expect(played.length-before).toBe(0);
    before=played.length;
    audio.enemy('spawn','watermelon',2);
    expect(played.length-before).toBe(1);
    audio.dispose();overrides.dispose();
  });
  it('volume zero silencia e volume alto continua tocando',async()=>{
    const overrides=new EnemyAudioOverrides({storage:null,channel:null,manifest});
    await overrides.ready;
    await overrides.setUserGain('watermelon','death',0);
    const {audio,played}=makeAudio(overrides);
    await settled(audio,played);
    let before=played.length;
    audio.enemy('death','watermelon',2);
    expect(played.length-before).toBe(0);
    await overrides.setUserGain('watermelon','death',1.8);
    before=played.length;
    audio.enemy('death','watermelon',3);
    expect(played.length-before).toBe(1);
    audio.dispose();overrides.dispose();
  });
  it('sem painel o jogo continua tocando os padrões do catálogo',async()=>{
    const {audio,played}=makeAudio(null);
    await settled(audio,played);
    const before=played.length;
    audio.enemy('spawn','eggplant',2);
    expect(played.length-before).toBe(1);
    audio.dispose();
  });
  it('espécie ou evento desconhecido não inventa som',async()=>{
    const {audio,played}=makeAudio(null);
    await settled(audio,played);
    const before=played.length;
    audio.enemy('spawn','batata' as never,2);
    audio.enemy('cantar' as never,'eggplant',2);
    audio.enemy('spawn','eggplant',400);
    expect(played.length).toBe(before);
    audio.dispose();
  });
  it('o arquivo do usuário é tocado no lugar do padrão, e restaurar volta ao padrão',async()=>{
    const {audio,played,context}=makeAudio(null);
    const overrides=new EnemyAudioOverrides({storage:null,channel:null,manifest,context:context as unknown as BaseAudioContext});
    await overrides.ready;
    const custom={duration:9.99} as AudioBuffer; // marcador reconhecível
    await overrides.setOverride('eggplant','spawn',{name:'meu.wav',type:'audio/wav',bytes:new ArrayBuffer(8)});
    // O contexto falso devolve sempre o mesmo objeto decodificado; marcamos o buffer devolvido.
    const stored=overrides.getBuffer(context as unknown as BaseAudioContext,'eggplant','spawn');
    expect(stored).toBeDefined();
    expect(overrides.lookup('eggplant','spawn').custom).toBe(true);
    void custom;

    const withPanel=new WeaponAudio({enemyOverrides:overrides});
    await settled(withPanel,played);
    const before=played.length;
    withPanel.enemy('spawn','eggplant',2);
    expect(played.length-before).toBe(1);
    expect(played.at(-1)!.buffer).toBe(stored); // tocou o arquivo do usuário, não o do manifest

    await overrides.restoreEvent('eggplant','spawn');
    expect(overrides.lookup('eggplant','spawn').custom).toBe(false);
    expect(overrides.getBuffer(context as unknown as BaseAudioContext,'eggplant','spawn')).toBeUndefined();
    withPanel.dispose();audio.dispose();overrides.dispose();
  });
  it('os padrões saem do catálogo compartilhado, sem segunda tabela no runtime',()=>{
    // Se o runtime tivesse tabela própria, estes mapeamentos poderiam divergir do painel.
    expect(enemyAudioGroup('eggplant','windup')).toBe('growl');
    expect(enemyAudioGroup('eggplant','hit')).toBe('hurt');
    expect(enemyAudioGroup('eggplant','dodge')).toBe('swish');
    expect(enemyAudioGroup('tomato','attack-layer')).toBe('swish');
    expect(enemyAudioGroup('carrot','attack-layer')).toBe('charge');
  });
});

import {describe,it,expect} from 'vitest';
import {FootstepSync,type FootSide} from '../src/animation/FootstepSync';

/**
 * Passada sintética com a forma REAL medida nos clipes: um platô de apoio baixo e um arco de
 * balanço. Os valores padrão são os do pior caso do rig — `WalkBackward`/`StrafeLeft`, que sobem só
 * até 15,7 cm e apoiam a 3,7 cm. Era exatamente esse clipe que o limiar antigo de soltura (17 cm)
 * tornava invisível: o pé nunca "soltava", então depois do primeiro apoio o jogo ficava mudo de ré
 * e de lado. Os números vêm de `docs/footstep-clip-contacts.json`.
 */
function gait(phase:number,lift=.157,floor=.037):{side:FootSide;height:number}[]{
  const arc=(p:number):number=>floor+(lift-floor)*Math.max(0,Math.sin(p*Math.PI*2));
  return [{side:0,height:arc(phase)},{side:1,height:arc(phase+.5)}];
}
interface WalkOptions {speed?:number;grounded?:boolean;strideSeconds?:number;lift?:number;dt?:number;seconds?:number}
/** Roda `seconds` de passada e devolve os pés que tocaram, na ordem. */
function walk(sync:FootstepSync,{speed=5.5,grounded=true,strideSeconds=.8,lift=.157,dt=1/60,seconds=3.2}:WalkOptions={}){
  const hits:FootSide[]=[];
  for(let elapsed=0,i=0;elapsed<seconds;elapsed+=dt,i++){
    // Começa com um pé no ar e o outro apoiado, como em qualquer passada real.
    sync.update(dt,gait(.25+elapsed/strideSeconds,lift),grounded,speed,side=>hits.push(side));
  }
  return hits;
}

describe('passos pelo contato do pé',()=>{
  it('alterna os pés, um passo por apoio',()=>{
    const sync=new FootstepSync();
    const hits=walk(sync,{seconds:3.2,strideSeconds:.8});
    expect(hits.length).toBe(8);   // dois apoios por passada, quatro passadas
    for(let i=1;i<hits.length;i++)expect(hits[i]).not.toBe(hits[i-1]);
    expect(sync.crowded).toBe(0);
  });

  it('detecta o clipe de menor amplitude do rig — ré e lateral, que o limiar antigo apagava',()=>{
    // 15,7 cm de pico é o teto de `WalkBackward`, `StrafeLeft` e `StrafeRight`. O detector antigo
    // exigia 17 cm para soltar o pé: o primeiro apoio prendia e nenhum outro passo saía.
    const sync=new FootstepSync();
    expect(walk(sync,{lift:.157,strideSeconds:1.1,seconds:4.4}).length).toBe(8);
    // E o pico precisa mesmo passar do rearme, senão isto estaria medindo sorte.
    expect(.157).toBeGreaterThan(sync.liftHeight);
  });

  it('não soa no primeiro quadro, com o pé já no chão',()=>{
    // O defeito clássico (e o da referência): `previousHeight` começa em zero e o primeiro quadro
    // vira uma descida inventada. Aqui o primeiro quadro de cada pé só semeia o estado.
    const sync=new FootstepSync();let hits=0;
    sync.update(1/60,[{side:0,height:.02},{side:1,height:.02}],true,6,()=>hits++);
    expect(hits).toBe(0);
    expect(sync.steps).toBe(0);
  });

  it('exige que o pé suba antes de descer: apoiar parado e sair andando não soa sozinho',()=>{
    const sync=new FootstepSync();let hits=0;
    // Parado no `Idle`: os dois pés baixos, nada acontece.
    for(let i=0;i<120;i++)sync.update(1/60,[{side:0,height:.03},{side:1,height:.03}],true,0,()=>hits++);
    expect(hits).toBe(0);
    // Começa a andar. Enquanto nenhum pé passar do rearme, continua mudo — mesmo em movimento.
    for(let i=0;i<60;i++)sync.update(1/60,[{side:0,height:.03},{side:1,height:.045}],true,6,()=>hits++);
    expect(hits).toBe(0);
    // Sobe um pé e desce: agora sim, um passo.
    for(let i=0;i<10;i++)sync.update(1/60,[{side:0,height:.16},{side:1,height:.03}],true,6,()=>hits++);
    for(let i=0;i<10;i++)sync.update(1/60,[{side:0,height:.16-i*.015},{side:1,height:.03}],true,6,()=>hits++);
    expect(hits).toBe(1);
  });

  it('não dispara duas vezes no mesmo apoio quando o clipe oscila ou troca',()=>{
    const sync=new FootstepSync();let hits=0;
    // Pé no ar, descendo, apoia: um passo.
    for(let i=0;i<6;i++)sync.update(1/60,[{side:0,height:.16-i*.025},{side:1,height:.14}],true,5.5,()=>hits++);
    expect(hits).toBe(1);
    // Daí em diante fica colado ao chão com micro-oscilação — troca de clipe, respiração do rig,
    // ruído de blend. Nada disso chega ao rearme, então continua sendo o MESMO apoio.
    for(let i=0;i<180;i++)sync.update(1/60,[{side:0,height:.02+Math.abs(Math.sin(i))*.025},{side:1,height:.14}],true,5.5,()=>hits++);
    expect(hits).toBe(1);
  });

  it('o mergulho de meio-balanço do Walk não conta como apoio',()=>{
    // Curva real do pé esquerdo no `Walk`: desce até 5,9 cm, TORNA a subir até 17,6 cm e só então
    // apoia. Com o limiar antigo de 8,5 cm isso era um passo extra, e o andar soava a ~3,75/s com
    // o mesmo pé repetindo. Números de docs/footstep-clip-contacts.json.
    const curve=[.158,.146,.124,.089,.079,.068,.059,.069,.091,.125,.149,.176,.152,.126,.091,.057,.038,.027,.023,.023];
    const sync=new FootstepSync();const hits:FootSide[]=[];
    for(const height of curve)sync.update(1/60,[{side:0,height},{side:1,height:.03}],true,2.6,side=>hits.push(side));
    expect(hits).toEqual([0]);
  });

  it('não dispara no ar',()=>{
    expect(walk(new FootstepSync(),{grounded:false})).toHaveLength(0);
  });

  it('a aterrissagem toca UM passo, no quadro em que o pé chega ao chão',()=>{
    // Curva real do pouso: `grounded` vira verdadeiro com os pés ainda a 37 e 32 cm, e o clipe de
    // aterrissagem desce os dois quase juntos — o esquerdo cruza o apoio 8 quadros depois do toque
    // e o direito 14. Sem janela saíam dois sons a 0,1 s um do outro.
    const sync=new FootstepSync();const hits:{frame:number;side:FootSide}[]=[];
    for(let i=0;i<20;i++)sync.update(1/60,[{side:0,height:.38},{side:1,height:.33}],false,0,()=>hits.push({frame:-1,side:0}));
    expect(hits,'passo no ar').toHaveLength(0);
    const right=[.374,.348,.306,.249,.186,.138,.104,.082,.072,.068,.064,.060,.059,.056,.048,.037,.037];
    const left =[.320,.294,.250,.196,.147,.106,.075,.056,.048,.045,.043,.040,.040,.034,.027,.032,.047];
    for(const [frame,height] of right.entries())
      sync.update(1/60,[{side:0,height},{side:1,height:left[frame]!}],true,0,side=>hits.push({frame,side}));
    // Um som só, e no momento em que um pé de verdade encosta — não no quadro do `grounded`.
    expect(hits).toHaveLength(1);
    expect(hits[0]!.side).toBe(1);        // o esquerdo chega primeiro
    expect(hits[0]!.frame).toBeGreaterThan(4);
    // Pousar soa mesmo com o corpo parado: o corte por velocidade não vale na aterrissagem.
    expect(sync.steps).toBe(1);
  });

  it('não dispara parado',()=>{
    expect(walk(new FootstepSync(),{speed:0})).toHaveLength(0);
  });

  it('parar de andar não deixa um passo pendurado para a próxima arrancada',()=>{
    const sync=new FootstepSync();let hits=0;
    // Anda, para com um pé no ar, e o pé desce: o apoio é registrado mas não soa.
    for(let i=0;i<40;i++)sync.update(1/60,[{side:0,height:.16},{side:1,height:.03}],true,6,()=>hits++);
    for(let i=0;i<20;i++)sync.update(1/60,[{side:0,height:.16-i*.008},{side:1,height:.03}],true,0,()=>hits++);
    expect(hits).toBe(0);
    // Volta a andar com o mesmo pé no chão: sem subida, sem som.
    for(let i=0;i<30;i++)sync.update(1/60,[{side:0,height:.03},{side:1,height:.03}],true,6,()=>hits++);
    expect(hits).toBe(0);
  });

  it('acompanha a mudança de ritmo: correr entrega mais passos por segundo',()=>{
    const walking=walk(new FootstepSync(),{speed:2.6,strideSeconds:.8,seconds:3.2}).length/3.2;
    const running=walk(new FootstepSync(),{speed:8,strideSeconds:.45,lift:.7,seconds:3.15}).length/3.15;
    expect(running).toBeGreaterThan(walking);
    // E a cadência é a da passada, não a de um relógio: dois apoios por ciclo, nos dois ritmos.
    expect(walking).toBeCloseTo(2/.8,1);
    expect(running).toBeCloseTo(2/.45,1);
  });

  it('a força do passo cresce com a velocidade',()=>{
    const strength=(speed:number):number=>{
      const sync=new FootstepSync();let out=0;
      sync.update(1/60,[{side:0,height:.4},{side:1,height:.4}],true,speed,()=>{});
      sync.update(1/60,[{side:0,height:.3},{side:1,height:.4}],true,speed,()=>{});
      sync.update(1/60,[{side:0,height:.01},{side:1,height:.4}],true,speed,(_,s)=>{out=s;});
      return out;
    };
    expect(strength(8)).toBeGreaterThan(strength(1));
  });

  it('a taxa de quadros não muda a contagem de apoios, de 20 a 240 Hz',()=>{
    // O teste é de nível, não de cruzamento: a 20 Hz o quadro cai dentro do apoio do mesmo jeito.
    // E a descida é medida em m/s, então a 240 Hz o delta minúsculo não vira "subindo".
    const counts=[1/240,1/120,1/60,1/30,1/20].map(dt=>walk(new FootstepSync(),{dt,seconds:3.2,strideSeconds:.8}).length);
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBe(8);
  });

  it('apoio barrado pelo intervalo mínimo é contado, não engolido em silêncio',()=>{
    const sync=new FootstepSync();sync.minIntervalSeconds=.5;   // absurdo de propósito
    const hits=walk(sync,{strideSeconds:.4,seconds:2.4,lift:.4});
    // Com o intervalo apertado o segundo pé some do áudio — mas aparece no contador, que é o que
    // separa "não houve apoio" de "houve e foi barrado". A referência perde isso em silêncio.
    expect(sync.crowded).toBeGreaterThan(0);
    expect(hits.length+sync.crowded).toBe(12);
    // Com o intervalo real do jogo nada é barrado nessa mesma cadência.
    const honest=new FootstepSync();
    expect(walk(honest,{strideSeconds:.4,seconds:2.4,lift:.4}).length).toBe(12);
    expect(honest.crowded).toBe(0);
  });

  it('calado não soa e não acumula: ao voltar, a cadência continua certa',()=>{
    const sync=new FootstepSync();
    sync.muted=true;
    expect(walk(sync,{seconds:1.6}).length).toBe(0);
    expect(sync.steps).toBe(0);
    sync.muted=false;
    // Continua a MESMA passada de onde parou: nada de rajada de retomada.
    const hits:FootSide[]=[];
    for(let elapsed=1.6,i=0;i<96;i++,elapsed+=1/60)sync.update(1/60,gait(.25+elapsed/.8),true,5.5,side=>hits.push(side));
    expect(hits.length).toBe(4);
    for(let i=1;i<hits.length;i++)expect(hits[i]).not.toBe(hits[i-1]);
  });

  it('reset devolve o estado inicial',()=>{
    const sync=new FootstepSync();walk(sync);
    expect(sync.steps).toBeGreaterThan(0);
    sync.reset();
    expect(sync.steps).toBe(0);
    expect(sync.crowded).toBe(0);
    expect(sync.muted).toBe(false);
    // E depois do reset o primeiro quadro volta a só semear, sem passo fantasma.
    let hits=0;sync.update(1/60,[{side:0,height:.01},{side:1,height:.01}],true,6,()=>hits++);
    expect(hits).toBe(0);
  });
});

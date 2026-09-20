import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {
  AmbientFlock,limitAmbientSlots,
  AMBIENT_FLOCK_CAP,AMBIENT_SPECIES_BUDGET,AMBIENT_RESPAWN_SECONDS,AMBIENT_FLEE_SECONDS,
  AMBIENT_SHOT_STARTLE_RANGE,AMBIENT_PLAYER_STARTLE_RANGE,
  type AmbientSlot,type AmbientSpecies,
} from '../src/world/AmbientFlock';
import {AMBIENT_TARGET_BASE,SAUCER_TARGET_BASE,isAutoAimTarget} from '../src/world/TrainingYard';
import {FeatherBurst,FEATHER_POOL_SIZE,FEATHERS_PER_DEATH} from '../src/vfx/FeatherBurst';
import {farmAmbientSlots,AMBIENT_PROFILES,FLOCK_AREAS} from '../src/world/FarmWildlife';
import {normalizeAnimatedCharacter,sampleGroup} from '../src/world/AnimatedCharacter';

/**
 * Os bichos de cenário da fazenda.
 *
 * O que estes testes protegem NÃO é o desenho, é a contabilidade — que é onde um bando de enfeite
 * quebra de verdade: bicho além do orçamento, bicho que morre duas vezes e solta dois jatos de
 * sangue, bicho que some e nunca volta, e habilidade travando numa galinha em vez do inimigo.
 */

/** Sorteio determinístico: sem ele "às vezes passa" é um resultado possível. */
const fixedRandom=(seed=1):(()=>number)=>{let state=seed;return ():number=>{state=(state*1664525+1013904223)%4294967296;return state/4294967296;};};

const slot=(species:AmbientSpecies,x:number,z:number,y=0,perch=false):AmbientSlot=>({species,x,y,z,perch,yaw:0});

const manySlots=(species:AmbientSpecies,count:number):AmbientSlot[]=>
  Array.from({length:count},(_,i)=>slot(species,i*3,0));

describe('bichos de cenário da fazenda',()=>{

  describe('orçamento do bando',()=>{

    it('nunca passa do teto total, por mais pontos de nascimento que o mapa ofereça',()=>{
      const slots=[...manySlots('chicken',40),...manySlots('crow',40),...manySlots('sparrow',40)];
      const flock=new AmbientFlock(slots,fixedRandom());
      expect(flock.animals.length).toBe(AMBIENT_FLOCK_CAP);
      expect(flock.aliveCount).toBe(AMBIENT_FLOCK_CAP);
    });

    it('respeita o orçamento de CADA espécie, e não só o total',()=>{
      // 40 galinhas sozinhas não podem consumir o bando inteiro: a fazenda ficaria sem ave nenhuma.
      const kept=limitAmbientSlots([...manySlots('chicken',40),...manySlots('crow',40),...manySlots('sparrow',40)]);
      for(const species of ['chicken','crow','sparrow'] as const)
        expect(kept.filter(s=>s.species===species).length).toBe(AMBIENT_SPECIES_BUDGET[species]);
    });

    it('a soma dos orçamentos por espécie é exatamente o teto',()=>{
      const total=Object.values(AMBIENT_SPECIES_BUDGET).reduce((a,b)=>a+b,0);
      expect(total).toBe(AMBIENT_FLOCK_CAP);
    });

    it('o sorteio de pontos da fazenda já sai dentro do teto',()=>{
      const slots=farmAmbientSlots(fixedRandom(7),()=>0);
      expect(slots.length).toBeLessThanOrEqual(AMBIENT_FLOCK_CAP);
      expect(new AmbientFlock(slots,fixedRandom()).animals.length).toBeLessThanOrEqual(AMBIENT_FLOCK_CAP);
    });

  });

  describe('morte com um tiro',()=>{

    it('um tiro mata, e o mesmo bicho não morre duas vezes',()=>{
      const flock=new AmbientFlock(manySlots('chicken',3),fixedRandom());
      const first=flock.kill(0);
      expect(first).toBeDefined();
      expect(first!.alive).toBe(false);
      // A granada acerta o mesmo alvo várias vezes no MESMO quadro. Sem este portão saíam várias
      // explosões de penas de uma galinha só.
      expect(flock.kill(0)).toBeUndefined();
      expect(flock.kill(0)).toBeUndefined();
      expect(flock.aliveCount).toBe(2);
    });

    it('matar um não mexe nos outros',()=>{
      const flock=new AmbientFlock(manySlots('chicken',4),fixedRandom());
      flock.kill(1);
      expect(flock.animals.filter(a=>a.alive).map(a=>a.id)).toEqual([0,2,3]);
    });

    it('id inexistente não derruba nada',()=>{
      const flock=new AmbientFlock(manySlots('chicken',2),fixedRandom());
      expect(flock.kill(99)).toBeUndefined();
      expect(flock.aliveCount).toBe(2);
    });

  });

  describe('renascimento lento',()=>{

    it('o bicho morto NÃO volta antes da hora',()=>{
      const flock=new AmbientFlock(manySlots('chicken',1),fixedRandom());
      flock.kill(0);
      for(let t=0;t<AMBIENT_RESPAWN_SECONDS-1;t+=.5)flock.update(.5);
      expect(flock.aliveCount).toBe(0);
    });

    it('volta depois da espera, e volta NO POSTO dele',()=>{
      const flock=new AmbientFlock([slot('chicken',12,-5)],fixedRandom());
      const animal=flock.animals[0]!;
      animal.x=99;animal.z=99; // arrastado por uma fuga antes de morrer
      flock.kill(0);
      for(let t=0;t<AMBIENT_RESPAWN_SECONDS+1;t+=.5)flock.update(.5);
      expect(flock.aliveCount).toBe(1);
      expect(animal.x).toBeCloseTo(12,5);
      expect(animal.z).toBeCloseTo(-5,5);
      expect(animal.mode).toBe('calm');
    });

    it('a fazenda não esvazia: limpar o terreiro inteiro repovoa',()=>{
      const flock=new AmbientFlock([...manySlots('chicken',8),...manySlots('crow',5)],fixedRandom());
      const total=flock.animals.length;
      for(const animal of flock.animals)flock.kill(animal.id);
      expect(flock.aliveCount).toBe(0);
      for(let t=0;t<AMBIENT_RESPAWN_SECONDS+2;t+=.5)flock.update(.5);
      expect(flock.aliveCount).toBe(total);
    });

  });

  describe('susto',()=>{

    it('assusta dentro do raio e ignora fora dele',()=>{
      const flock=new AmbientFlock([slot('chicken',0,0),slot('chicken',40,0)],fixedRandom());
      expect(flock.startleAt({x:1,y:0,z:1},AMBIENT_SHOT_STARTLE_RANGE)).toBe(1);
      expect(flock.animals[0]!.mode).toBe('flee');
      expect(flock.animals[1]!.mode).toBe('calm');
    });

    it('foge PARA LONGE do tiro, não para cima dele',()=>{
      const flock=new AmbientFlock([slot('chicken',0,0)],fixedRandom());
      const animal=flock.animals[0]!;
      flock.startleAt({x:-4,y:0,z:0});
      flock.update(.5);
      // O tiro veio de x=-4; a galinha tem que ter aumentado o x.
      expect(animal.x).toBeGreaterThan(0);
    });

    it('susto em cima do próprio bicho não produz NaN',()=>{
      const flock=new AmbientFlock([slot('chicken',3,3)],fixedRandom());
      const animal=flock.animals[0]!;
      flock.startleAt({x:3,y:0,z:3});
      flock.update(.2);
      expect(Number.isFinite(animal.x)).toBe(true);
      expect(Number.isFinite(animal.z)).toBe(true);
    });

    it('o jogador chegando perto assusta; de longe, não',()=>{
      const flock=new AmbientFlock([slot('chicken',0,0)],fixedRandom());
      flock.update(.1,{x:AMBIENT_PLAYER_STARTLE_RANGE+5,y:0,z:0});
      expect(flock.animals[0]!.mode).toBe('calm');
      flock.update(.1,{x:AMBIENT_PLAYER_STARTLE_RANGE-1,y:0,z:0});
      expect(flock.animals[0]!.mode).toBe('flee');
    });

    it('bicho morto não se assusta',()=>{
      const flock=new AmbientFlock([slot('chicken',0,0)],fixedRandom());
      flock.kill(0);
      expect(flock.startleAt({x:0,y:0,z:0})).toBe(0);
    });

    it('passada a fuga, volta a ficar calmo',()=>{
      const flock=new AmbientFlock([slot('chicken',0,0)],fixedRandom());
      flock.startleAt({x:-2,y:0,z:0});
      for(let t=0;t<AMBIENT_FLEE_SECONDS+1;t+=.25)flock.update(.25);
      expect(flock.animals[0]!.mode).toBe('calm');
    });

    it('tiro que continua caindo PERTO mantém o bicho em pânico além da duração da fuga',()=>{
      const flock=new AmbientFlock([slot('chicken',0,0)],fixedRandom());
      const hen=flock.animals[0]!;
      // Cada susto renova o relógio. Sem essa renovação a galinha pousava no meio da rajada.
      for(let t=0;t<AMBIENT_FLEE_SECONDS*3;t+=.5){flock.startleAt({x:hen.x-2,y:0,z:hen.z});flock.update(.5);}
      expect(hen.mode).toBe('flee');
    });

    it('mas o tiro que ficou para trás deixa de assustar: ela FUGIU do barulho',()=>{
      const flock=new AmbientFlock([slot('chicken',0,0)],fixedRandom());
      const hen=flock.animals[0]!;
      // Ponto de tiro FIXO: a galinha corre a 3,4 m/s e sai do raio de susto sozinha. Se ela
      // continuasse em pânico aqui, um tiro no outro canto do mapa prenderia o bando para sempre.
      for(let t=0;t<AMBIENT_FLEE_SECONDS*3;t+=.5){flock.startleAt({x:-2,y:0,z:0});flock.update(.5);}
      expect(Math.hypot(hen.x+2,hen.z)).toBeGreaterThan(AMBIENT_SHOT_STARTLE_RANGE);
      expect(hen.mode).toBe('calm');
    });

    it('a ave decola: o corvo assustado GANHA altura e depois volta ao poleiro',()=>{
      const flock=new AmbientFlock([slot('crow',0,0,4,true)],fixedRandom());
      const crow=flock.animals[0]!;
      flock.startleAt({x:1,y:4,z:0});
      flock.update(1);
      expect(crow.y).toBeGreaterThan(4);
      for(let t=0;t<AMBIENT_FLEE_SECONDS+1;t+=.25)flock.update(.25);
      expect(crow.mode).toBe('calm');
      expect(crow.y).toBeCloseTo(4,5);
      expect(crow.x).toBeCloseTo(0,5);
    });

    it('a galinha calma não caminha para fora da fazenda',()=>{
      const flock=new AmbientFlock([slot('chicken',0,0)],fixedRandom(99));
      const hen=flock.animals[0]!;
      for(let t=0;t<600;t+=.25)flock.update(.25);
      expect(Math.hypot(hen.x,hen.z)).toBeLessThan(12);
    });

    it('dt zero ou negativo não move nada',()=>{
      const flock=new AmbientFlock([slot('chicken',5,5)],fixedRandom());
      flock.update(0);flock.update(-1);
      expect(flock.animals[0]!.x).toBe(5);
    });

  });

  describe('faixa de ids: bicho de cenário não é alvo de mira automática',()=>{

    it('a faixa dos bichos fica acima da dos discos',()=>{
      expect(AMBIENT_TARGET_BASE).toBeGreaterThan(SAUCER_TARGET_BASE);
    });

    it('NENHUM id de bicho é elegível para mira automática',()=>{
      // A habilidade que escolhe alvo sozinha travando numa galinha é o pior resultado possível:
      // o jogador gastou MP num enfeite enquanto o inimigo de verdade continuou vindo.
      for(let id=0;id<AMBIENT_FLOCK_CAP;id++)
        expect(isAutoAimTarget(AMBIENT_TARGET_BASE+id)).toBe(false);
    });

    it('o inimigo comum continua sendo alvo de mira automática',()=>{
      expect(isAutoAimTarget(200)).toBe(true);
      expect(isAutoAimTarget(SAUCER_TARGET_BASE-1)).toBe(true);
    });

  });

  describe('penas e sangue',()=>{

    it('sem tela o efeito fica inerte em vez de derrubar a cena',()=>{
      const engine=new NullEngine(),scene=new Scene(engine);
      const effects=new FeatherBurst(scene);
      expect(()=>effects.burst(new Vector3(0,1,0),'chicken',fixedRandom())).not.toThrow();
      expect(effects.activeCount).toBe(0);
      effects.update(1/60);effects.clear();effects.dispose();
      scene.dispose();engine.dispose();
    });

    it('o pool tem teto e ele cobre mais de uma morte inteira',()=>{
      // O teto é o custo máximo de desenho do efeito; se uma morte sozinha já o estourasse, a
      // segunda galinha sairia sem pena nenhuma.
      expect(FEATHER_POOL_SIZE).toBeGreaterThanOrEqual(FEATHERS_PER_DEATH*4);
    });

  });

  describe('distribuição pelo mapa',()=>{

    it('reparte o bando por vários núcleos, e a soma é exatamente o orçamento',()=>{
      // O pedido do dono foi "popula no mapa todo". Com teto de 18 isso não é sortear em todo
      // lugar — dois bichos por região é o mesmo que região vazia. É escolher poucos pontos onde o
      // jogador realmente passa e repartir o orçamento entre eles.
      //
      // O que este teste protege é a divergência CALADA: alguém acrescenta um núcleo e a soma passa
      // do orçamento, ou tira um e a espécie some do mapa — e `limitAmbientSlots` corta em silêncio
      // nos dois casos, então nada quebra e ninguém percebe.
      const total:Record<AmbientSpecies,number>={chicken:0,crow:0,sparrow:0};
      for(const area of FLOCK_AREAS)total[area.species]+=area.count;
      expect(total).toEqual(AMBIENT_SPECIES_BUDGET);
    });

    it('nenhuma espécie vive num ponto só',()=>{
      // Um núcleo único por espécie é exatamente o desenho anterior — um anel em volta do celeiro —
      // e é o defeito que este teste existe para impedir que volte.
      for(const species of ['chicken','crow','sparrow'] as const)
        expect(FLOCK_AREAS.filter(area=>area.species===species).length,species).toBeGreaterThan(1);
    });

    it('os núcleos estão de fato espalhados, não colados',()=>{
      const centers=[...new Set(FLOCK_AREAS.map(area=>`${area.x},${area.z}`))]
        .map(key=>key.split(',').map(Number) as [number,number]);
      expect(centers.length).toBeGreaterThanOrEqual(4);
      let spread=0;
      for(const [ax,az] of centers)for(const [bx,bz] of centers)spread=Math.max(spread,Math.hypot(ax-bx,az-bz));
      // 12 m é a distância em que dois grupos leem como dois lugares diferentes, e não como um
      // bando frouxo espalhado no mesmo terreiro.
      expect(spread).toBeGreaterThan(12);
    });

  });

});

/**
 * Os três modelos no caminho REAL do jogo.
 *
 * Contagem de clipe não pega o que quebra aqui: bicho de oito centímetros, bicho enterrado no
 * chão, e clipe que existe com o nome certo e não move a malha. O que pega é medir a geometria
 * DEFORMADA depois de passar pelo mesmo importador que a fazenda usa.
 */
const MODELS=[
  {species:'chicken' as const,file:'farm-chicken',min:.2,max:.9},
  {species:'crow' as const,file:'farm-crow',min:.15,max:.8},
  {species:'sparrow' as const,file:'farm-bird',min:.06,max:.5},
].filter(model=>existsSync(`public/models/${model.file}.glb`));

describe.runIf(MODELS.length)('modelos dos bichos de cenário',()=>{

  for(const model of MODELS)
    it(`${model.file} instancia de pé, na escala de bicho e com pose que escreve no rig`,async()=>{
      const engine=new NullEngine(),scene=new Scene(engine);
      const profile=AMBIENT_PROFILES[model.species];
      const container=await LoadAssetContainerAsync(
        new Uint8Array(readFileSync(`public/models/${profile.model}.glb`)),scene,{pluginExtension:'.glb'});
      const root=new TransformNode('ambient-test',scene);
      const character=normalizeAnimatedCharacter(container,scene,profile,0,root);
      expect(character,`${model.file}: importador devolveu nada`).toBeTruthy();
      // Altura de BICHO. Um modelo de terceiros em centímetros passa despercebido em contagem de
      // clipe e aparece em jogo como uma galinha de oito metros.
      expect(character!.height).toBeGreaterThan(model.min);
      expect(character!.height).toBeLessThan(model.max);
      // Pelo menos um papel resolvido: sem clipe nenhum o bicho é estátua. No corvo, o único
      // clipe do arquivo (`root|TakeOff`) tem que resolver — é nele que o poleiro se apoia.
      expect(character!.clips.size,`${model.file}: nenhum clipe resolvido`).toBeGreaterThan(0);
      const clip=character!.clips.get('Idle')??[...character!.clips.values()][0]!;
      expect(()=>sampleGroup(clip,.5,character!.skeletons)).not.toThrow();
      character!.dispose();container.dispose();scene.dispose();engine.dispose();
    });

  it('o corvo resolve o único clipe que o arquivo tem',()=>{
    // Não é teste de asset: é o contrato do desenho. Se alguém "consertar" o perfil do corvo para
    // um nome de espera que não existe, o poleiro passa a segurar o quadro 0 de nada.
    expect(AMBIENT_PROFILES.crow.clips.Idle).toContain('root|TakeOff');
  });

});

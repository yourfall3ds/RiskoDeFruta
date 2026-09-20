import {describe,it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {normalizeAnimatedCharacter,sampleGroup} from '../src/world/AnimatedCharacter';
import {ALIEN_PROFILES} from '../src/enemies/AlienProfiles';
import {SAUCER_SPECIES,ENEMIES} from '../src/run/MonsterDirector';
import type {EnemyKind} from '../src/run/MonsterDirector';

/**
 * Os alienígenas de terceiros no caminho REAL do jogo.
 *
 * Existe por uma sequência de falhas concretas, todas invisíveis para um teste de contagem: corpos
 * de oito centímetros, corpos enterrados 73 metros, e clipes que existiam com o nome certo e não
 * moviam a malha. O que pega isso é medir a **geometria deformada pelo esqueleto** — a mesma que a
 * tela desenha — depois de passar pelo importador que o `EnemySwarm` usa.
 */

const KINDS=SAUCER_SPECIES.filter(kind=>{
  const profile=ALIEN_PROFILES[kind as EnemyKind];
  return profile&&existsSync(`public/models/${profile.model}.glb`);
});

/** Extremos verticais e horizontais da superfície já deformada. */
function span(meshes:readonly {getPositionData(a:boolean,b:boolean):Float32Array|number[]|null;computeWorldMatrix(f:boolean):never}[]){
  const point=new Vector3();
  let low=Infinity,high=-Infinity,minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const mesh of meshes){
    const vertices=mesh.getPositionData(true,true);if(!vertices)continue;
    const matrix=mesh.computeWorldMatrix(true);
    for(let i=0;i<vertices.length;i+=3){
      Vector3.TransformCoordinatesFromFloatsToRef(vertices[i]!,vertices[i+1]!,vertices[i+2]!,matrix as never,point);
      low=Math.min(low,point.y);high=Math.max(high,point.y);
      minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);
      minZ=Math.min(minZ,point.z);maxZ=Math.max(maxZ,point.z);
    }
  }
  return {low,high,height:high-low,width:maxX-minX,depth:maxZ-minZ};
}

async function load(kind:EnemyKind,scene:Scene,gameplayRoot:TransformNode){
  const profile=ALIEN_PROFILES[kind]!;
  const container=await LoadAssetContainerAsync(new Uint8Array(readFileSync(`public/models/${profile.model}.glb`)),scene,{pluginExtension:'.glb'});
  const character=normalizeAnimatedCharacter(container,scene,profile,kind,gameplayRoot);
  expect(character,`${kind}: importador devolveu nada`).toBeTruthy();
  return {character:character!,profile};
}

/**
 * Orientação eleita para cada espécie, travada.
 *
 * Estes rótulos são o resultado que foi conferido POR IMAGEM, nos renders de quatro vistas do
 * `scripts/render-menu-aliens.py`, com piso quadriculado e poste de 1 m. Eles existem aqui porque
 * o resto deste arquivo NÃO consegue detectar uma troca de orientação: a altura sempre bate no
 * alvo (a escala é calculada A PARTIR dela) e a sola sempre encosta (o apoio é calculado depois),
 * então um corpo girado para o lado passa em todos os outros testes sem piscar.
 *
 * Descobri isso do jeito ruim: mexi nos padrões de nome de osso para dar confiança ao carrasco e
 * dois OUTROS bichos trocaram de eixo em silêncio, com 20 testes verdes. Mudar um rótulo aqui é
 * legítimo — mas exige olhar o render de novo, não só ver a suíte passar.
 *
 * O carrasco é `identidade (sem ossos)` de propósito: o rig dele nomeia a bacia como `DEF-HIPS_04`
 * e o padrão de `hips` está ancorado no fim do nome, então o solver não a encontra e desiste de
 * decidir. O resultado é o certo — mas por queda no caminho neutro, não por medição. É o único dos
 * seis cujo acerto não está provado pelo solver, e está registrado como tal.
 */
const EXPECTED_ORIENTATION:Readonly<Record<string,string>>={
  grey:'identidade',
  invader:'X-90',
  demon:'identidade (sem ossos)',
  predator:'identidade',
  strutter:'X+90',
  hound:'identidade',
};

describe('alienígenas de terceiros no caminho do jogo',()=>{
  for(const kind of KINDS)it(`${kind}: a orientação eleita é a que foi conferida por imagem`,async()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    try{
      const gameplay=new TransformNode('gameplay',scene);
      const {character}=await load(kind,scene,gameplay);
      expect(character.orientationLabel,`${kind} mudou de eixo — confira o render antes de aceitar`)
        .toBe(EXPECTED_ORIENTATION[kind]);
      character.dispose();
    }finally{scene.dispose();engine.dispose();}
  });

  it('há espécies empacotadas para testar',()=>{
    expect(KINDS.length,'nenhum GLB de alienígena em public/models').toBeGreaterThan(0);
  });

  for(const kind of KINDS)describe(kind,()=>{
    it('carrega, fica de pé, encosta no chão e mantém as peças',async()=>{
      const engine=new NullEngine(),scene=new Scene(engine);
      try{
        // O root de jogo fica num ponto qualquer: o corpo tem de assentar NELE, não na origem.
        const gameplay=new TransformNode('gameplay',scene);
        gameplay.position.set(7,3.5,-2);
        const {character,profile}=await load(kind,scene,gameplay);
        gameplay.computeWorldMatrix(true);
        const idle=character.clips.get('Idle');
        if(idle)sampleGroup(idle,0,character.skeletons);
        const box=span(character.meshes as never);

        expect(character.skeletons.length,'sem esqueleto').toBeGreaterThan(0);
        expect(character.meshes.length,'sem malha').toBeGreaterThan(0);
        // Apoio: a sola encosta no root de jogo, com folga de centímetros.
        expect(box.low-gameplay.position.y,'corpo fora do chão').toBeGreaterThan(-.06);
        expect(box.low-gameplay.position.y,'corpo flutuando').toBeLessThan(.12);
        // Escala: a altura entregue é a declarada no perfil.
        expect(box.height).toBeGreaterThan(profile.height*.75);
        expect(box.height).toBeLessThan(profile.height*1.35);
        // De pé. Largura nunca serve de critério (braços abertos), e o limiar depende da postura
        // declarada: uma ave é naturalmente mais comprida que alta sem estar deitada.
        const minimum=profile.stance==='quadrupede'?.4:.9;
        expect(box.height/Math.max(.01,box.depth),`deitado (${profile.stance??'bipede'})`).toBeGreaterThan(minimum);
      }finally{scene.dispose();engine.dispose();}
    },60000);

    it('as animações movem a malha de verdade e trocar de clipe não corrompe a pose',async()=>{
      const engine=new NullEngine(),scene=new Scene(engine);
      try{
        const gameplay=new TransformNode('gameplay',scene);
        const {character}=await load(kind,scene,gameplay);
        expect(character.clips.get('Idle'),'sem clipe de espera').toBeTruthy();
        // O importador já mede isso; o teste confirma que o veredito é positivo.
        expect(character.animationEffective,`${kind}: clipe inerte, não move a malha`).toBe(true);

        const idle=character.clips.get('Idle')!;
        sampleGroup(idle,0,character.skeletons);
        const first=span(character.meshes as never);
        for(const role of ['Walk','Run','Attack'] as const){
          const clip=character.clips.get(role);
          if(!clip||clip===idle)continue;
          sampleGroup(clip,.5,character.skeletons);
          const moved=span(character.meshes as never);
          expect(Math.abs(moved.height-first.height)+Math.abs(moved.low-first.low),
            `${kind}: ${role} não mudou a geometria`).toBeGreaterThan(1e-4);
        }
        // Idle → outro clipe → Idle tem de voltar exatamente à mesma pose.
        sampleGroup(idle,0,character.skeletons);
        const back=span(character.meshes as never);
        expect(back.height).toBeCloseTo(first.height,4);
        expect(back.low).toBeCloseTo(first.low,4);
      }finally{scene.dispose();engine.dispose();}
    },60000);

    it('duas cópias são independentes e recarregar não acumula transformação',async()=>{
      const engine=new NullEngine(),scene=new Scene(engine);
      try{
        const rootA=new TransformNode('a',scene),rootB=new TransformNode('b',scene);
        rootB.position.set(4,0,0);
        const profile=ALIEN_PROFILES[kind]!;
        const container=await LoadAssetContainerAsync(new Uint8Array(readFileSync(`public/models/${profile.model}.glb`)),scene,{pluginExtension:'.glb'});
        const a=normalizeAnimatedCharacter(container,scene,profile,'a',rootA)!;
        const b=normalizeAnimatedCharacter(container,scene,profile,'b',rootB)!;
        // Esqueleto e grupos próprios: mover um não pode mover o outro.
        expect(a.skeletons[0]).not.toBe(b.skeletons[0]);
        expect(a.clips.get('Idle')).not.toBe(b.clips.get('Idle'));
        // A correção é idêntica nas duas: não há acúmulo entre instâncias.
        expect(a.scale).toBeCloseTo(b.scale,6);
        expect(a.groundOffset).toBeCloseTo(b.groundOffset,6);
        expect(a.orientationLabel).toBe(b.orientationLabel);
        const walk=a.clips.get('Walk');
        if(walk&&walk!==a.clips.get('Idle')){
          sampleGroup(walk,.5,a.skeletons);
          const idleB=b.clips.get('Idle')!;
          sampleGroup(idleB,0,b.skeletons);
          expect(span(b.meshes as never).height).toBeGreaterThan(0);
        }
      }finally{scene.dispose();engine.dispose();}
    },60000);
  });

  it('nenhuma espécie de disco entra no sorteio das hordas',()=>{
    for(const kind of SAUCER_SPECIES)expect(ENEMIES[kind].cost,`${kind} tem custo e poderia sair numa horda`).toBe(0);
    expect(ENEMIES.grey.hp,'o E.T. tem de ser o mais duro do lote').toBeGreaterThan(ENEMIES.invader.hp);
    expect(ENEMIES.grey.hp).toBeGreaterThan(ENEMIES.watermelon.hp*4);
  });
});

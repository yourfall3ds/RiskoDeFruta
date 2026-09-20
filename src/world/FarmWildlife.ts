import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {WeaponAudio} from '../audio/RecordedAudio';
import {normalizeAnimatedCharacter,sampleGroup,type CharacterProfile,type NormalizedCharacter} from './AnimatedCharacter';
import {AMBIENT_TARGET_BASE,type TrainingTarget} from './TrainingYard';
import {FeatherBurst} from '../vfx/FeatherBurst';
import {
  AmbientFlock,AMBIENT_ANIMATION_RANGE,AMBIENT_FLOCK_CAP,AMBIENT_SHOT_STARTLE_RANGE,
  type AmbientAnimal,type AmbientSlot,type AmbientSpecies,
} from './AmbientFlock';

/**
 * Bicho de cenário da fazenda: galinha no chão, corvo no poleiro, pardal esvoaçando.
 *
 * ## Eles NÃO são inimigos
 *
 * Não entram no `EnemySwarm`, não têm vida, não dão dano, não dão XP e não contam kill. São enfeite
 * que reage: um tiro mata, e a morte é uma explosão de penas com sangue e som. A palavra do dono é
 * literal — "bichos que não são mobs, são meros animais, apenas explodem com 1 tiro".
 *
 * Entram na lista de `TrainingTarget` só para o hitscan enxergá-los, na faixa `AMBIENT_TARGET_BASE`,
 * que a regra de mira automática já exclui. Ver o comentário em `TrainingYard`.
 *
 * ## Desempenho, que aqui é requisito e não detalhe
 *
 * - Teto rígido de {@link AMBIENT_FLOCK_CAP} bichos vivos, repartido por espécie.
 * - Cada bicho é instanciado com `doNotInstantiate:true` — esqueleto e AnimationGroups PRÓPRIOS.
 *   É obrigatório: sem isso a pose de uma galinha moveria as outras sete.
 * - Nenhum `AnimationGroup.play()`. O repositório inteiro escreve pose à mão com `sampleGroup`, e
 *   18 grupos tocando sozinhos seriam 18 relógios que a pausa do jogo não alcança.
 * - Só os bichos dentro de {@link AMBIENT_ANIMATION_RANGE} da câmera são amostrados por quadro. O
 *   resto continua ANDANDO (três multiplicações) mas segura a última pose. O caro é
 *   `sampleGroup` → `skeleton.prepare(true)`, não a posição.
 * - Nenhuma matriz de mundo é congelada e nenhum `doNotSyncBoundingInfo` é ligado: o bicho se move,
 *   e o hitscan precisa do `getBoundingInfo()` de verdade no lugar onde ele está agora.
 */

/**
 * Perfis dos três modelos.
 *
 * Os papéis canônicos (`Idle`/`Walk`/`Run`/…) são o vocabulário de `normalizeAnimatedCharacter`, e
 * não a semântica destes bichos — aqui eles são só ganchos para os clipes que cada arquivo tem.
 *
 * O corvo é o caso torto: o arquivo traz UM clipe, `root|TakeOff`, e nenhuma espera. Em vez de
 * inventar uma espera, o poleiro segura o quadro 0 desse mesmo clipe — que é a ave pousada — e o
 * susto solta o clipe inteiro, que é literalmente a decolagem. O defeito do asset virou o desenho.
 */
export const AMBIENT_PROFILES:Readonly<Record<AmbientSpecies,CharacterProfile>>={
  chicken:{model:'farm-chicken',height:.42,yaw:0,stance:'quadrupede',
    clips:{Idle:['peck_idle2','idle01'],Walk:['walk01'],Run:['run01'],Attack:['flap'],Death:['chicken_scared01']}},
  crow:{model:'farm-crow',height:.34,yaw:0,stance:'quadrupede',
    clips:{Idle:['root|TakeOff'],Walk:['root|TakeOff'],Run:['root|TakeOff'],Attack:['root|TakeOff'],Death:['root|TakeOff']}},
  sparrow:{model:'farm-bird',height:.17,yaw:0,stance:'quadrupede',
    clips:{Idle:['Sparrow_Look'],Walk:['Sparrow_Jump'],Run:['AA_Sparrow_Fly'],Attack:['Sparrow_Shake'],Death:['AA_Sparrow_Fly']}},
};

/**
 * Os núcleos de vida da fazenda, em coordenadas do mundo.
 *
 * Um anel só, centrado no celeiro, era o desenho anterior e estava errado pelo pedido explícito do
 * dono — "popula no mapa todo". Com teto de 18 bichos não adianta sortear em todo lugar (dois
 * bichos por região é o mesmo que região vazia): o certo é escolher POUCOS pontos onde o jogador
 * realmente passa e repartir o orçamento entre eles.
 *
 * Os centros não são inventados; são lugares que existem em `scripts/build-farm-world.py`:
 * - o terreiro da ilha principal (elipse 48×52 na origem), onde o jogador nasce;
 * - o platô de cima (elipse 34×28 em z=34), onde ficam o celeiro, os silos e o moinho;
 * - os dois talhões de milho, em (13, 13) e (−12,8, 37,5) — corvo em milharal é a imagem pedida.
 *
 * `groundAt` devolve `-Infinity` fora do terreno, e o ponto é simplesmente descartado: um centro
 * que um dia saia do mapa esvazia sozinho em vez de pendurar bicho no ar.
 */
export const FLOCK_AREAS:readonly{species:AmbientSpecies;count:number;x:number;z:number;near:number;far:number;lift:number;perch:boolean}[]=[
  // Galinha cisca no chão dos dois níveis: 5 no terreiro de baixo, 3 junto ao celeiro.
  {species:'chicken',count:5,x:0,z:-4,near:5,far:18,lift:0,perch:false},
  {species:'chicken',count:3,x:0,z:34,near:7,far:14,lift:0,perch:false},
  // Corvo pousa alto: telhado/silo do platô e, sobretudo, o milharal.
  {species:'crow',count:3,x:0,z:34,near:8,far:15,lift:3.4,perch:true},
  {species:'crow',count:2,x:13,z:13,near:3,far:7,lift:2.6,perch:true},
  // Pardal espalha o resto, um talhão em cada cota.
  {species:'sparrow',count:3,x:-14,z:4,near:3,far:10,lift:2.1,perch:true},
  {species:'sparrow',count:2,x:-12.8,z:37.5,near:3,far:8,lift:2.1,perch:true},
];

/**
 * Sorteia os pontos de nascimento pelos núcleos acima.
 *
 * Exportado porque a repartição por espécie é regra, não decoração: o teste verifica que um mapa
 * com pontos demais não infla o bando. A soma de `count` é exatamente o orçamento por espécie, e
 * `limitAmbientSlots` continua sendo quem corta — aqui não há segunda contagem que pudesse divergir
 * dela.
 */
export function farmAmbientSlots(random:()=>number,groundAt:(x:number,z:number)=>number):AmbientSlot[] {
  const slots:AmbientSlot[]=[];
  for(const area of FLOCK_AREAS){
    for(let i=0;i<area.count;i++){
      // Ângulo distribuído + ruído: em ângulo puramente aleatório três galinhas nascem coladas e o
      // núcleo fica com um monte num canto e nada no resto.
      const angle=(i+random()*.8)/area.count*Math.PI*2;
      const radius=area.near+random()*(area.far-area.near);
      const x=area.x+Math.cos(angle)*radius,z=area.z+Math.sin(angle)*radius;
      const ground=groundAt(x,z);
      if(!Number.isFinite(ground))continue;
      slots.push({species:area.species,x,y:ground+area.lift,z,perch:area.perch,yaw:random()*Math.PI*2});
    }
  }
  return slots;
}

interface AmbientBody {animal:AmbientAnimal;root:TransformNode;character:NormalizedCharacter;meshes:Mesh[]}

export class FarmWildlife {
  private flock:AmbientFlock|undefined;
  private readonly bodies:AmbientBody[]=[];
  private readonly containers:AssetContainer[]=[];
  private readonly effects:FeatherBurst;
  private disposed=false;
  /** Relógio do chilro ambiente. Começa alto para nada piar no primeiro segundo do jogo. */
  private chirpIn=9;
  error='';
  ready=false;

  constructor(
    private readonly scene:Scene,
    private readonly collision:CollisionWorld,
    private readonly audio:WeaponAudio|undefined,
    private readonly targets:TrainingTarget[],
    private readonly random:()=>number=Math.random,
  ){this.effects=new FeatherBurst(scene);}

  /** Quantos bichos estão vivos agora. Exposto para o painel de diagnóstico e para o teste. */
  get aliveCount():number{return this.flock?.aliveCount??0;}
  /** Quantos corpos foram realmente instanciados. Nunca passa de `AMBIENT_FLOCK_CAP`. */
  get bodyCount():number{return this.bodies.length;}
  get particleCount():number{return this.effects.activeCount;}

  /**
   * Carrega os três GLB e instancia o bando.
   *
   * Instanciar custa: `normalizeAnimatedCharacter` mede a geometria DEFORMADA em seis candidatos de
   * orientação, e fazer isso 18 vezes seguidas trava o quadro. Por isso cada bicho cede o
   * processador antes do seguinte — a fazenda se povoa em alguns quadros em vez de num engasgo.
   */
  async load():Promise<void> {
    try {
      const slots=farmAmbientSlots(this.random,(x,z)=>this.collision.groundAt(x,z));
      if(!slots.length)return;
      this.flock=new AmbientFlock(slots,this.random);
      const needed=new Set(this.flock.animals.map(a=>a.species));
      const containers=new Map<AmbientSpecies,AssetContainer>();
      for(const species of needed){
        const container=await LoadAssetContainerAsync(`/models/${AMBIENT_PROFILES[species].model}.glb`,this.scene);
        if(this.disposed){container.dispose();return;}
        this.containers.push(container);containers.set(species,container);
      }
      for(const animal of this.flock.animals){
        if(this.disposed)return;
        const container=containers.get(animal.species);
        if(!container)continue;
        const body=this.spawn(animal,container);
        if(body)this.bodies.push(body);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(this.disposed)return;
      this.ready=true;
    } catch(error){if(!this.disposed)this.error=error instanceof Error?error.message:'Falha nos bichos da fazenda';}
  }

  private spawn(animal:AmbientAnimal,container:AssetContainer):AmbientBody|undefined {
    const root=new TransformNode(`ambient-${animal.species}-${animal.id}`,this.scene);
    root.position.set(animal.x,animal.y,animal.z);
    const character=normalizeAnimatedCharacter(container,this.scene,AMBIENT_PROFILES[animal.species],animal.id,root);
    if(!character){root.dispose();return undefined;}
    const meshes=character.meshes.filter((mesh):mesh is Mesh=>mesh instanceof Mesh&&mesh.getTotalVertices()>0);
    if(!meshes.length){character.dispose();root.dispose();return undefined;}
    for(const mesh of meshes){
      // Precisa ser clicável e ter `boundingInfo` VIVO. Nada de congelar matriz nem de
      // `doNotSyncBoundingInfo`: o bicho anda, e o tiro tem que acertar onde ele está.
      mesh.isPickable=true;
      mesh.receiveShadows=true;
    }
    // A malha maior é a que o alvo aponta; as outras entram em `meshes` para o hitscan cobrir bico,
    // asa e pé sem depender de qual submalha o raio pegou.
    const largest=meshes.reduce((best,mesh)=>mesh.getTotalVertices()>best.getTotalVertices()?mesh:best,meshes[0]!);
    this.targets.push({
      id:AMBIENT_TARGET_BASE+animal.id,mesh:largest,meshes,hits:0,
      onHit:():void=>this.strike(animal.id),
    });
    return {animal,root,character,meshes};
  }

  /**
   * Um tiro, uma morte. Sem vida, sem limiar, sem dano acumulado.
   *
   * `flock.kill` é quem decide se esta é a primeira vez: granada pega o mesmo bicho várias vezes no
   * mesmo quadro, e sem esse portão sairiam três explosões de penas de uma galinha só.
   */
  private strike(id:number):void {
    const animal=this.flock?.kill(id);
    if(!animal)return;
    const at=new Vector3(animal.x,animal.y+.18,animal.z);
    this.effects.burst(at,animal.species,this.random);
    const listener=this.scene.activeCamera?.globalPosition;
    if(this.audio&&listener)this.audio.ambientAnimal('death',Vector3.Distance(listener,at),this.panFor(at));
    const body=this.bodies.find(b=>b.animal.id===id);
    // O corpo some junto com as penas: a galinha EXPLODE, não tomba. Desligar o root também tira as
    // submalhas do teste de `isEnabled()` do hitscan, então o alvo morto não é mais acertável.
    body?.root.setEnabled(false);
    // O estampido assusta a vizinhança. Este é o susto mais importante do sistema: o bando inteiro
    // levantar voo quando um tiro erra é metade do efeito.
    this.flock?.startleAt(animal,AMBIENT_SHOT_STARTLE_RANGE);
    this.flap(at);
  }

  /** Susto vindo de fora (tiro que errou, granada, impacto). Devolve quantos reagiram. */
  startleAt(point:Vec3,radius=AMBIENT_SHOT_STARTLE_RANGE):number {
    const count=this.flock?.startleAt(point,radius)??0;
    if(count)this.flap(new Vector3(point.x,point.y,point.z));
    return count;
  }

  private flap(at:Vector3):void {
    const listener=this.scene.activeCamera?.globalPosition;
    if(this.audio&&listener)this.audio.ambientAnimal('flap',Vector3.Distance(listener,at),this.panFor(at));
  }

  /**
   * Lado do som, na base da câmera.
   *
   * Mesma ideia do `pan` que `enemyEvent` recebe pronto: o áudio não conhece a câmera, quem conhece
   * é quem tem a cena. Projetar no vetor "direita" da câmera é o que sobrevive ao jogador girando.
   */
  private panFor(at:Vector3):number {
    const camera=this.scene.activeCamera;
    if(!camera)return 0;
    const right=camera.getDirection(Vector3.Right());
    const delta=at.subtract(camera.globalPosition);
    const length=delta.length();
    if(length<1e-3)return 0;
    return Math.max(-1,Math.min(1,Vector3.Dot(delta.scaleInPlace(1/length),right)));
  }

  /**
   * Um quadro. Recebe `animDt`, então pausar o jogo congela o bando, as penas e o sangue junto com
   * o resto — bicho andando com o jogo parado é o defeito clássico de cenário animado.
   */
  update(dt:number,viewer:Vec3|undefined,player:Vec3|undefined):void {
    this.effects.update(dt);
    const flock=this.flock;
    if(!flock||!(dt>0))return;
    flock.update(dt,player,(x,z)=>this.collision.groundAt(x,z));

    const near=AMBIENT_ANIMATION_RANGE*AMBIENT_ANIMATION_RANGE;
    for(const body of this.bodies){
      const animal=body.animal;
      const enabled=body.root.isEnabled();
      if(!animal.alive){if(enabled)body.root.setEnabled(false);continue;}
      if(!enabled)body.root.setEnabled(true);
      body.root.position.set(animal.x,animal.y,animal.z);
      body.root.rotation.y=animal.yaw;
      if(!viewer)continue;
      const dx=animal.x-viewer.x,dy=animal.y-viewer.y,dz=animal.z-viewer.z;
      // Longe: a posição continua correta e a POSE congela. Ninguém percebe o rig parado de um
      // pardal a 40 m, e é `skeleton.prepare(true)` que custa.
      if(dx*dx+dy*dy+dz*dz>near)continue;
      const clip=body.character.clips.get(this.clipRole(animal));
      // O corvo pousado segura o quadro 0 do `TakeOff`: é a ave parada no galho.
      if(clip)sampleGroup(clip,this.perched(animal)?0:animal.phase,body.character.skeletons);
    }

    this.chirp(dt,viewer);
  }

  private perched(animal:AmbientAnimal):boolean {
    return animal.mode==='calm'&&animal.species==='crow';
  }

  private clipRole(animal:AmbientAnimal):'Idle'|'Walk'|'Run' {
    if(animal.mode==='flee')return 'Run';
    if(animal.species==='chicken')return animal.walking?'Walk':'Idle';
    return 'Idle';
  }

  /**
   * Chilro ambiente: raro, baixo e só se houver ave viva por perto.
   *
   * O intervalo é longo (12 a 30 s) porque o requisito é explícito: isto não pode virar chateação.
   * Um pio a cada poucos segundos é o que transforma ambiente em alarme.
   */
  private chirp(dt:number,viewer:Vec3|undefined):void {
    if(!this.audio||!viewer)return;
    this.chirpIn-=dt;
    if(this.chirpIn>0)return;
    this.chirpIn=12+this.random()*18;
    const candidates=this.bodies.filter(body=>body.animal.alive
      &&(body.animal.x-viewer.x)**2+(body.animal.z-viewer.z)**2<26*26);
    const chosen=candidates[Math.floor(this.random()*candidates.length)];
    if(!chosen)return;
    const at=new Vector3(chosen.animal.x,chosen.animal.y,chosen.animal.z);
    const listener=this.scene.activeCamera?.globalPosition;
    if(listener)this.audio.ambientAnimal('call',Vector3.Distance(listener,at),this.panFor(at));
  }

  dispose():void {
    this.disposed=true;
    for(const body of this.bodies){body.character.dispose();body.root.dispose();}
    this.bodies.length=0;
    // Os alvos são de outra lista (a do mundo). Tirar os nossos dali é obrigação nossa, senão o
    // hitscan continua carregando ids de bicho que não existe mais.
    for(let i=this.targets.length-1;i>=0;i--)
      if(this.targets[i]!.id>=AMBIENT_TARGET_BASE)this.targets.splice(i,1);
    this.effects.dispose();
    for(const container of this.containers)container.dispose();
    this.containers.length=0;
    this.flock=undefined;
  }
}

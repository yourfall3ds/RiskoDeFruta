import {CreatePlane} from '@babylonjs/core/Meshes/Builders/planeBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import {Pool} from '../core/Pool';

/**
 * Explosão de penas e sangue do bicho de cenário.
 *
 * ## Por que um módulo novo em vez de reaproveitar
 *
 * Foram medidas as três opções que já existem no repositório, e nenhuma faz pena:
 *
 * - `CombatPresentation.burst(pos,'juice',…)` é o mais barato de todos, mas é um BAFO genérico:
 *   uma nuvem que sobe e some. Serve para respingo de fruta, não para pena, que precisa ficar no ar
 *   e cair devagar — é justamente o tempo de queda que lê como "pena".
 * - `ShotEffects.impact` joga 5 faíscas com gravidade de bala num material ÚNICO e compartilhado,
 *   com `emissiveColor` laranja fixo. Não dá para pintar de vermelho sem repintar o impacto de tiro
 *   do jogo inteiro, e a gravidade é dez vezes a de uma pena.
 * - `FruitFragments` dá destroço real que tomba, mas os pedaços vêm de um GLB autoral com famílias
 *   de fruta fixas. Não há família "pena", e acrescentar uma é trabalho de asset, não de código.
 *
 * Então aqui vai o mínimo: quads finos, agrupados num pool com teto rígido, no mesmo estilo de
 * `ShotEffects` (mesma classe `Pool`, mesma lista `active`, mesmo `update(dt)`).
 *
 * ## Pena não é estilhaço
 *
 * A pena tem gravidade PRÓPRIA e minúscula (`FEATHER_FALL`), velocidade terminal, e um bambolear
 * lateral senoidal. Usar a gravidade de bala foi a primeira tentativa e o resultado foi confete
 * caindo a prumo — lia como pedra, não como pena.
 *
 * ## Sangue
 *
 * Jato curto e escuro, com gravidade de verdade e vida de ~0,3 s, em pool separado com material
 * próprio. É pool próprio, e não `ShotEffects.impact`, exatamente pelo material compartilhado
 * citado acima.
 */

/** Queda da pena, em m/s². Um décimo da gravidade: é o que faz ela FLUTUAR. */
const FEATHER_FALL=1.1;
/** Velocidade terminal da pena. Sem ela a queda acelera e vira estilhaço no fim da vida. */
const FEATHER_TERMINAL=.85;
const FEATHER_LIFE=2.6;
const BLOOD_LIFE=.34;

/**
 * Tetos dos pools. São o custo máximo de desenho deste efeito: no pior caso possível — o jogador
 * limpando o terreiro com granada — são 96 quads de pena e 48 de sangue em voo, 144 draw calls
 * extras. Uma morte sozinha custa 14 + 6 = 20, e eles se apagam em 2,6 s.
 */
export const FEATHER_POOL_SIZE=96;
export const BLOOD_POOL_SIZE=48;
/** Penas e gotas por morte. Fixo: uma galinha não explode mais que a outra. */
export const FEATHERS_PER_DEATH=14;
export const BLOOD_PER_DEATH=6;

interface Particle {mesh:Mesh;time:number;life:number;velocity:Vector3;spin:number;sway:number;phase:number;feather:boolean}

/** Paleta por espécie. Pena de corvo branca ficaria ridícula, e é a primeira coisa que se nota. */
export const FEATHER_TINT:Readonly<Record<string,string>>={chicken:'#efe6d4',crow:'#2b2b33',sparrow:'#a98c63'};

export class FeatherBurst {
  private readonly feathers:Pool<Particle>|undefined;
  private readonly blood:Pool<Particle>|undefined;
  private readonly active:Particle[]=[];
  private readonly tints=new Map<string,StandardMaterial>();
  private readonly meshes:Mesh[]=[];
  /**
   * Material do sangue e as duas `DynamicTexture`.
   *
   * Ficam numa lista à parte porque NÃO estão em `tints`: o sangue é um material só, e as texturas
   * são compartilhadas pelos quatro materiais. `StandardMaterial.dispose()` sem argumento não leva a
   * textura junto, então liberá-las é explícito — senão cada troca de fase deixa duas telas 64×64 e
   * 32×32 vivas na cena para sempre.
   */
  private readonly disposables:{dispose():void}[]=[];
  constructor(scene:Scene) {
    // Sem tela não há pintura de textura possível (o `DynamicTexture` precisa de contexto 2D). O
    // efeito fica inerte em vez de derrubar o teste e o servidor, como `ShotEffects` já faz.
    if(!scene.getEngine().getRenderingCanvas())return;

    const featherTexture=new DynamicTexture('ambient-feather',64,scene,false);featherTexture.hasAlpha=true;
    const paint=featherTexture.getContext();paint.clearRect(0,0,64,64);
    // Silhueta de pena: fuso com raque no meio. Barata e legível a 2 m, que é a única distância em
    // que alguém olha para uma pena.
    // Desenhada em segmentos retos e não em bézier: o `ICanvasRenderingContext` do Babylon não
    // expõe `bezierCurveTo`, e a 64 px a diferença entre a curva e 24 segmentos não existe.
    // `sin(πt)^.6` dá o fuso: fino nas duas pontas, mais cheio do meio para a base.
    paint.fillStyle='#ffffff';paint.beginPath();
    const edge=(t:number,side:number):[number,number]=>[32+side*Math.sin(Math.PI*t)**.6*19*(1-t*.35),2+t*60];
    for(let i=0;i<=24;i++){const [x,y]=edge(i/24,1);if(i===0)paint.moveTo(x,y);else paint.lineTo(x,y);}
    for(let i=24;i>=0;i--){const [x,y]=edge(i/24,-1);paint.lineTo(x,y);}
    paint.closePath();paint.fill();
    paint.strokeStyle='#00000055';paint.lineWidth=2;paint.beginPath();paint.moveTo(32,4);paint.lineTo(32,60);paint.stroke();
    featherTexture.update();
    this.disposables.push(featherTexture);

    for(const [species,hex] of Object.entries(FEATHER_TINT)){
      const material=new StandardMaterial('ambient-feather-'+species,scene);
      material.diffuseTexture=featherTexture;material.opacityTexture=featherTexture;
      material.diffuseColor=Color3.FromHexString(hex);material.emissiveColor=Color3.FromHexString(hex).scale(.18);
      material.specularColor=Color3.Black();material.backFaceCulling=false;
      this.tints.set(species,material);
    }
    const first=this.tints.values().next().value as StandardMaterial;

    const bloodTexture=new DynamicTexture('ambient-blood',32,scene,false);bloodTexture.hasAlpha=true;
    const drop=bloodTexture.getContext();drop.clearRect(0,0,32,32);
    const gradient=drop.createRadialGradient(16,16,0,16,16,15);
    gradient.addColorStop(0,'#8c0d10ff');gradient.addColorStop(.6,'#5a070add');gradient.addColorStop(1,'#3a040600');
    drop.fillStyle=gradient;drop.fillRect(0,0,32,32);bloodTexture.update();
    const bloodMaterial=new StandardMaterial('ambient-blood',scene);
    bloodMaterial.diffuseTexture=bloodTexture;bloodMaterial.opacityTexture=bloodTexture;
    bloodMaterial.diffuseColor=new Color3(.42,.03,.04);bloodMaterial.specularColor=Color3.Black();bloodMaterial.backFaceCulling=false;
    this.disposables.push(bloodTexture,bloodMaterial);

    const make=(name:string,width:number,height:number,material:StandardMaterial,feather:boolean)=>():Particle=>{
      const mesh=CreatePlane(name,{width,height},scene);
      mesh.material=material;mesh.isPickable=false;
      // Sangue é bolha: billboard sempre de frente. Pena NÃO é billboard — é o tombo dela no eixo
      // próprio que vende o efeito, e billboard mataria exatamente isso.
      if(!feather)mesh.billboardMode=7;
      this.meshes.push(mesh);
      return {mesh,time:0,life:0,velocity:Vector3.Zero(),spin:0,sway:0,phase:0,feather};
    };
    const reset=(particle:Particle):void=>{
      particle.mesh.setEnabled(false);particle.time=0;particle.mesh.visibility=1;
      particle.velocity.setAll(0);particle.mesh.rotation.setAll(0);
    };
    this.feathers=new Pool<Particle>(FEATHER_POOL_SIZE,make('ambient-feather',.05,.12,first,true),reset);
    this.blood=new Pool<Particle>(BLOOD_POOL_SIZE,make('ambient-blood',.09,.09,bloodMaterial,false),reset);
  }

  /** Quantas partículas estão no ar. Usado pelo diagnóstico de desempenho. */
  get activeCount():number{return this.active.length;}

  /**
   * A morte inteira num chamado: penas + sangue.
   *
   * Não devolve nada e nunca lança: pool cheio simplesmente solta menos pena, que é degradação
   * correta — o teto existe para isso.
   */
  burst(position:Vector3,species:string,random:()=>number=Math.random):void {
    const tint=this.tints.get(species);
    for(let i=0;i<FEATHERS_PER_DEATH;i++){
      const particle=this.feathers?.acquire();if(!particle)break;
      if(tint)particle.mesh.material=tint;
      particle.mesh.position.copyFrom(position);
      particle.mesh.position.addInPlaceFromFloats((random()-.5)*.14,(random()-.5)*.14,(random()-.5)*.14);
      const angle=random()*Math.PI*2,out=.9+random()*1.7;
      particle.velocity.set(Math.cos(angle)*out,.8+random()*1.9,Math.sin(angle)*out);
      particle.spin=(random()-.5)*7;particle.sway=.5+random()*1.1;particle.phase=random()*Math.PI*2;
      particle.life=FEATHER_LIFE*(.7+random()*.6);
      particle.mesh.rotation.set(random()*Math.PI,random()*Math.PI,random()*Math.PI);
      particle.mesh.setEnabled(true);this.active.push(particle);
    }
    for(let i=0;i<BLOOD_PER_DEATH;i++){
      const particle=this.blood?.acquire();if(!particle)break;
      particle.mesh.position.copyFrom(position);
      const angle=random()*Math.PI*2,out=1.6+random()*2.4;
      particle.velocity.set(Math.cos(angle)*out,1.4+random()*2.2,Math.sin(angle)*out);
      particle.life=BLOOD_LIFE*(.7+random()*.8);
      particle.mesh.scaling.setAll(.6+random()*.9);
      particle.mesh.setEnabled(true);this.active.push(particle);
    }
  }

  update(dt:number):void {
    if(!(dt>0))return;
    for(let i=this.active.length-1;i>=0;i--){
      const particle=this.active[i]!;
      particle.time+=dt;
      if(particle.feather){
        // Gravidade de pena, com terminal. O bambolear entra na POSIÇÃO e não na velocidade: na
        // velocidade ele integrava e a pena saía derivando para um lado só.
        particle.velocity.y=Math.max(-FEATHER_TERMINAL,particle.velocity.y-FEATHER_FALL*dt);
        particle.velocity.x*=1-Math.min(1,2.6*dt);particle.velocity.z*=1-Math.min(1,2.6*dt);
        const sway=Math.sin(particle.time*3.4+particle.phase)*particle.sway*dt;
        particle.mesh.position.addInPlaceFromFloats(
          particle.velocity.x*dt+sway,particle.velocity.y*dt,particle.velocity.z*dt+sway*.6);
        particle.mesh.rotation.x+=particle.spin*dt;particle.mesh.rotation.z+=particle.spin*.6*dt;
        particle.mesh.visibility=Math.max(0,Math.min(1,(particle.life-particle.time)/.6));
      } else {
        particle.velocity.y-=11*dt;
        particle.mesh.position.addInPlace(particle.velocity.scale(dt));
        particle.mesh.visibility=Math.max(0,1-particle.time/particle.life);
      }
      if(particle.time>=particle.life){
        (particle.feather?this.feathers:this.blood)?.release(particle);
        this.active.splice(i,1);
      }
    }
  }

  clear():void {
    for(const particle of this.active)(particle.feather?this.feathers:this.blood)?.release(particle);
    this.active.length=0;
  }

  dispose():void {
    this.clear();
    for(const mesh of this.meshes)mesh.dispose();
    this.meshes.length=0;
    for(const material of this.tints.values())material.dispose();
    this.tints.clear();
    for(const item of this.disposables)item.dispose();
    this.disposables.length=0;
  }
}

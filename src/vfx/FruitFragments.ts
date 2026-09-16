import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
import {FragmentLibrary,SHAPE_VARIANTS,type FragmentLoader,type FragmentRole,type FragmentTemplate,type FruitFamily} from './FragmentLibrary';

export type {FragmentRole,FruitFamily,FragmentLoader} from './FragmentLibrary';
export {FRAGMENT_TRIANGLE_BUDGET,SHAPE_VARIANTS,FRAGMENT_MODEL,FRAGMENT_FAMILIES,FRAGMENT_ROLES,fragmentKey} from './FragmentLibrary';

export interface FruitPalette {
  /**
   * Cor de referência da casca. A casca de verdade vem da textura do corpo recortado; este valor
   * existe para HUD/depuração e para casar com a paleta gravada no modelo.
   */
  shell:string;
  /** Interior claro. */
  pulp:string;
  /** Sementes escuras. */
  seed:string;
  /** Quantos pedaços de cada tipo por quebra. */
  counts:Readonly<Record<FragmentRole,number>>;
  /** Camada clara entre casca e polpa; é a cor da borda cortada. */
  rind?:string;
  /** Conjunto de cacos recortado para esta espécie. Sem ela, cai em `berry`. */
  family?:FruitFamily;
  /** Multiplicador de tamanho do pedaço; corpo maior lança caco maior. */
  size?:number;
}

/**
 * Paleta por espécie. As cores em sRGB são as mesmas de `scripts/build-fruit-fragments.py`, que as
 * grava em linear dentro do modelo — o teste compara as duas pontas para elas não separarem.
 */
export const FRUIT_PALETTES:Readonly<Record<string,FruitPalette>>={
  watermelon:{shell:'#2f6b2a',pulp:'#d0374d',seed:'#1d150f',rind:'#cfdfa2',family:'melon',counts:{shell:4,pulp:3,seed:6}},
  tomato:    {shell:'#c8241f',pulp:'#d9584a',seed:'#cdb570',rind:'#eec0a8',family:'berry',counts:{shell:3,pulp:3,seed:4}},
  eggplant:  {shell:'#4a2a63',pulp:'#e7d9ba',seed:'#6d5e35',rind:'#ddcfae',family:'bulb', counts:{shell:4,pulp:2,seed:3}},
  corn:      {shell:'#d9a520',pulp:'#e8cf7a',seed:'#e2ab33',rind:'#ded0a0',family:'cob',  counts:{shell:3,pulp:2,seed:5}},
  carrot:    {shell:'#d2681c',pulp:'#e79a4e',seed:'#dd8f42',rind:'#eec392',family:'root', counts:{shell:4,pulp:2,seed:3}},
  boss:      {shell:'#2f6b2a',pulp:'#d0374d',seed:'#1d150f',rind:'#cfdfa2',family:'melon',size:1.45,counts:{shell:6,pulp:4,seed:8}},
};
/** Espécie sem paleta própria cai aqui em vez de não quebrar nada. */
export const DEFAULT_PALETTE:FruitPalette={shell:'#7a6a3c',pulp:'#d9584a',seed:'#cdb570',rind:'#eec0a8',family:'berry',counts:{shell:3,pulp:2,seed:3}};
export const fruitPalette=(kind:string):FruitPalette=>FRUIT_PALETTES[kind]??DEFAULT_PALETTE;

/** Teto de pedaços vivos. Acima disto o mais antigo é reciclado — sem chuva infinita de polígonos. */
export const FRAGMENT_BUDGET=54;
/** Quebras guardadas enquanto o modelo carrega. Só os pedidos, nunca a malha do inimigo. */
export const PENDING_BURSTS=4;

/** Vida em segundos por papel: casca dura mais no chão, semente some antes. */
const ROLE_LIFE:Readonly<Record<FragmentRole,number>>={shell:6.5,pulp:4.5,seed:3.5};
/** Variação de tamanho por papel; o molde já vem no tamanho de mundo, aqui só quebra a repetição. */
const ROLE_SPREAD:Readonly<Record<FragmentRole,number>>={shell:.18,pulp:.22,seed:.26};

interface Fragment {
  mesh:Mesh;
  /** Partes extras do mesmo caco (face cortada), presas ao mesh principal. */
  extras:Mesh[];
  role:FragmentRole;
  /** Molde em uso. É o que impede um caco de melancia reaparecer como pedaço de milho. */
  template:string;
  /** Meia-extensão local do molde, em metros, antes da escala do pedaço. */
  half:Vector3;
  velocity:Vector3;spin:Vector3;
  life:number;maxLife:number;active:boolean;resting:boolean;
}

interface PendingBurst {kind:string;x:number;y:number;z:number;dx:number;dz:number;power:number}

/** Ruído determinístico barato: a mesma sequência de golpes dá sempre os mesmos cacos. */
const noise=(n:number):number=>{const s=Math.sin(n*127.1+311.7)*43758.5453;return s-Math.floor(s);};

/**
 * Pedaços de fruta por espécie.
 *
 * A geometria vem de `public/models/fruit-fragments.glb`: cada caco é um **recorte real** do corpo
 * do inimigo, com UV, textura e material de pele preservados, mais a face cortada com material
 * próprio. Nada é montado por primitiva em tempo de execução e nada é clonado do corpo em cena —
 * clone reduzido vira miniatura da fruta inteira, não caco.
 *
 * O carregamento começa no construtor. Quebra que chega antes do modelo fica guardada como pedido
 * (posição e força, nunca a malha do inimigo) e sai assim que os moldes entram; enquanto isso não
 * aparece nenhum substituto geométrico. O pool tem teto e **troca o molde ao reaproveitar**.
 */
export class FruitFragments {
  private readonly pool:Fragment[]=[];
  private readonly library:FragmentLibrary;
  private readonly rotation=Matrix.Identity();
  private readonly queue:PendingBurst[]=[];
  /** Contador das quebras: toda variação sai daqui. */
  private spawns=0;
  private disposed=false;
  /** Resolve quando os moldes reais estão prontos (ou falharam). A fixture de QA usa isto. */
  readonly ready:Promise<boolean>;

  constructor(private readonly scene:Scene,private readonly collision:CollisionWorld,loader?:FragmentLoader){
    this.library=loader?new FragmentLibrary(scene,loader):new FragmentLibrary(scene);
    this.ready=this.library.ready.then(ok=>{if(ok&&!this.disposed)this.flush();return ok;});
  }

  get active():number {return this.pool.filter(fragment=>fragment.active).length;}
  get capacity():number {return FRAGMENT_BUDGET;}
  /** Moldes prontos. Antes disso a quebra fica na fila em vez de inventar geometria. */
  get loaded():boolean {return this.library.loaded;}
  /** Falha de carga do modelo, quando houver. */
  get error():string {return this.library.error;}
  /** Custo real em triângulos dos moldes carregados — usado na revisão de orçamento. */
  get shapeTriangles():number {return this.library.triangles;}

  private take(template:FragmentTemplate,role:FragmentRole):Fragment {
    // Preferir um slot que já esteja com o molde certo evita troca de geometria à toa.
    let fragment=this.pool.find(f=>!f.active&&f.template===template.key)??this.pool.find(f=>!f.active);
    if(!fragment&&this.pool.length<FRAGMENT_BUDGET){
      const mesh=new Mesh('fruit-fragment',this.scene);
      mesh.isPickable=false;mesh.receiveShadows=true;mesh.rotationQuaternion=null;mesh.doNotSyncBoundingInfo=true;
      mesh.setEnabled(false);
      fragment={mesh,extras:[],role,template:'',half:Vector3.Zero(),velocity:Vector3.Zero(),spin:Vector3.Zero(),
                life:0,maxLife:ROLE_LIFE[role],active:false,resting:false};
      this.pool.push(fragment);
    }
    // Pool cheio e tudo em uso: recicla o mais velho em vez de crescer sem limite.
    if(!fragment)fragment=this.pool.reduce((a,b)=>a.life<=b.life?a:b);
    this.retarget(fragment,template,role);
    return fragment;
  }

  /** Troca papel e molde do slot. Sem isto o caco herda a geometria da espécie anterior. */
  private retarget(fragment:Fragment,template:FragmentTemplate,role:FragmentRole):void {
    fragment.role=role;
    fragment.maxLife=ROLE_LIFE[role];
    if(fragment.template===template.key)return;
    const [first,...rest]=template.parts;
    if(!first)return;
    first.geometry.applyToMesh(fragment.mesh);
    fragment.mesh.material=first.material;
    fragment.mesh.hasVertexAlpha=false;
    rest.forEach((part,index)=>{
      let extra=fragment.extras[index];
      if(!extra){
        extra=new Mesh('fruit-fragment-part',this.scene);
        extra.parent=fragment.mesh;extra.isPickable=false;extra.receiveShadows=true;extra.doNotSyncBoundingInfo=true;
        fragment.extras[index]=extra;
      }
      part.geometry.applyToMesh(extra);
      extra.material=part.material;extra.hasVertexAlpha=false;extra.setEnabled(true);
    });
    for(let index=rest.length;index<fragment.extras.length;index++)fragment.extras[index]!.setEnabled(false);
    fragment.half.copyFrom(template.half);
    fragment.template=template.key;
  }

  /** Altura de saída: o meio do corpo que quebrou, com recuo seguro se a caixa vier estranha. */
  private burstHeight(position:Vec3,body:Mesh|undefined):number {
    const center=body&&!body.isDisposed()&&body.getTotalVertices()>0?body.getBoundingInfo().boundingBox.centerWorld.y:NaN;
    return Number.isFinite(center)&&Math.abs(center-position.y)<4?center:position.y+.9;
  }

  /** Quanto o pedaço, já girado e escalado, desce abaixo do próprio centro. */
  private support(fragment:Fragment):number {
    const r=fragment.mesh.rotation,s=fragment.mesh.scaling,h=fragment.half;
    Matrix.RotationYawPitchRollToRef(r.y,r.x,r.z,this.rotation);
    const m=this.rotation.m;
    return Math.abs(m[1]!)*h.x*s.x+Math.abs(m[5]!)*h.y*s.y+Math.abs(m[9]!)*h.z*s.z;
  }

  /**
   * Quebra uma fruta em `position`, arremessando na direção do golpe.
   * `power` escala a força e a quantidade (0..1 reduz, >1 aumenta até o dobro).
   */
  burst(kind:string,position:Vec3,direction:Vec3,body:Mesh,power=1):void {
    if(this.disposed)return;
    const height=this.burstHeight(position,body);
    if(!this.library.loaded){
      // Guarda o pedido — nunca a malha do inimigo, que pode ser destruída antes do modelo chegar.
      this.queue.push({kind,x:position.x,y:height,z:position.z,dx:direction.x,dz:direction.z,power});
      if(this.queue.length>PENDING_BURSTS)this.queue.shift();
      return;
    }
    this.spawn(kind,position.x,height,position.z,direction.x,direction.z,power);
  }

  private flush():void {
    const pending=this.queue.splice(0,this.queue.length);
    for(const burst of pending)this.spawn(burst.kind,burst.x,burst.y,burst.z,burst.dx,burst.dz,burst.power);
  }

  private spawn(kind:string,x:number,y:number,z:number,dx:number,dz:number,power:number):void {
    const palette=fruitPalette(kind),scale=Math.max(.2,Math.min(2,power));
    const family=palette.family??'berry';
    const size=(palette.size??1)*Math.min(1.25,.85+scale*.25);
    const push=new Vector3(dx,0,dz);
    if(push.lengthSquared()<1e-4)push.set(0,0,1);else push.normalize();
    let index=0;
    for(const role of ['shell','pulp','seed'] as const){
      const count=Math.max(1,Math.round(palette.counts[role]*Math.min(1.5,scale)));
      for(let i=0;i<count;i++){
        const roll=this.spawns++;
        const template=this.library.get(family,role,roll%SHAPE_VARIANTS);
        if(!template)return;
        const fragment=this.take(template,role);
        const angle=index++*2.399,spread=role==='seed'?1:.55;
        // Casca sai mais lenta e pesada; semente voa leve e longe.
        const speed=(role==='shell'?3.4:role==='pulp'?4.2:6.2)*scale*(.82+.36*noise(roll*3+1));
        const grow=size*(1-ROLE_SPREAD[role]/2+ROLE_SPREAD[role]*noise(roll*5+2));
        // Variação quase uniforme: o caco é um corpo real, esticar num eixo denuncia o truque.
        fragment.mesh.scaling.set(grow*(.97+.06*noise(roll*7+3)),grow*(.97+.06*noise(roll*11+4)),grow*(.97+.06*noise(roll*13+5)));
        fragment.mesh.position.set(x,y,z);
        fragment.velocity.set(
          (push.x+Math.sin(angle)*spread)*speed,
          (role==='shell'?3:role==='pulp'?4.2:5.4)*scale*(.7+.3*Math.abs(Math.cos(angle))),
          (push.z+Math.cos(angle)*spread)*speed,
        );
        fragment.spin.set(2+index*.4,1.2-index*.13,2.6-index*.21);
        fragment.mesh.rotation.set(angle,angle*.7,angle*.3);
        fragment.life=fragment.maxLife;fragment.active=true;fragment.resting=false;
        fragment.mesh.setEnabled(true);this.fade(fragment,1);
      }
    }
  }

  private fade(fragment:Fragment,value:number):void {
    fragment.mesh.visibility=value;
    for(const extra of fragment.extras)extra.visibility=value;
  }

  update(dt:number):void {
    if(this.disposed||dt<=0)return;
    for(const fragment of this.pool){
      if(!fragment.active)continue;
      fragment.life-=dt;
      if(fragment.life<=0){fragment.active=false;fragment.mesh.setEnabled(false);continue;}
      // Último segundo desaparece em vez de sumir de um quadro para o outro.
      this.fade(fragment,Math.min(1,fragment.life));
      if(fragment.resting)continue;
      fragment.velocity.y-=15*dt;
      fragment.mesh.position.addInPlace(fragment.velocity.scale(dt));
      fragment.mesh.rotation.addInPlace(fragment.spin.scale(dt));
      // O apoio sai da extensão do pedaço já girado: caco chato deita, lasca comprida não afunda.
      const rest=this.support(fragment);
      const ground=this.collision.groundAt(fragment.mesh.position.x,fragment.mesh.position.z,fragment.mesh.position.y+2);
      if(!Number.isFinite(ground)){
        // Caiu no vazio entre as ilhas: recolhe em vez de cair para sempre.
        if(fragment.mesh.position.y<-40){fragment.active=false;fragment.mesh.setEnabled(false);}
        continue;
      }
      if(fragment.mesh.position.y>ground+rest)continue;
      fragment.mesh.position.y=ground+rest;
      const bounce=fragment.role==='seed'?.34:fragment.role==='pulp'?.12:.2;
      fragment.velocity.y=Math.abs(fragment.velocity.y)*bounce;
      const friction=Math.exp(-dt*(fragment.role==='pulp'?11:7));
      fragment.velocity.x*=friction;fragment.velocity.z*=friction;fragment.spin.scaleInPlace(friction);
      // Assenta de vez quando para: nada de tremer no chão consumindo quadro.
      if(fragment.velocity.lengthSquared()<.35){
        fragment.resting=true;fragment.velocity.setAll(0);fragment.spin.setAll(0);
        // Deita na face mais chata sem girar o pedaço de cabeça para baixo de repente.
        fragment.mesh.rotation.x=Math.round(fragment.mesh.rotation.x/Math.PI)*Math.PI;
        fragment.mesh.rotation.z=Math.round(fragment.mesh.rotation.z/Math.PI)*Math.PI;
        fragment.mesh.position.y=ground+this.support(fragment);
      }
    }
  }

  clear():void {
    this.queue.length=0;
    for(const fragment of this.pool){fragment.active=false;fragment.resting=false;fragment.mesh.setEnabled(false);}
  }

  dispose():void {
    this.disposed=true;
    this.queue.length=0;
    // Solta a geometria compartilhada antes: o molde pertence ao container, não ao pedaço.
    for(const fragment of this.pool){
      for(const extra of fragment.extras){extra.geometry?.releaseForMesh(extra);extra.dispose();}
      fragment.mesh.geometry?.releaseForMesh(fragment.mesh);
      fragment.mesh.dispose();
    }
    this.pool.length=0;
    this.library.dispose();
  }
}

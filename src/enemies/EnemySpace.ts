import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';

/**
 * Porto de superfície da horda.
 *
 * O `EnemySwarm` original continua sendo o jogo: o que muda é QUEM responde "para cima".
 * `FlatSpace` chama exatamente as mesmas funções, com os mesmos argumentos e as mesmas tolerâncias
 * que o código de hoje — é ele o oráculo de regressão da fazenda. `RadialSpace` delega a um
 * `EnemySurface` (satisfeito estruturalmente pelo `SurfaceFrame` da física) e mede arco, apoia por
 * radial e orienta por quaternion.
 *
 * Contrato publicado em `.temp/real-game-enemy-api.md`.
 */

export interface EnemySupport {point:Vec3;normal:Vec3;offset:number;slopeDegrees:number}
export interface EnemyBasis {up:Vec3;forward:Vec3;right:Vec3}

/**
 * Subconjunto de `SurfaceFrame` (plano §2.1) que a horda consome. Declarado aqui de propósito:
 * assim o subsistema de inimigos não depende da ORDEM em que o arquivo do outro dono aparece, e
 * `SurfaceFrame` passa a ser aceito por tipagem estrutural no dia em que existir.
 */
export interface EnemySurface {
  up(p:Vec3):Vec3;
  support(p:Vec3,above:number,below:number):EnemySupport|undefined;
  slide(p:Vec3,delta:Vec3,radius:number,height:number,step:number):void;
  sweep(from:Vec3,delta:Vec3,radius:number):{time:number;normal:Vec3}|undefined;
  planarDistance(a:Vec3,b:Vec3):number;
  heightGap(a:Vec3,b:Vec3):number;
  basis(p:Vec3,forwardHint:Vec3):EnemyBasis;
}

/**
 * Direção de marcha de um ator. `y` é OPCIONAL de propósito: na fazenda ela nunca é escrita e todo
 * literal `{x,z}` que já existe continua válido; no planeta ela carrega a componente tangente que
 * falta. Assim a mudança não toca nenhum chamador do mundo plano.
 */
export interface Heading {x:number;z:number;y?:number}

/** Quanto do arco o corpo aceita procurar apoio para baixo antes de declarar vazio. */
const RADIAL_BELOW = 6;
/** Sonda de queda (cadáver, projétil): o equivalente radial do `groundAt(x,z,6)` plano. */
const RADIAL_FALL_BELOW = 60;

export interface EnemySpace {
  /** `true` só no planeta. Quem precisa ramificar de verdade (buckets 3D) lê isto. */
  readonly radial:boolean;
  /** Distância CAMINHÁVEL entre dois pontos: plano `hypot(dx,dz)`, esfera arco no convés. */
  distance(a:Vec3,b:Vec3):number;
  distanceSquared(a:Vec3,b:Vec3):number;
  /** Diferença de altura COM SINAL, na vertical local de `b`. Plano: `a.y − b.y`. */
  heightGap(a:Vec3,b:Vec3):number;
  /** Vertical local unitária. */
  upInto(p:Vec3,out:Vector3):Vector3;
  /** `p` deslocado `height` metros na vertical local. */
  lift(p:Vec3,height:number,out:Vector3):Vector3;
  /** Componente de `v` tangente à superfície em `p`. Plano: zera `y`. */
  tangentInto(p:Vec3,v:Vec3,out:Vector3):Vector3;
  /** Direção tangente unitária de `from` para `to`; devolve a distância caminhável. */
  towardInto(from:Vec3,to:Vec3,out:Vector3):number;
  /** Apoio sob `p`, sondando de `above` acima. `false` = vazio (sem piso). */
  groundUnder(p:Vec3,above:number,out:Vector3):boolean;
  /** Apoio para um corpo em QUEDA (cadáver, projétil). Plano: o `groundAt(x,z,6)` de hoje. */
  fallGround(p:Vec3,out:Vector3):boolean;
  /** Piso para desenhar um decalque em `point`, sondado a partir da altura de `reference`. */
  decal(point:Vec3,reference:Vec3,out:Vector3):Vector3;
  /** Deslocamento com deslizamento em parede. Muta `p`. Plano: `collision.move(p,d.x,d.z,…)`. */
  slide(p:Vec3,delta:Vec3,radius:number,height:number,step:number):void;
  /** Varredura contra o cenário; `undefined` = livre. */
  sweepTime(from:Vec3,delta:Vec3,radius:number):number|undefined;
  /** Gravidade local: subtrai `g·dt` de `velocity` ao longo da vertical de `p`. */
  gravity(p:Vec3,velocity:Vector3,g:number,dt:number):void;
  /** Soma `amount` à velocidade na vertical local (elevação balística do projétil). */
  raise(p:Vec3,velocity:Vector3,amount:number):void;
  /** Gira `heading` por `angle` no plano tangente de `p`. Muta `heading`. */
  rotateHeading(p:Vec3,heading:Heading,angle:number):void;
  /** Zera a componente vertical local de `velocity` (corpo que assentou no convés). */
  clearVertical(p:Vec3,velocity:Vector3):void;
  /** Módulo da parte TANGENTE de `v`. Plano: `hypot(v.x,v.z)`. */
  planarSpeed(p:Vec3,v:Vec3):number;
  /** Ponto num anel tangente em torno de `centre`, `lift` metros acima do convés. */
  ringPoint(centre:Vec3,angle:number,radius:number,lift:number,out:Vector3):Vector3;
  /** Chave da grade de separação. Plano: grade 2D de 3 m; esfera: grade 3D de 3 m. */
  bucketKey(p:Vec3):number;
  /** Visita a vizinhança da grade de separação (9 células no plano, 27 na esfera). */
  neighbourhood(p:Vec3,visit:(key:number)=>void):void;
  /**
   * Giro INCREMENTAL da raiz para `heading` (tangente, espaço de mundo), com a mesma fração
   * `min(1,dt*k)` de hoje. `facing` é o estado de direção do ator e é atualizado no lugar.
   */
  face(node:TransformNode,facing:Vector3,p:Vec3,heading:Vec3,blend:number):void;
  /** Pose imediata olhando para `look` — usada ao nascer. */
  faceAt(node:TransformNode,facing:Vector3,p:Vec3,look:Vec3):void;
}

/**
 * Fazenda. Cada método é a expressão literal que estava embutida no `EnemySwarm`, sem
 * arredondamento novo, sem reordenar operações de ponto flutuante.
 */
export class FlatSpace implements EnemySpace {
  readonly radial=false;
  constructor(private readonly collision:CollisionWorld){}
  distance(a:Vec3,b:Vec3):number{return Math.hypot(a.x-b.x,a.z-b.z);}
  distanceSquared(a:Vec3,b:Vec3):number{const dx=a.x-b.x,dz=a.z-b.z;return dx*dx+dz*dz;}
  heightGap(a:Vec3,b:Vec3):number{return a.y-b.y;}
  upInto(_p:Vec3,out:Vector3):Vector3{return out.copyFromFloats(0,1,0);}
  lift(p:Vec3,height:number,out:Vector3):Vector3{return out.copyFromFloats(p.x,p.y+height,p.z);}
  tangentInto(_p:Vec3,v:Vec3,out:Vector3):Vector3{return out.copyFromFloats(v.x,0,v.z);}
  towardInto(from:Vec3,to:Vec3,out:Vector3):number{
    // `||1` é a mesma guarda de divisão que o `EnemySwarm` já usava: alvo exatamente em cima do
    // corpo devolve `(0,0,0)`, e não um vetor arbitrário.
    const dx=to.x-from.x,dz=to.z-from.z,length=Math.hypot(dx,dz);
    out.copyFromFloats(dx/(length||1),0,dz/(length||1));return length;
  }
  groundUnder(p:Vec3,above:number,out:Vector3):boolean{
    const y=this.collision.groundAt(p.x,p.z,p.y+above);
    if(!Number.isFinite(y))return false;
    out.copyFromFloats(p.x,y,p.z);return true;
  }
  fallGround(p:Vec3,out:Vector3):boolean{
    const y=this.collision.groundAt(p.x,p.z,6);
    if(!Number.isFinite(y))return false;
    out.copyFromFloats(p.x,y,p.z);return true;
  }
  decal(point:Vec3,reference:Vec3,out:Vector3):Vector3{
    const y=this.collision.groundAt(point.x,point.z,reference.y+.5);
    return out.copyFromFloats(point.x,Number.isFinite(y)?y:reference.y,point.z);
  }
  slide(p:Vec3,delta:Vec3,radius:number,height:number,step:number):void{
    this.collision.move(p,delta.x,delta.z,radius,height,step);
  }
  sweepTime(from:Vec3,delta:Vec3,radius:number):number|undefined{
    return this.collision.sweepSphere(from,delta,radius)?.time;
  }
  gravity(_p:Vec3,velocity:Vector3,g:number,dt:number):void{velocity.y-=g*dt;}
  raise(_p:Vec3,velocity:Vector3,amount:number):void{velocity.y+=amount;}
  rotateHeading(_p:Vec3,heading:Heading,angle:number):void{
    const x=heading.x;
    heading.x=x*Math.cos(angle)-heading.z*Math.sin(angle);
    heading.z=x*Math.sin(angle)+heading.z*Math.cos(angle);
  }
  clearVertical(_p:Vec3,velocity:Vector3):void{velocity.y=0;}
  planarSpeed(_p:Vec3,v:Vec3):number{return Math.hypot(v.x,v.z);}
  ringPoint(centre:Vec3,angle:number,radius:number,lift:number,out:Vector3):Vector3{
    return out.copyFromFloats(centre.x+Math.sin(angle)*radius,centre.y+lift,centre.z+Math.cos(angle)*radius);
  }
  bucketKey(p:Vec3):number{return Math.floor(p.x/3)*1048576+Math.floor(p.z/3);}
  neighbourhood(p:Vec3,visit:(key:number)=>void):void{
    const x=Math.floor(p.x/3),z=Math.floor(p.z/3);
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)visit((x+dx)*1048576+(z+dz));
  }
  face(node:TransformNode,_facing:Vector3,_p:Vec3,heading:Vec3,blend:number):void{
    if(!heading.x&&!heading.z)return;
    const yaw=Math.atan2(heading.x,heading.z);
    node.rotation.y+=Math.atan2(Math.sin(yaw-node.rotation.y),Math.cos(yaw-node.rotation.y))*blend;
  }
  faceAt(node:TransformNode,_facing:Vector3,p:Vec3,look:Vec3):void{
    // Corpo reciclado que já rodou no planeta volta ao euler; sem isto o Babylon ignoraria `rotation`.
    node.rotationQuaternion=null;
    node.rotation.set(0,Math.atan2(look.x-p.x,look.z-p.z),0);
  }
}

/** Escrita uma vez, reusada por quadro: a horda não pode alocar por ator por método. */
const scratchA=new Vector3(),scratchB=new Vector3(),scratchC=new Vector3();
const scratchMatrix=new Matrix(),scratchQuaternion=new Quaternion();
const scratchVec:Vec3={x:0,y:0,z:0},scratchDelta:Vec3={x:0,y:0,z:0};
const RING_HINT:Vec3={x:0,y:0,z:1};

/** Planeta. Toda posição continua em coordenadas de MUNDO; só a vertical deixa de ser `+Y`. */
export class RadialSpace implements EnemySpace {
  readonly radial=true;
  constructor(private readonly surface:EnemySurface){}
  distance(a:Vec3,b:Vec3):number{return this.surface.planarDistance(a,b);}
  distanceSquared(a:Vec3,b:Vec3):number{const d=this.surface.planarDistance(a,b);return d*d;}
  heightGap(a:Vec3,b:Vec3):number{return this.surface.heightGap(a,b);}
  upInto(p:Vec3,out:Vector3):Vector3{const u=this.surface.up(p);return out.copyFromFloats(u.x,u.y,u.z);}
  lift(p:Vec3,height:number,out:Vector3):Vector3{
    const u=this.surface.up(p);
    return out.copyFromFloats(p.x+u.x*height,p.y+u.y*height,p.z+u.z*height);
  }
  tangentInto(p:Vec3,v:Vec3,out:Vector3):Vector3{
    const u=this.surface.up(p),d=v.x*u.x+v.y*u.y+v.z*u.z;
    return out.copyFromFloats(v.x-u.x*d,v.y-u.y*d,v.z-u.z*d);
  }
  towardInto(from:Vec3,to:Vec3,out:Vector3):number{
    const u=this.surface.up(from);
    const dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z,d=dx*u.x+dy*u.y+dz*u.z;
    const tx=dx-u.x*d,ty=dy-u.y*d,tz=dz-u.z*d,length=Math.hypot(tx,ty,tz)||1;
    out.copyFromFloats(tx/length,ty/length,tz/length);
    return this.surface.planarDistance(from,to);
  }
  groundUnder(p:Vec3,above:number,out:Vector3):boolean{
    const s=this.surface.support(p,above,RADIAL_BELOW);
    if(!s)return false;
    out.copyFromFloats(s.point.x,s.point.y,s.point.z);return true;
  }
  fallGround(p:Vec3,out:Vector3):boolean{
    const s=this.surface.support(p,.5,RADIAL_FALL_BELOW);
    if(!s)return false;
    out.copyFromFloats(s.point.x,s.point.y,s.point.z);return true;
  }
  decal(point:Vec3,reference:Vec3,out:Vector3):Vector3{
    const above=Math.max(.5,this.surface.heightGap(reference,point)+.5);
    const s=this.surface.support(point,above,14);
    return s?out.copyFromFloats(s.point.x,s.point.y,s.point.z):out.copyFromFloats(point.x,point.y,point.z);
  }
  slide(p:Vec3,delta:Vec3,radius:number,height:number,step:number):void{
    this.surface.slide(p,delta,radius,height,step);
  }
  sweepTime(from:Vec3,delta:Vec3,radius:number):number|undefined{
    return this.surface.sweep(from,delta,radius)?.time;
  }
  gravity(p:Vec3,velocity:Vector3,g:number,dt:number):void{
    const u=this.surface.up(p),fall=g*dt;
    velocity.set(velocity.x-u.x*fall,velocity.y-u.y*fall,velocity.z-u.z*fall);
  }
  raise(p:Vec3,velocity:Vector3,amount:number):void{
    const u=this.surface.up(p);
    velocity.set(velocity.x+u.x*amount,velocity.y+u.y*amount,velocity.z+u.z*amount);
  }
  rotateHeading(p:Vec3,heading:Heading,angle:number):void{
    const u=this.surface.up(p),c=Math.cos(angle),s=Math.sin(angle);
    const x=heading.x,y=heading.y??0,z=heading.z;
    // Rodrigues em torno da vertical local; a parte paralela a `up` fica onde está.
    const kx=u.y*z-u.z*y,ky=u.z*x-u.x*z,kz=u.x*y-u.y*x,d=(u.x*x+u.y*y+u.z*z)*(1-c);
    heading.x=x*c+kx*s+u.x*d;heading.y=y*c+ky*s+u.y*d;heading.z=z*c+kz*s+u.z*d;
  }
  clearVertical(p:Vec3,velocity:Vector3):void{
    const u=this.surface.up(p),d=velocity.x*u.x+velocity.y*u.y+velocity.z*u.z;
    velocity.set(velocity.x-u.x*d,velocity.y-u.y*d,velocity.z-u.z*d);
  }
  planarSpeed(p:Vec3,v:Vec3):number{
    const u=this.surface.up(p),d=v.x*u.x+v.y*u.y+v.z*u.z;
    return Math.hypot(v.x-u.x*d,v.y-u.y*d,v.z-u.z*d);
  }
  ringPoint(centre:Vec3,angle:number,radius:number,lift:number,out:Vector3):Vector3{
    // Dica constante: a fase do anel não precisa acompanhar ninguém, só ser estável no quadro.
    const basis=this.surface.basis(centre,RING_HINT);
    const s=Math.sin(angle)*radius,c=Math.cos(angle)*radius;
    return out.copyFromFloats(
      centre.x+basis.right.x*s+basis.forward.x*c+basis.up.x*lift,
      centre.y+basis.right.y*s+basis.forward.y*c+basis.up.y*lift,
      centre.z+basis.right.z*s+basis.forward.z*c+basis.up.z*lift,
    );
  }
  /**
   * Grade de separação 3D. No plano a chave é 2D porque `y` é quase constante; numa casca esférica
   * dois corpos em lados opostos do globo têm o mesmo `(x,z)` e seriam empurrados um pelo outro.
   */
  bucketKey(p:Vec3):number{
    return ((Math.floor(p.x/3)+512)*1024+(Math.floor(p.y/3)+512))*1024+(Math.floor(p.z/3)+512);
  }
  neighbourhood(p:Vec3,visit:(key:number)=>void):void{
    const x=Math.floor(p.x/3),y=Math.floor(p.y/3),z=Math.floor(p.z/3);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)
      visit(((x+dx+512)*1024+(y+dy+512))*1024+(z+dz+512));
  }
  /**
   * Gira `facing` em direção a `heading` DENTRO do plano tangente, pela mesma fração de hoje, e
   * escreve a pose na raiz como quaternion. O passo é uma rotação em torno da vertical local, então
   * o corpo nunca sai da superfície nem faz ginete no polo.
   */
  face(node:TransformNode,facing:Vector3,p:Vec3,heading:Vec3,blend:number):void{
    const wanted=this.tangentInto(p,heading,scratchA);
    if(wanted.lengthSquared()<1e-12)return this.write(node,facing,p);
    wanted.normalize();
    const current=this.tangentInto(p,facing,scratchB);
    if(current.lengthSquared()<1e-12){facing.copyFrom(wanted);return this.write(node,facing,p);}
    current.normalize();
    const cos=Math.min(1,Math.max(-1,Vector3.Dot(current,wanted)));
    const angle=Math.acos(cos)*Math.min(1,Math.max(0,blend));
    if(angle<1e-6){facing.copyFrom(wanted);return this.write(node,facing,p);}
    // Eixo do giro é a vertical local: o sinal vem de `up · (current × wanted)`.
    const u=this.upInto(p,scratchC);
    Vector3.CrossToRef(current,wanted,scratchA);
    const turn=Vector3.Dot(u,scratchA)>=0?angle:-angle;
    const c=Math.cos(turn),s=Math.sin(turn);
    // Rodrigues em torno de `u`, que já é unitário e perpendicular a `current`.
    Vector3.CrossToRef(u,current,scratchA);
    facing.copyFromFloats(
      current.x*c+scratchA.x*s,current.y*c+scratchA.y*s,current.z*c+scratchA.z*s,
    );
    this.write(node,facing,p);
  }
  faceAt(node:TransformNode,facing:Vector3,p:Vec3,look:Vec3):void{
    scratchDelta.x=look.x-p.x;scratchDelta.y=look.y-p.y;scratchDelta.z=look.z-p.z;
    const wanted=this.tangentInto(p,scratchDelta,scratchA);
    if(wanted.lengthSquared()>1e-12)facing.copyFrom(wanted.normalize());
    this.write(node,facing,p);
  }
  /** Base de superfície → `rotationQuaternion` da raiz. A pose local do rig não é tocada. */
  private write(node:TransformNode,facing:Vector3,p:Vec3):void{
    scratchVec.x=facing.x;scratchVec.y=facing.y;scratchVec.z=facing.z;
    const basis=this.surface.basis(p,scratchVec);
    facing.copyFromFloats(basis.forward.x,basis.forward.y,basis.forward.z);
    scratchA.copyFromFloats(basis.right.x,basis.right.y,basis.right.z);
    scratchB.copyFromFloats(basis.up.x,basis.up.y,basis.up.z);
    Matrix.FromXYZAxesToRef(scratchA,scratchB,facing,scratchMatrix);
    Quaternion.FromRotationMatrixToRef(scratchMatrix,scratchQuaternion);
    (node.rotationQuaternion??=new Quaternion()).copyFrom(scratchQuaternion);
  }
}

/**
 * Filtra a superfície que realmente muda o referencial.
 *
 * O `GameWorld` entrega `collision.surface` sempre — e na fazenda isso é um `FlatSurface`, que se
 * declara `kind: 'flat'`. Todo módulo de apresentação da horda passa por aqui antes de guardar a
 * superfície, para que o caminho plano continue sendo o código plano LITERAL, e não uma versão
 * radial que por acaso dá quase o mesmo número.
 */
export const radialSurfaceOf=(surface:EnemySurface|undefined):EnemySurface|undefined =>
  surface&&(surface as {kind?:string}).kind!=='flat'?surface:undefined;

/**
 * Constrói o porto certo.
 *
 * Sem `surface`, o caminho é o da fazenda. **Com uma superfície que se declara `kind: 'flat'`,
 * também**: o `GameWorld` passa `collision.surface` SEMPRE, e na fazenda isso é um `FlatSurface`.
 * Embrulhar o `FlatSurface` no `RadialSpace` daria quase o mesmo resultado numérico, mas por outro
 * caminho — grade de separação 3D em vez de 2D, `rotationQuaternion` em vez de `rotation.y`,
 * `planarDistance` em vez de `hypot(dx,dz)`. "Quase" não serve: o pedido é que a fazenda não mude
 * um bit, então quem se declara plano volta para o código plano literal.
 */
export const enemySpace=(collision:CollisionWorld,surface?:EnemySurface):EnemySpace =>
  surface&&(surface as {kind?:string}).kind!=='flat'?new RadialSpace(surface):new FlatSpace(collision);

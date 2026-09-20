import {CreateDisc} from '@babylonjs/core/Meshes/Builders/discBuilder';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import {Constants} from '@babylonjs/core/Engines/constants';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';
import type {GroundFirePatch} from '../combat/GroundFire';

/**
 * O chão em chamas, desenhado.
 *
 * A primeira versão disto era um disco emissivo chapado, e lia exatamente como o que era: um
 * círculo laranja no chão. O problema não é o disco — é que o fogo não TEM borda circular, não tem
 * brilho uniforme e não fica parado. Aqui a geometria continua sendo um disco (é só o suporte),
 * mas quem desenha é um shader:
 *
 * - **borda irregular** — o raio de corte é modulado por ruído, então o contorno é recortado como
 *   uma queimada real espalhando pela grama, não compassado;
 * - **brasa que rasteja** — duas oitavas de fBm em velocidades diferentes, uma lenta (o leito de
 *   brasa) e uma rápida (a língua de chama por cima);
 * - **gradiente de temperatura** — carvão escuro nas beiradas, laranja no corpo, quase branco nos
 *   pontos mais quentes, que é como fogo real se distribui;
 * - **cintilação** — o brilho pulsa fora de fase por poça, senão doze poças piscariam juntas e o
 *   olho leria "efeito", não "fogo".
 *
 * O disco é orientado pela vertical LOCAL da poça, não por `+Y`. No planeta uma marca em `+Y`
 * ficaria de pé feito placa no equador.
 *
 * Um material por poça porque cada uma precisa do próprio `life` e da própria semente; são doze
 * materiais minúsculos, criados uma vez e reaproveitados enquanto a cena viver.
 */

const vertexSource = `precision highp float;
attribute vec3 position; attribute vec2 uv;
uniform mat4 worldViewProjection; varying vec2 vUV;
void main(){vUV=uv;gl_Position=worldViewProjection*vec4(position,1.0);}`;

const fragmentSource = `precision highp float;
varying vec2 vUV;
uniform float time;   // relógio de apresentação, em segundos
uniform float life;   // 1 recém-acesa, 0 apagando
uniform float seed;   // tira as poças de fase entre si

float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),
             mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);
}
float fbm(vec2 p){
  float v=0.0,a=0.5;
  for(int i=0;i<4;i++){v+=a*noise(p);p*=2.02;a*=0.5;}
  return v;
}

void main(){
  vec2 p=vUV*2.0-1.0;
  float r=length(p);
  if(r>1.0)discard;
  // Leito de brasa: lento, grande, é o que define a MANCHA.
  float bed=fbm(p*3.4+vec2(seed,seed*1.7)+vec2(0.0,-time*0.30));
  // Língua de chama: rápida, miúda, é o que se mexe por cima.
  float tongue=fbm(p*7.6-vec2(time*0.62,seed*2.3));
  // A borda do fogo é recortada pelo ruído — nunca um círculo.
  float edge=1.0-smoothstep(0.48+bed*0.42,1.0,r);
  float heat=edge*(bed*0.72+tongue*0.55)*life;
  if(heat<0.02)discard;
  vec3 coal=vec3(0.30,0.035,0.01);
  vec3 flame=vec3(1.55,0.48,0.06);
  vec3 core=vec3(2.4,1.55,0.55);
  vec3 colour=mix(coal,flame,smoothstep(0.08,0.52,heat));
  colour=mix(colour,core,smoothstep(0.58,0.95,heat));
  // Fora de fase por poça, e mais nervosa quando a chama está alta.
  float flicker=0.82+0.18*sin(time*11.0+seed*6.283+bed*9.0);
  gl_FragColor=vec4(colour*flicker,clamp(heat,0.0,1.0));
}`;

/** Quantas labaredas 3D por segundo cada poça pede, POR CIMA do shader. */
const FLAMES_PER_SECOND = 5;
/** Labaredas pedidas por quadro no total, somando todas as poças. */
const FLAME_BUDGET = 3;

export interface FlamePort {
  /** A mesma assinatura de `ElementalEffects.emit`. */
  emit(kind: 'fire', at: Vector3, power: number): void;
}

export class GroundFireView {
  private readonly discs: Mesh[] = [];
  private readonly materials: ShaderMaterial[] = [];
  /** Relógio de labareda por poça, casado por índice com a lista que `render` recebe. */
  private readonly clocks: number[] = [];
  private readonly scratch = new Vector3();
  private clock = 0;

  constructor(scene: Scene, limit: number) {
    for (let i = 0; i < limit; i++) {
      const material = new ShaderMaterial('ground-fire-mat-' + i, scene,
        {vertexSource, fragmentSource},
        {attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'time', 'life', 'seed']});
      material.alphaMode = Constants.ALPHA_ADD;
      material.backFaceCulling = false;
      // Sem escrita de profundidade: a chama é aditiva e não deve recortar o que está atrás dela.
      material.needAlphaBlending = () => true;
      material.setFloat('seed', (i * 7.31) % 6.283);
      material.setFloat('life', 1);
      material.setFloat('time', 0);
      const disc = CreateDisc('ground-fire-' + i, {radius: 1, tessellation: 24}, scene);
      disc.material = material;
      disc.isPickable = false;
      disc.setEnabled(false);
      this.materials.push(material);
      this.discs.push(disc);
    }
  }

  /**
   * Desenha as poças vivas deste quadro.
   *
   * `flames` é opcional: sem ela ficam só as manchas, que já carregam o efeito sozinhas. As
   * labaredas 3D entram como VOLUME por cima — sem elas o fogo é uma decalcomania bonita; com
   * elas, algo que ocupa espaço.
   */
  render(patches: readonly GroundFirePatch[], dt: number, flames?: FlamePort): void {
    const step = Math.max(0, dt);
    this.clock += step;
    let budget = FLAME_BUDGET;
    for (let i = 0; i < this.discs.length; i++) {
      const disc = this.discs[i]!, material = this.materials[i]!;
      const patch = patches[i];
      if (!patch) {disc.setEnabled(false); this.clocks[i] = 0; continue;}
      const life = Math.max(0, Math.min(1, patch.remaining / patch.duration));
      // A mancha encolhe e esfria junto com a poça: quem vê a marca murchar sabe que dá para passar.
      const radius = patch.radius * (.6 + life * .4);
      disc.setEnabled(true);
      material.setFloat('time', this.clock);
      // A vida entra com uma curva: a poça fica quente quase até o fim e some rápido no final,
      // em vez de esmaecer linearmente desde o primeiro segundo.
      material.setFloat('life', Math.min(1, life * 1.6));
      disc.rotationQuaternion = Quaternion.FromUnitVectorsToRef(
        Vector3.Forward(), this.scratch.copyFromFloats(patch.up.x, patch.up.y, patch.up.z), new Quaternion(),
      );
      // Meio palmo acima do chão: colado demais briga com o terreno, alto demais flutua.
      disc.position.set(
        patch.centre.x + patch.up.x * .06,
        patch.centre.y + patch.up.y * .06,
        patch.centre.z + patch.up.z * .06,
      );
      disc.scaling.setAll(radius);
      if (!flames || budget <= 0) continue;
      const clock = (this.clocks[i] ?? 0) - step;
      if (clock > 0) {this.clocks[i] = clock; continue;}
      this.clocks[i] = 1 / FLAMES_PER_SECOND;
      budget--;
      // Ponto sorteado dentro da mancha, erguido um palmo: a chama nasce DENTRO do fogo.
      const angle = this.clock * 2.1 + i * 2.399;
      const spread = radius * .6;
      flames.emit('fire', new Vector3(
        patch.centre.x + Math.cos(angle) * spread + patch.up.x * .4,
        patch.centre.y + Math.sin(angle * .7) * spread * .25 + patch.up.y * .4,
        patch.centre.z + Math.sin(angle) * spread + patch.up.z * .4,
      ), .6 + life * .5);
    }
  }

  clear(): void {
    for (const disc of this.discs) disc.setEnabled(false);
    this.clocks.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const disc of this.discs) disc.dispose();
    for (const material of this.materials) material.dispose();
    this.discs.length = 0;
    this.materials.length = 0;
  }
}

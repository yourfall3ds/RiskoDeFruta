import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { TrainingTarget } from './TrainingYard';
import { TEST_MAP_ENEMY_SPAWNS, TEST_MAP_PLAYER_SPAWNS, testMapCollision } from './TestMap';

/**
 * A APRESENTAÇÃO DO TEST MAP V1.0 — o laboratório de rede, desenhado em milissegundos.
 *
 * ## O que ele é
 *
 * Um chão com grade, quatro paredes, quatro marcas de assento e o anel onde o corpo de teste nasce.
 * Nada vem de arquivo: sem GLB, sem textura baixada, sem PBR, sem vegetação, sem cidade. Materiais
 * `StandardMaterial` compilam num piscar — o aquecimento de material que segurava a fazenda no fim
 * da barra não tem o que aquecer aqui.
 *
 * ## A regra que ele não pode quebrar
 *
 * Tudo o que se desenha aqui sai de `testMapCollision()` — a MESMA função com que o servidor
 * simula. O chão tem o tamanho da superfície de colisão; cada parede é uma caixa de colisão. Um
 * mapa de teste com um piso de um tamanho na tela e outro no servidor produziria exatamente os
 * defeitos que ele existe para achar, só que falsos.
 *
 * ## O que ele NÃO é
 *
 * Não é conteúdo. O que se prova nele é mecanismo de multiplayer; o jogo de verdade continua sendo
 * a fazenda.
 */
export class TestMapWorld {
  /** Sem alvos de treino: o que se acerta aqui é a horda replicada, como no jogo. */
  readonly targets: TrainingTarget[] = [];

  constructor(private readonly scene: Scene, readonly collision: CollisionWorld, private readonly shadows: ShadowGenerator) {
    const dados = testMapCollision();
    // A colisão da CENA recebe exatamente o que o servidor tem. Nada é inventado deste lado.
    this.collision.surfaces.push(...dados.surfaces);
    this.collision.boxes.push(...dados.boxes);

    const chao = this.flat('test-ground-mat', '#243034');
    chao.diffuseTexture = this.grade();
    for (const s of dados.surfaces) {
      const piso = CreateBox(s.id, { width: s.width, height: .2, depth: s.depth }, scene);
      piso.position.set(s.x, s.height - .1, s.z);
      piso.material = chao; piso.receiveShadows = true; piso.freezeWorldMatrix();
    }

    const parede = this.flat('test-wall-mat', '#b3663a');
    for (const b of dados.boxes) {
      const w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
      const muro = CreateBox(b.id, { width: w, height: h, depth: d }, scene);
      muro.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
      muro.material = parede; muro.receiveShadows = true; muro.freezeWorldMatrix();
      this.shadows.addShadowCaster(muro);
    }

    // Os assentos, marcados no chão: dá para ver na hora se alguém nasceu fora do lugar.
    TEST_MAP_PLAYER_SPAWNS.forEach((p, i) => this.marca(`P${i + 1}`, p.x, p.y, p.z, '#3fb6a8'));
    for (const e of TEST_MAP_ENEMY_SPAWNS) {
      const anel = CreateTorus('test-dummy-spawn', { diameter: 2.2, thickness: .08, tessellation: 48 }, scene);
      anel.position.set(e.x, e.y + .03, e.z);
      anel.material = this.flat('test-dummy-mat', '#d9a556', true); anel.isPickable = false; anel.freezeWorldMatrix();
    }
  }

  /** Material chapado e barato. `emissivo` para marcas que precisam aparecer mesmo na sombra. */
  private flat(nome: string, cor: string, emissivo = false): StandardMaterial {
    const m = new StandardMaterial(nome, this.scene);
    m.diffuseColor = Color3.FromHexString(cor);
    m.specularColor = Color3.Black();
    if (emissivo) m.emissiveColor = Color3.FromHexString(cor).scale(.6);
    return m;
  }

  /**
   * A grade do chão: uma linha a cada dois metros, desenhada num canvas — nenhum arquivo.
   *
   * Existe para o olho: num plano liso é impossível dizer se um boneco remoto está deslizando,
   * travando ou teleportando. Com linhas no chão, qualquer salto de posição aparece.
   */
  private grade(): DynamicTexture {
    const lado = 512, t = new DynamicTexture('test-grid', { width: lado, height: lado }, this.scene, true);
    const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = '#243034'; ctx.fillRect(0, 0, lado, lado);
    ctx.strokeStyle = '#3a4b50'; ctx.lineWidth = 2;
    const passo = lado / 8;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * passo, 0); ctx.lineTo(i * passo, lado); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * passo); ctx.lineTo(lado, i * passo); ctx.stroke();
    }
    t.update();
    // Oitenta metros de chão, oito células por repetição: uma linha a cada dois metros.
    t.uScale = 5; t.vScale = 5;
    return t;
  }

  /** Um disco no chão com o nome do assento escrito nele. */
  private marca(texto: string, x: number, y: number, z: number, cor: string): Mesh {
    const t = new DynamicTexture(`marca-${texto}`, { width: 128, height: 128 }, this.scene, false);
    t.hasAlpha = true;
    t.drawText(texto, null, 84, 'bold 64px sans-serif', cor, 'transparent', true);
    const m = new StandardMaterial(`marca-${texto}-mat`, this.scene);
    m.diffuseTexture = t; m.emissiveColor = Color3.FromHexString(cor).scale(.5); m.specularColor = Color3.Black();
    m.useAlphaFromDiffuseTexture = true;
    const disco = CreateDisc(`marca-${texto}`, { radius: .7, tessellation: 32 }, this.scene);
    disco.rotation.x = Math.PI / 2;
    disco.position.set(x, y + .02, z);
    disco.material = m; disco.isPickable = false; disco.freezeWorldMatrix();
    return disco;
  }
}

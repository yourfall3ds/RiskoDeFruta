import type {Vec3} from '../core/contracts';
import type {DestructionAudioPort} from './DestructionPorts';
import type {ImpactMaterial} from './DestructionModel';

/**
 * Som de destruição REAPROVEITANDO o banco que já existe.
 *
 * Nenhum arquivo novo de áudio é pedido. `foley-manifest.json` já traz cinco amostras de madeira,
 * cinco de concreto, cinco de grama e os grupos `impact`/`heavy` — que é exatamente o material de
 * caixa, pedra e folhagem batendo e abrindo. O que muda aqui é só o par (grupo, tom):
 *
 * | material  | bala batendo   | corpo abrindo            |
 * |-----------|----------------|--------------------------|
 * | `wood`    | `wood`, agudo  | `wood` grave + `impact`  |
 * | `stone`   | `concrete`     | `concrete` + `heavy`     |
 * | `foliage` | `grass`        | `grass` + `impact`       |
 *
 * O tom sobe conforme o corpo se aproxima da quebra: o mesmo clipe conta o progresso sem HUD.
 */

/** Superfície mínima do `WeaponAudio` usada aqui. Tipagem estrutural: o teste passa um duplo. */
export interface MaterialFoley {
  footstep(surface: 'grass' | 'wood' | 'concrete' | 'water', speed?: number): void;
  impact(heavy?: boolean): void;
}

const SURFACE: Readonly<Record<ImpactMaterial, 'grass' | 'wood' | 'concrete'>> = {
  wood: 'wood',
  stone: 'concrete',
  foliage: 'grass',
};

/**
 * Adaptador do `WeaponAudio` do jogo. O áudio do projeto não é posicional, então `point` é ignorado
 * de propósito — fingir pan a partir de uma posição de mundo sem ouvinte daria erro de direção.
 */
export function materialDestructionAudio(audio: MaterialFoley): DestructionAudioPort {
  return {
    impact(material: ImpactMaterial, _point: Vec3, strength: number): void {
      // Corpo quase quebrado soa mais agudo e seco: o tom é o medidor de vida.
      audio.footstep(SURFACE[material], 1 + Math.max(0, Math.min(1, strength)) * 1.6);
    },
    shatter(material: ImpactMaterial, _point: Vec3): void {
      audio.footstep(SURFACE[material], 0.2);
      audio.impact(material === 'stone');
    },
  };
}

/** Porta silenciosa, para teste e para o servidor. */
export const silentDestructionAudio: DestructionAudioPort = {impact(): void {}, shatter(): void {}};

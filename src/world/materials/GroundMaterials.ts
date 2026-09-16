import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {attachStochasticGround,stochasticGroundUvMismatch} from './StochasticGroundPlugin';

/**
 * Materiais de CHÃO que recebem a amostragem estocástica.
 *
 * Whitelist explícita, como pede a entrega do plugin: parede, porta, silo, telhado e prop precisam
 * do UV intacto, e o LOD distante não paga o custo das três leituras por mapa. Os nomes vêm de
 * `WORLD_MATERIAL_TINT` (mundo autorado) e do pátio de treino.
 */
export const STOCHASTIC_GROUND_MATERIALS:readonly string[]=['Sunlit farm track','Leaf litter soil','soil'];

/**
 * Instala o plugin nos materiais de chão da coleção.
 *
 * Deve ser chamado DENTRO do laço que já configura os materiais — antes do `freeze` que acontece no
 * primeiro render. Em WebGL1 ou WGSL o plugin devolve `null` e o material fica exatamente como
 * estava, então chamar aqui é sempre seguro.
 */
export function applyStochasticGround(materials:Iterable<unknown>):void {
  const whitelist=new Set(STOCHASTIC_GROUND_MATERIALS);
  for(const candidate of materials){
    if(!(candidate instanceof PBRMaterial)||!whitelist.has(candidate.name))continue;
    if(!attachStochasticGround(candidate))continue;
    // UV divergente faz o relevo descolar da cor; avisa em vez de entregar chão errado calado.
    const mismatch=stochasticGroundUvMismatch(candidate);
    if(mismatch.length)console.warn(`Chão estocástico: ${candidate.name} tem UV divergente em ${mismatch.join(', ')}`);
  }
}

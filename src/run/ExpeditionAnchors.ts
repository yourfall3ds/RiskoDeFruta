import {STAGE_BIOMES} from '../stages/StageRoute';
import type {TotemAnchor} from './ExpeditionObjectives';

/**
 * Âncoras candidatas do cálice, achatadas a partir das ilhas de `STAGE_BIOMES`.
 *
 * A lista deixou de ser autorada aqui: quem decide onde o cálice pode cair é a rota de estágios,
 * que também decide onde o jogador nasce. Manter duas listas separadas foi exatamente o que permitia
 * o cálice reaparecer no campo inicial enquanto a partida era fixa ali.
 *
 * Continua exportada para `planExpedition`, que é a seleção de MÚLTIPLOS marcos usada pelos testes
 * e pelos modos legados. A expedição em si usa `planStage`, que valida o par (partida, cálice).
 */
export const EXPEDITION_ANCHORS:readonly TotemAnchor[]=STAGE_BIOMES.flatMap(biome=>
  biome.islands.map(island=>({id:island.id,name:island.name,x:island.x,y:island.y,z:island.z})));

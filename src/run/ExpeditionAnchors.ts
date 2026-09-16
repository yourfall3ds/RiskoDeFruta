import {DISTRICT_CONTRACTS} from './DistrictContracts';
import type {TotemAnchor} from './ExpeditionObjectives';

/**
 * Âncoras candidatas dos marcos: campo inicial, pátio do celeiro e as praças de distrito já
 * existentes. `planExpedition` ordena por proximidade da partida e só aceita as que têm piso
 * largo, contínuo e com rota — por isso a lista pode ser maior que os quatro marcos usados.
 */
export const EXPEDITION_ANCHORS:readonly TotemAnchor[]=[
  {id:'initial-field',name:'Campo inicial',x:0,y:0,z:0},
  {id:'initial-west',name:'Posto oeste',x:-42,y:0,z:4},
  {id:'initial-east',name:'Lavoura leste',x:42,y:2,z:10},
  {id:'barn-yard',name:'Pátio do celeiro',x:0,y:5,z:29},
  ...DISTRICT_CONTRACTS.map(district=>({id:district.id,name:district.name,x:district.x,y:district.y,z:district.z})),
];

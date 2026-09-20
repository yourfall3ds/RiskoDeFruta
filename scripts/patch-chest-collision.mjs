import {readFileSync,writeFileSync} from 'node:fs';

/**
 * Devolve ao `farm-collision.json` os colisores dos cinco baús interativos.
 *
 * ## Por que isto existe separado do autor do mundo
 *
 * `build-farm-world.py` reconstrói o arquivo inteiro do zero, então TODA reconstrução apaga o que
 * não nasce do Blender — e os baús não nascem: eles são posicionados por `RunInteractables`, no
 * código do jogo. Foi exatamente o que aconteceu no plantio dos milharais: o mundo foi refeito e os
 * cinco colisores sumiram calados, porque nenhum teste os cobre.
 *
 * Esta é a mesma convenção de `patch-barn-collision.mjs`, que repõe o mobiliário do celeiro pelo
 * mesmo motivo. Rode os dois depois de cada `build-farm-world.py`.
 *
 * ## Por que NÃO é o `integrate-chests.mjs`
 *
 * Aquele é uma migração de código-fonte de uma vez só: ele reescreve `src/run/RunInteractables.ts`
 * e estoura se rodar duas vezes — na segunda ele reaplica o primeiro `edit()` (duplicando imports)
 * e só então lança, deixando a fonte quebrada. A linha 10 dele, que é a única parte que trata de
 * colisão, é a que mora aqui — e aqui ela é IDEMPOTENTE de propósito: filtra antes de inserir, e
 * rodar dez vezes dá o mesmo resultado de rodar uma.
 */

/** `[índice, x, z, y, éLoja]`. A loja é mais funda no eixo z: o balcão dela não é um baú. */
const CHESTS=[[0,-5,-13,0,false],[1,5,1,0,true],[3,7,29,5,false],[4,-45,3,0,false],[5,44,10,2,true]];

const path='public/models/farm-collision.json';
const world=JSON.parse(readFileSync(path,'utf8'));
world.boxes=world.boxes.filter(box=>!String(box.id).startsWith('interactive-chest'));
for(const [index,x,z,y,shop] of CHESTS){
  const half=shop?1.56:.43;
  world.boxes.push({id:'interactive-chest-'+index,min:{x:x-.53,y,z:z-half},max:{x:x+.53,y:y+.68,z:z+half}});
}
writeFileSync(path,JSON.stringify(world));
console.log(`baús repostos: ${CHESTS.length}; caixas no arquivo: ${world.boxes.length}`);

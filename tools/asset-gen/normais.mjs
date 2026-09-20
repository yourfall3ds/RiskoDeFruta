/**
 * normais.mjs - Gera normais por angulo de dobra ("crease angle").
 *
 * Por que isto existe:
 *   Os GLBs do Hunyuan3D saem SEM o atributo NORMAL. Sem ele o renderizador usa
 *   o normal geometrico da face - flat. Isso e correto para superficie plana
 *   (parede de celeiro) e errado para superficie curva (silo, tanque, caixa
 *   d'agua): cada faceta recebe um tom levemente diferente e a peca parece
 *   amassada, mesmo com a geometria perfeita. E defeito de ILUMINACAO, nao de
 *   malha.
 *
 *   Normal suave em tudo resolve a curva e estraga a quina: o telhado do celeiro
 *   perde a aresta e parece derretido.
 *
 * O criterio:
 *   Duas faces vizinhas so compartilham normal se o angulo entre elas for menor
 *   que o limite. Abaixo do limite e considerado "mesma superficie" e suaviza;
 *   acima e considerado aresta e mantem separado. 40 graus separa bem o costado
 *   de um cilindro (facetas de poucos graus entre si) de uma quina de telhado.
 *
 * Custo: so os vertices EM cima de arestas sao duplicados. Suavizar tudo sem
 * criterio, ou desindexar para flat, multiplicaria a malha inteira.
 */

const CHAVE = 1e4; // arredondamento da posicao ao agrupar vertices coincidentes

function chavePos(x, y, z) {
  return `${Math.round(x * CHAVE)},${Math.round(y * CHAVE)},${Math.round(z * CHAVE)}`;
}

/**
 * @param {import('@gltf-transform/core').Document} document
 * @param {number} anguloGraus limite de dobra; acima disso vira aresta viva
 * @returns {{primitivas: number, verticesAntes: number, verticesDepois: number}}
 */
export function gerarNormaisPorAngulo(document, anguloGraus = 40) {
  const limite = Math.cos((anguloGraus * Math.PI) / 180);
  let primitivas = 0;
  let antes = 0;
  let depois = 0;

  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION');
      const idxAcc = prim.getIndices();
      if (!posAcc || !idxAcc) continue;

      const pos = posAcc.getArray();
      const idx = idxAcc.getArray();
      const nVerts = posAcc.getCount();
      const nFaces = idx.length / 3;
      antes += nVerts;

      // 1. Normal de cada face, com magnitude = 2x area. Nao normalizamos ainda:
      //    a magnitude serve de peso, para face grande influir mais que sliver.
      const fnx = new Float64Array(nFaces);
      const fny = new Float64Array(nFaces);
      const fnz = new Float64Array(nFaces);
      for (let f = 0; f < nFaces; f++) {
        const a = idx[f * 3] * 3;
        const b = idx[f * 3 + 1] * 3;
        const c = idx[f * 3 + 2] * 3;
        const e1x = pos[b] - pos[a];
        const e1y = pos[b + 1] - pos[a + 1];
        const e1z = pos[b + 2] - pos[a + 2];
        const e2x = pos[c] - pos[a];
        const e2y = pos[c + 1] - pos[a + 1];
        const e2z = pos[c + 2] - pos[a + 2];
        fnx[f] = e1y * e2z - e1z * e2y;
        fny[f] = e1z * e2x - e1x * e2z;
        fnz[f] = e1x * e2y - e1y * e2x;
      }

      // 2. Quais faces tocam cada posicao no espaco. Agrupamos por POSICAO e nao
      //    por indice: o unwrap de UV ja duplicou vertices na costura, e eles
      //    precisam suavizar juntos, senao a costura vira uma linha visivel.
      const porPos = new Map();
      for (let f = 0; f < nFaces; f++) {
        for (let k = 0; k < 3; k++) {
          const v = idx[f * 3 + k];
          const ch = chavePos(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
          let lista = porPos.get(ch);
          if (!lista) porPos.set(ch, (lista = []));
          lista.push(f);
        }
      }

      // 3. Para cada canto de face, soma as faces vizinhas cuja inclinacao esta
      //    dentro do limite. Vertice sobre aresta viva recebe normais distintos
      //    de cada lado - e por isso pode precisar ser duplicado.
      const normalCanto = new Float32Array(nFaces * 3 * 3);
      for (let f = 0; f < nFaces; f++) {
        const lf = Math.hypot(fnx[f], fny[f], fnz[f]) || 1;
        const ux = fnx[f] / lf;
        const uy = fny[f] / lf;
        const uz = fnz[f] / lf;

        for (let k = 0; k < 3; k++) {
          const v = idx[f * 3 + k];
          const vizinhas = porPos.get(
            chavePos(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]),
          );

          let sx = 0;
          let sy = 0;
          let sz = 0;
          for (const g of vizinhas) {
            const lg = Math.hypot(fnx[g], fny[g], fnz[g]) || 1;
            const cos = (ux * fnx[g] + uy * fny[g] + uz * fnz[g]) / lg;
            if (cos >= limite) {
              sx += fnx[g];
              sy += fny[g];
              sz += fnz[g];
            }
          }
          const ls = Math.hypot(sx, sy, sz) || 1;
          const base = (f * 3 + k) * 3;
          normalCanto[base] = sx / ls;
          normalCanto[base + 1] = sy / ls;
          normalCanto[base + 2] = sz / ls;
        }
      }

      // 4. Reconstroi a lista de vertices. Um vertice original vira varios so se
      //    aparecer com normais diferentes - ou seja, so nas arestas vivas.
      const mapa = new Map(); // "indiceOriginal|normalArredondado" -> novo indice
      const origemDe = [];
      const normaisNovas = [];
      const idxNovo = new Uint32Array(idx.length);

      for (let f = 0; f < nFaces; f++) {
        for (let k = 0; k < 3; k++) {
          const v = idx[f * 3 + k];
          const base = (f * 3 + k) * 3;
          const nx = normalCanto[base];
          const ny = normalCanto[base + 1];
          const nz = normalCanto[base + 2];
          const ch = `${v}|${Math.round(nx * 500)},${Math.round(ny * 500)},${Math.round(nz * 500)}`;

          let novo = mapa.get(ch);
          if (novo === undefined) {
            novo = origemDe.length;
            mapa.set(ch, novo);
            origemDe.push(v);
            normaisNovas.push(nx, ny, nz);
          }
          idxNovo[f * 3 + k] = novo;
        }
      }

      // 5. Reescreve todos os atributos seguindo a nova lista, para POSITION,
      //    TEXCOORD e o que mais existir continuarem alinhados aos indices.
      for (const semantica of prim.listSemantics()) {
        const acc = prim.getAttribute(semantica);
        const largura = acc.getElementSize();
        const antigo = acc.getArray();
        const novoArr = new antigo.constructor(origemDe.length * largura);
        for (let i = 0; i < origemDe.length; i++) {
          const o = origemDe[i] * largura;
          for (let c = 0; c < largura; c++) novoArr[i * largura + c] = antigo[o + c];
        }
        acc.setArray(novoArr);
      }

      prim.setAttribute(
        'NORMAL',
        document.createAccessor().setType('VEC3').setArray(new Float32Array(normaisNovas)),
      );
      idxAcc.setArray(idxNovo);

      depois += origemDe.length;
      primitivas++;
    }
  }

  return { primitivas, verticesAntes: antes, verticesDepois: depois };
}

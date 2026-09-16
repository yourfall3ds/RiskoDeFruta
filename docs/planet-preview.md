# Expedição esférica

Abra `/?mode=planet`. A cena é uma prévia separada; a rota normal mantém o jogo anterior enquanto a migração é validada.

## Mundo e física

- 14 ilhas distribuídas sobre uma esfera de referência de 200 m de raio, ligadas por 24 pontes em arcos. Existem caminhos pelos dois hemisférios e ciclos no grafo de ilhas.
- A gravidade aponta para o centro do mundo. A cápsula, os saltos, as inclinações e a câmera usam a vertical local, que muda durante o percurso.
- As ilhas formam uma casca aberta. Não existe uma esfera sólida invisível servindo de chão nos vãos.
- A colisão usa os triângulos dos mesmos assets curvos renderizados. O retorno de uma queda busca apoio e espaço livre para o personagem.
- A entrada reutiliza a plataforma da nave, corrida, salto, mergulho e recuperação do personagem, orientados pela vertical local da ilha.

## Autoria

`scripts/build-planet-archipelago.py` reaproveita os cenários GLB do projeto e módulos reais de piso/cerca Quaternius. O Blender subdivide faces grandes e curva os vértices no espaço da esfera, preservando os materiais. O perfil das pontes sonda o terreno nas entradas para evitar que o tabuleiro termine enterrado. Props pequenos que bloqueiam essas entradas são omitidos inteiros.

Saídas de runtime: `public/models/planet-archipelago.glb` e `planet-archipelago.json.gz`. O JSON sem compressão e o arquivo Blender são intermediários locais. Texturas são reencodificadas em até 1024 px, a geometria visual usa Draco, e a colisão preserva suas coordenadas sem quantização Draco.

Fontes e licenças em `ASSET_LICENSES.md` e `licenses/planet-bridges.txt`. O decodificador Draco está incluído localmente, com licença própria.

Árvores e rochas do kit de natureza preservam a malha original: a simplificação de folhagem não pode ser aplicada ao objeto inteiro quando o tronco compartilha a malha com as folhas. Props de arquivos que agregam várias construções são separados por componentes e proximidade antes da seleção da ilha.

## Destruição do cenário

O manifesto versão 2 identifica caixas, barris, árvores, rochas soltas e peças de construções por nó visual e intervalo de triângulos. Tiros e especiais causam dano progressivo, marcas e quebra; os triângulos destruídos deixam de bloquear o jogador e os disparos sem reconstruir a BVH. O dano em cenário não carrega MP. O reinício restaura objetos e colisão.

Terreno, piso das pontes e escadas de acesso ficam fora da lista de destrutíveis. Esta implementação pertence ao modo planeta; a cena plana anterior ainda não oferece a mesma destruição. O número de fragmentos e seu tempo de vida são limitados.

## Verificação reproduzível

```sh
npx tsx scripts/audit-planet-assets.ts
npx tsx scripts/audit-planet-traversal.ts
npx tsx scripts/audit-planet-destructibles.ts
npx vitest run planet
npx tsc --noEmit
npm run build
```

As auditorias de assets e travessia carregam o manifesto de produção comprimido, constroem sua BVH e simulam o motor real. A primeira verifica apoio nas ilhas e ao longo das pontes; a segunda percorre cada ponte nos dois sentidos e verifica parada, salto e recuperação nos seis eixos cardeais. Os relatórios são `planet-asset-audit.json` e `planet-traversal-audit.json`.

F2 abre a verificação visual: órbita, visita das ilhas e teste de queda. Esses comandos são de QA e não contam como prova de uma volta percorrida pelo jogador.

## Limites da prévia

A física radial e a cena nova não tornam automaticamente esféricos todos os sistemas antigos que assumem chão horizontal. O combate e a progressão básicos são adaptados separadamente. A prévia não representa paridade completa de habilidades, combate desarmado, clima, animações cinematográficas e multiplayer com a cena anterior.

# Licenças e origem — `src/world/materials/StochasticGroundPlugin.ts`

## O que foi escrito aqui

Todo o GLSL do plugin foi escrito neste repositório. **Nenhuma linha foi copiada** dos projetos
listados abaixo. O que é compartilhado é a *matemática publicada* do algoritmo — a decomposição do
plano numa grade triangular e a mistura que preserva a variância — e as constantes dessa geometria
(`2·√3`, `1/√3`, `2/√3`, `√3/2`, `1/(2·√3)`), que são propriedades da rede triangular e não escolha
de autor. O teste `tests/stochastic-ground.test.ts` confere essas constantes contra `Math.sqrt(3)`
justamente para deixar isso explícito.

## Algoritmo (referência acadêmica)

- Eric Heitz e Fabrice Neyret, *High-Performance By-Example Noise using a Histogram-Preserving
  Blending Operator*, HPG 2018. Origem da grade triangular com três pesos baricêntricos e da ideia
  de recuperar o contraste perdido pela média ponderada.
- Fabrice Neyret, *Tile breaking* — Shadertoy `MdyfDV`. Variante prática do mesmo esquema.

O plugin usa a aproximação barata do operador: em vez do histograma invertido em LUT, recompõe o
desvio padrão em volta da média da textura (`mean + (avg − mean) / √(Σw²)`), lendo a média do último
nível de mip. É por isso que o DELIVERY diz que o resultado é *próximo*, não idêntico, ao artigo.

## Código consultado, não copiado

- `.tools/references/three-hex-tiling`, commit `b27c1107495eb5c85d5ceab4ea3cb6d03fe2e1bb`.
  **MIT**, © 2023-2024 Casey Primozic and others. Lido apenas para entender o encaixe da variante
  Neyret num material existente. É código para Three.js e não entrou no projeto de nenhuma forma;
  as instruções de projeto daquele repositório não se aplicam aqui.
- `@babylonjs/core` 9.25.0, **Apache-2.0**. O Babylon já traz uma implementação própria do mesmo
  algoritmo em `Shaders/ShadersInclude/textureRepetitionFunctions` (`material.textureRepetitionMode`
  = `TEXTURE_REPETITION_HEX_TILING`). Foi lida como referência de encaixe e **não** é usada pelo
  plugin — ver "Por que não usar o modo nativo" no DELIVERY.

Nenhuma dependência nova foi instalada e nenhum repositório novo foi clonado por conta deste
trabalho.

## Texturas

As texturas usadas pela fixture (`public/textures/brown_mud_02`, `brown_mud_leaves_01`,
`rock_face_03`) já pertenciam ao projeto; este trabalho não adicionou, converteu nem redistribuiu
nenhuma delas.

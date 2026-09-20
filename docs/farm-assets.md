# Assets de fazenda — origem, licença e custo

Seis modelos da Sketchfab, todos **CC Attribution (CC-BY 4.0)**, baixados com a API e reempacotados
por `scripts/build-farm-assets.py` em GLB único com textura JPEG embutida. O relatório completo da
última construção (triângulos, malhas removidas, texturas reamostradas) fica em
`docs/farm-assets.json`.

Nenhum destes é low-poly, KayKit, Quaternius ou procedural: todos vêm com textura PBR real
(baseColor + normal + metallicRoughness, salvo onde indicado).

Reconstruir tudo:

```
<blender> -b -P scripts/build-farm-assets.py -- <pasta-dos-downloads>
```

ou só um: acrescente `farm-corn,farm-flowers` como segundo argumento.

## Inventário

| Arquivo | Triângulos | Tamanho | Draw calls | Animações |
|---|---:|---:|---:|---|
| `farm-crow.glb` | 2 208 | 2,31 MB | 1 | 1 — `root\|TakeOff` |
| `farm-chicken.glb` | 7 305 | 3,43 MB | 1 | 20 — inclui `idle01`, `walk01`, `run01`, `peck_idle2`, `flap`, `chicken_scared01` |
| `farm-bird.glb` | 2 145 | 0,46 MB | 1 | 6 — `AA_Sparrow_Fly`, `Sparrow_Jump`, `Sparrow_Look`, `Sparrow_Shake`, `Sparrow_Bite`, `Sparrow_JumpSpeed` |
| `farm-scarecrow.glb` | 29 999 | 2,93 MB | 2 | nenhuma (estático) |
| `farm-corn.glb` | 3 108 | 0,60 MB | 3 | nenhuma (estático) |
| `farm-flowers.glb` | 11 502 | 1,13 MB | 9 (9 variantes) | nenhuma (estático) |

**Total: 10,87 MB.** Nenhum modelo passa de 30 k triângulos.

Os clipes do pardal chegam com o prefixo `SKM_Sparrow|SKM_Sparrow|SKM_Sparrow|` no nome — é como o
exportador original nomeou, e não foi renomeado aqui para não divergir do arquivo de origem.

## Crédito CC-BY

| Arquivo | Modelo | Autor | UID |
|---|---|---|---|
| `farm-crow.glb` | [Crow](https://sketchfab.com/3d-models/crow-d5a9b0df4da3493688b63ce42c8a83e2) | [Alexei Ostapenko](https://sketchfab.com/alexanders823) | `d5a9b0df4da3493688b63ce42c8a83e2` |
| `farm-chicken.glb` | [ANIMAL & FOOD \| Chicken Model (CS2)](https://sketchfab.com/3d-models/animal-food-chicken-model-cs2-7c72450ac7e0472eb9b647b6efee2984) | [gettan](https://sketchfab.com/kill6lucius) | `7c72450ac7e0472eb9b647b6efee2984` |
| `farm-bird.glb` | [Animated Sparrow – 3D Animal Model](https://sketchfab.com/3d-models/animated-sparrow-3d-animal-model-026d23b0c0954f328694cb339ade4045) | [AnimalMesh 3D](https://sketchfab.com/AnimalMesh3D) | `026d23b0c0954f328694cb339ade4045` |
| `farm-scarecrow.glb` | [Scarecrow](https://sketchfab.com/3d-models/scarecrow-bb672e5996254111a7d2e93ed01b5e0c) | [Glowbox 3D](https://sketchfab.com/glowbox3d) | `bb672e5996254111a7d2e93ed01b5e0c` |
| `farm-corn.glb` | [Maize Corn Plant](https://sketchfab.com/3d-models/maize-corn-plant-5fd3b104d8104519b061469c365d4974) | [gilles.schaeck](https://sketchfab.com/gilles.schaeck) | `5fd3b104d8104519b061469c365d4974` |
| `farm-flowers.glb` | [Daisy models pack (realistic, optimized)](https://sketchfab.com/3d-models/daisy-models-pack-realistic-optimized-0748471f99f2416a8b66b522c293720f) | [LOLIPOP](https://sketchfab.com/lolipop_1707) | `0748471f99f2416a8b66b522c293720f` |

Todos sob [CC Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). A licença exige que o
crédito acima apareça no jogo (tela de créditos), junto com o dos aliens em `docs/ASSET_LICENSES.md`.

Observação sobre o espantalho: a página do Glowbox 3D marca **NoAI** — o modelo não pode ser usado
para treinar modelos de IA. Usá-lo como asset de jogo, que é o caso aqui, continua permitido pela
CC-BY.

## O que o empacotador mexeu, e por quê

A lei herdada de `scripts/build-menu-aliens.py`: **em modelo com esqueleto o Blender só empacota.**
Lá ficou provado que reparentear ou reescalar um rig do Sketchfab mantém os clipes no arquivo, com
os nomes certos, e mesmo assim para de mover a malha. Então corvo, galinha e pardal saíram
intactos — nada de juntar malha, decimar ou normalizar altura. Quem normaliza é o Babylon.

Sem esqueleto não há esse risco, e o custo de runtime é real:

- **milho** — vinha como 42 objetos soltos. Instanciado às centenas seriam 42 draw calls por pé;
  juntar em uma malha derrubou para 3 (um por material). Os `EMPTY` que seguravam cada peça foram
  removidos: sem esqueleto não animam nada, mas virariam `TransformNode` vezes o número de
  instâncias. 3 108 triângulos — é o mais leve do conjunto, como o uso pede.
- **flores** — o pacote traz 9 touceiras *enfileiradas lado a lado* em ~7 m, cada uma em
  LOD0/LOD1/LOD2 mais um plano de billboard. Ficaram só os LOD0, e elas **não** foram juntadas: o
  jogo quer escolher UMA touceira e plantá-la, não a fileira inteira. Cada uma foi recentrada na
  própria origem (X/Y no centro, Z assentado na base), então qualquer uma das 9 já nasce pronta
  para posicionar no terreno.
- **espantalho** — 46 917 triângulos, acima do teto de 40 k. Decimado para 29 999.

Remoções pontuais:

- a esfera `Icosphere` de preview que a Sketchfab injeta em todo `.gltf`, em todos os modelos;
- na galinha, a malha `Object_63` e o rig de 2 ossos que a acompanha: é o **frango assado**, prop de
  comida do CS2, não a galinha viva. Tirou 4 238 triângulos e um conjunto inteiro de texturas.

Texturas foram reamostradas antes de sair em JPEG (qualidade 82): 1024 px para corvo, galinha,
pardal e espantalho; 512 px para milho e flores. O corvo vinha com três mapas de 2048 px — não se
justifica num pássaro que ocupa poucos pixels na tela.

## Candidatos descartados

- `2275a2c6f6d742d6bf189a3575323699` — *Crow All animation Little Nightmares 2*, 6 192 tris e dois
  clipes bons (idle e fly-off), mas as texturas são de **128×128**. Perde feio para o escolhido.
- `c20ccdf59048422da1929f0faa87933e` — *Straw Scarecrow*, 10 142 tris e animado, porém só tem
  baseColor: sem normal nem roughness fica chapado ao lado do Glowbox.
- `27587d3c71ad46518cad2cdf245aa35e` — *Sparrow Raven*, rip do Paragon (Unreal); o próprio autor diz
  que as texturas foram simplificadas e que as penas ignoram a máscara.

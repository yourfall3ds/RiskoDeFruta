# Arte gerada integrada ao jogo

Modo: ferramenta integrada `image_gen`, sem API/CLI, sem chave e sem Meshy. Os resultados selecionados foram copiados para o projeto. As referências do usuário orientaram a composição do cenário; não são usadas como uma imagem cobrindo o jogo.

## Queda d’água

Destino: `public/environment/waterfall.png`. PNG com alpha preservado, aplicado em cortinas 3D com fluxo e silhueta independente. Original: `exec-08edf3a5-07d2-4f7f-87a8-71782ecbfdb0.png` na pasta generated_images desta tarefa.

Prompt:

> Create a production videogame VFX texture: a single tall narrow natural waterfall curtain, photorealistic white foamy water cascading vertically downward, parallel streaks and a few separate wispy strands, soft mist at lower end. Transparent alpha background, no rocks, no scenery, no pool, no typography, no border. Water begins at top edge with several narrower rivulets, merges into foamy white and pale blue streams center, separates into fading wispy spray at bottom. Straight frontal orthographic view. Texture image portrait 1:2, isolated waterfall filling central 75% of width, edges feathered all the way to transparency. Usable as a transparent textured waterfall plane in a realistic floating farm videogame.

## Revisão do céu

Alvo da edição: `public/environment/cosmic-sky.png`. Destino: `public/environment/cosmic-sky-v2.png`. Original novo: `exec-f627084b-0cf8-42dc-a621-4d3079c7739f.png`.

Prompt:

> Edit this equirectangular 360 degree sky texture, preserve its 2:1 image proportions and cloud deck with no ground. Reduce the left planet to 45 percent of its present diameter and place its center at exactly 20 percent image width and 32 percent image height. Replace its old surrounding area seamlessly with rich cobalt blue sky. Add a vivid violet-magenta branching cosmic nebula just RIGHT of that planet at x=38 percent of image width, from y=15 percent to y=42 percent; its bright delicate purple filaments should be prominent, avoiding overpowering pure white. Remove the old faint nebula on the far right. Keep atmospheric cumulus clouds and blue sky wrapping evenly at the horizon at y=55 percent. The planet and new nebula should both fit in the image region between 12 and 45 percent image width, suitable for appearing together within one 90 degree gameplay view. No objects, no islands, no text. Photorealistic science fantasy afternoon sky, saturated but natural, crisp details, soft atmospheric depth.

## Madeira pintada do celeiro

Alvo da edição: `public/textures/wood_planks/Diffuse.jpg`, mapa CC0 da Poly Haven. Destino: `public/textures/barn-red.png`, também incorporado ao GLB final. Original: `exec-02249fc4-b858-4903-afdd-ae01dc24456c.png`.

Prompt:

> Edit this wood plank diffuse texture into an authentic weathered red painted American barn wood texture. Preserve exactly the plank seams, cracks, wood grain, dimensions, scale and all UV layout features. Add matte iron oxide vermilion RED paint over the boards, chipped along edges and worn on raised grain to show small areas of the original brown wood. Main board surfaces must be strongly red, not dark brown or orange. Photorealistic PBR base color texture with even flat lighting, no cast shadows or artificial highlights. No logos, no writing, no objects, no framing. Tileable square texture. Rich farmhouse red and realistic fine wear.

## Variantes do roster

Alvo: atlas de pele extraído do personagem berinjela fornecido, inspecionado como `art/eggplant-skin.jpg`. Destinos: `public/textures/mutant-skins/green.png` e `banana.png`, incorporados aos modelos de brócolis/alface/banana. Originais: `exec-fba4196d-df66-40da-8c71-0463ebf4d8fd.png` e `exec-e5d8a92f-3564-4a68-b74f-ea168b6f02ea.png`.

Resumo registrado da orientação de edição: preservar todas as ilhas UV, olhos, boca, folhas e detalhes da pele; substituir o roxo por verde botânico nas duas variantes folhosas e por amarelo dourado com marcas naturais na banana. Os modelos reutilizam a malha e o rig fornecidos e recebem copas/crestas criadas no Blender; a recoloração não equivale a uma nova anatomia completa.

## Superfície de brócolis

Destino: `public/textures/mutant-skins/broccoli-crown.png`, incorporado aos GLBs. Original: `exec-386f96d0-be66-4fa3-8970-fc26bfc2ec37.png`. A textura substitui madeira tingida nas copas. A emissão indevida do atlas antigo foi removida dos materiais orgânicos no Blender.

Prompt:

> Create a seamless tileable PBR base-color texture ONLY, square, very high detail, photorealistic close-up surface of a fresh dark green broccoli crown: dense tiny rounded branching broccoli buds, irregular clustered florets, rich natural olive green, emerald and subtle yellow-green tips. Even neutral diffuse illumination, NO directional cast shadows, NO glossy highlights, NO depth of field, NO background, NO stems, NO whole broccoli silhouette, NO faces, NO labels, NO borders. Entire image is continuously filled with tightly packed organic micro florets. Suitable as a physically based 3D texture wrapped on bulbous broccoli monster crowns. Natural organic texture, not stone or wood. Seamlessly repeating on all four edges.

## Copas de árvores

Destino: `public/textures/leaf-canopy.png` (1536 × 1024 RGBA), incorporado ao cenário final. Original: `exec-ba18a879-fb46-48c4-bb96-49fa193fcf27.png`. Alpha inspecionado; fundo transparente. Três grupos de planos cruzados por árvore completam os troncos e galhos 3D existentes. A antiga geometria de folhas foi removida, preservando a madeira do scan.

Prompt:

> Create one photorealistic 3D game foliage texture card on a fully transparent alpha background. A broad irregular dense cluster of healthy small deciduous oak leaves with a few fine woody twigs, roughly oval cloud shape, organically broken outline with many small detailed leaves and natural transparent gaps. Real miniature leaf detail, varied fresh olive green, medium moss green and some golden yellow tips, brighter sunlit leaves at the top right, subtle soft ambient shading inside, no black silhouette. Three large connected leafy lobes, slightly drooping edges. Front-facing botanical cutout, entirely contained with transparent margins on all sides. NO full tree trunk, NO ground, NO pot, NO landscape, NO writing, NO border, NO white or colored background, NO blur. This will be placed as crossed alpha-tested planes inside the existing 3D branch canopy of farm trees, so show ONLY the foliage cluster and tiny branches, as a crisp detailed cutout suitable for a realistic farming action game.

## Atmosfera final do céu

Nova edição do panorama anterior; o destino de runtime `public/environment/cosmic-sky-v2.png` foi atualizado. Original final: `exec-c3012816-a48d-41db-bdd4-e0e5cc5c1da9.png`. A versão intermediária permanece no original gerado indicado na seção anterior.

> Edit this 2:1 equirectangular fantasy sky texture, preserving the planet's exact size and position, the nebula position and seamless left-right wrap. Improve the atmospheric realism for a floating-islands farm game: replace the low flat horizon with monumental white and blue cumulus cloud towers rising much higher into the sky, especially across the LEFT HALF from x=5% to x=48%, with irregular cloud peaks reaching y=38% of image height and broad billowing bodies down to y=62%. Leave the planet and upper part of the nebula unobstructed. Show rich soft volumetric forms, luminous warm ivory edges and natural cool lavender shadows, clear separation between cloud layers, like aerial photography above a huge bank of thunderclouds at late afternoon. Reduce the density of tiny bright stars by about 80%, keeping only fine subtle sparse stars. Make the blue sky slightly less electrically saturated, more cinematic natural deep blue-indigo. Preserve the lower cloud ocean. ONLY sky, NO land, NO islands, NO structures, NO vegetation, NO HUD or text. Crisp high-detail production environment texture.

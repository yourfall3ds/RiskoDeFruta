# Pistola, empunhadura e inimigos — 06/09/2026

## Arma fornecida

Origem: `C:/Users/lucas/Downloads/Meshy_AI_gunslinger_pistol_0906182618_image-to-3d-texture.glb` (original preservado).

- Original: 106.524.168 bytes e 1.977.448 triângulos.
- Exportação: `public/models/pistol.glb`, 6.728.048 bytes e 40.000 triângulos, mapas PBR 2K preservados. Comprimento aproximado: 42 cm.
- Duas cópias compartilham geometria e materiais no jogo. As armas simples foram removidas.
- `Pistol_Inspection.blend` conserva a geometria reduzida em coordenadas originais; `Pistol_GameReady.blend` contém a origem no cabo e o eixo do cano calibrado.

## Correção da mão

O close `art/blender/grip-before.png` revelou que o encaixe anterior usava o punho, deixando os dedos abaixo do cabo. A malha já tem dedos curvados, mas não possui ossos individuais para cada dedo.

`scripts/fit-grip.py` calcula a região da luva na pose Aim e cria `RightWeaponGrip` / `LeftWeaponGrip`, filhos dos ossos das mãos. A arma passa a herdar o movimento do rig, sem reposicionamento independente durante recuo e esquiva. O GLB do personagem inclui esses pontos de encaixe.

Revisão montada: `art/blender/Gunslinger_Armed.blend`; close: `art/blender/grip-fitted.png`. Não foram adicionados ossos individuais aos dedos nem animação independente do indicador nesta revisão.

## Disparos

Clarão texturizado e luz breve no cano, rastros curtos com deslocamento visual, faíscas só em superfícies atingidas e som sintetizado com ataque de ruído/transiente, corpo grave e confirmação de acerto. O dano continua hitscan; rastros são apenas apresentação. Pool limitado a 128 elementos, oito sprites de clarão e vozes de áudio limitadas. Áudio ainda é síntese local de iteração.

## Inimigos inspecionados

| Asset | Resultado |
| --- | --- |
| Cenoura | Rig, texturas e Run/Walk/Hit/Death válidos; 1.984.312 bytes no GLB preparado |
| Milho | Rig, texturas e Run/Walk/Hit/Death válidos; 2.173.904 bytes |
| Berinjela | Rig, texturas e Run/Walk/Hit/Death válidos; 1.587.156 bytes |
| `Meshy_AI_Character_output.glb` | Identificado visualmente como tomate alado; sem clipes de animação |
| `melancia-Meshy_AI_Character_output (1).glb` | Melancia quadrúpede; sem clipes de animação |

As três espécies rigadas estão no campo como espécimes de treino, com 96 HP, reação de acerto, queda e retorno após oito segundos. Isso permite conferir arma/dano/animações, mas não implementa a IA ou os ataques finais das espécies. O clipe genérico de golpe de espada não foi usado. Tomate e melancia foram inspecionados e permanecem fora da cena até preparar suas animações.

Revisões: `art/blender/Enemy_Review.blend`, `enemy-review.png`, `enemy-extra-review.png`.

## Validação

39 testes em seis arquivos aprovados; typecheck e build aprovados. Cobertura adicional: nós de encaixe filhos das mãos, limite de tamanho/triângulos da arma, skins e clipes dos três inimigos, dano inválido/ID incorreto, emissão única de morte e reset de treino. Testes existentes mantêm perfuração, obstáculos, MP e câmera. Navegador: arma montada visível e dano no milho confirmado (96 → 84 HP).

Bundle principal: aproximadamente 1.913 kB / 473 kB gzip. Aviso de tamanho do Vite permanece; não é benchmark de hordas.

Ordem do pipeline: `prepare-character.mjs` → `blender-character.py` → `blender-combat-poses.py` → `prepare-pistol.py` → `export-pistol.py` → `fit-grip.py`. Para cada inimigo: `prepare-character.mjs carrot|corn|eggplant`, depois `prepare-enemies.py`. Reexportar apenas o personagem base remove os sockets; a etapa de fit deve ser executada novamente.

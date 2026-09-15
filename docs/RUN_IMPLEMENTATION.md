> HISTÓRICO de 06/09, anterior à restauração dos cinco inimigos e aos baús aleatórios. O estado vigente, validações e limitações estão em [CURRENT_IMPLEMENTATION.md](CURRENT_IMPLEMENTATION.md). Limites de população, roster, áudio e escolhas abaixo descrevem a versão antiga.

# Rodada jogável — 06/09/2026

A cena padrão agora executa uma rodada: nascimento em posição aleatória, combate, créditos, XP, níveis, compras, combinações de itens, pressão crescente, Praga Alfa e passagem para o próximo estágio. `?mode=training` preserva a bancada anterior e `?mode=foundation` preserva os testes de fundação.

## Sistemas integrados

- Sete espécies comuns: brócolis, banana, milho, melancia, tomate voador, alface e cenoura. Comportamentos/receitas de ataque em `src/enemies/EnemyBehaviors.ts`; estados, navegação, vida e apresentação são coordenados pelo swarm.
- Avisos circulares, corredor de investida e cone do chefe; rajadas e leques com projéteis físicos; saltos, investidas, mordidas, mergulho, raízes emergentes e áreas temporárias de fogo/ácido.
- Busca de caminho compartilhada por campo reverso, respeitando os pisos e as caixas de colisão. IA escalonada por distância. Paletas de ossos sincronizadas somente quando a pose avança; um teste compara o resultado com o caminho original do Babylon e verifica a reutilização em 60 preparações consecutivas. Os trabalhos de criaturas mortas são removidos do scheduler.
- Director com orçamento contínuo e cinco estados de pressão. O tempo garante acesso ao chefe mesmo sem abates. A horda cheia não bloqueia a chegada do chefe: uma criatura distante cede a vaga, sem recompensa falsa.
- Praga Alfa composta por várias frutas, com cinco receitas de ataque, invocações por frutos balísticos, reação a dano, queda e abertura da fenda após cinco segundos.
- Doze itens empilháveis: dano, cadência, movimento, esquiva, salto, crítica, regeneração, armadura, queimadura, cura por abate, explosão e MP. Procs respeitam coeficiente e não recursam sobre o dano secundário. RNG próprio para procs.
- Seis pontos de interação, incluindo as duas ilhas laterais: caixas, mercados de três ofertas e altar com chance/custo visíveis. Itens permanecem entre estágios; créditos restantes viram XP.
- Pistolas presas aos encaixes das palmas; salto ascendente/descendente e backflip com poses novas exportadas do Blender. A câmera acompanha a cápsula durante o mortal.
- HUD de tempo, dificuldade, objetivo, orientação, vida, XP, nível, hostis, créditos, itens, preços e chefe. Pausa, resumo de derrota, mesma/nova expedição, volume e música.
- Áudio local de tiros, impactos, carga, progressão e harmonia original discreta. Sem serviço externo durante a rodada.

## Ambiente

Quatro ilhas jogáveis (principal, celeiro e dois postos laterais), pontes com sag e colisão contínua, ilhas distantes, cachoeiras com textura e fluxo animado, canteiros, frutos, caixotes, barris, regadores, tratores, placas, arco rochoso e insígnia agrícola. Materiais de arquitetura e scans CC0; frutas/personagens derivados dos arquivos fornecidos. As cópias dos arquivos originais não foram alteradas.

As copas de brócolis usam textura orgânica própria, com normais suavizadas. A emissão indevida do atlas antigo foi removida dos personagens inimigos, corrigindo a pele roxa e a iluminação achatada. O arco de entrada usa pedras texturizadas próprias, agrupadas em uma malha para reduzir chamadas de desenho.

As quinze árvores preservam troncos e galhos tridimensionais e receberam copas com planos cruzados, textura RGBA própria e recorte por alpha. A folhagem antiga foi removida para reduzir geometria.

O céu foi recomposto para reduzir o planeta e colocar a nebulosa no enquadramento inicial. Celeiro ampliado com textura própria de tinta vermelha. Iluminação quente, HDRI, ACES, bloom, FXAA, sombras e oclusão ambiente em meia resolução. Câmera próxima de 2,25 m / 60°, com compensação do ombro pela proporção da janela.

## Validação e limites

60 testes automatizados aprovados em 11 arquivos nesta revisão; TypeScript strict e build de produção aprovados. Os testes incluem dano anunciado, projéteis limitados, morte/reutilização de atores, chefe com população cheia, fenda/estágio seguinte, coordenadas Babylon, área corrosiva finita, progressão, navegação e os contratos anteriores de movimento/arma/MP.

A queda de corpos usa animação e integração de gravidade/torque, sem solver de ragdoll articulado. Navegação/colisão usam pisos, rampas e AABBs; não constituem colisão geral de cápsula contra qualquer malha. O cenário é uma composição autorada fixa; novas seeds variam início, pressão, conteúdo e ofertas, preservando as rotas. Variantes botânicas reutilizam o rig da berinjela e ainda exibem essa origem em suas silhuetas. O visual não deve ser descrito como idêntico às imagens de referência.

F1 oferece testes explícitos de 50/100/150 atores, invulnerabilidade, itens, chefe e sua conclusão. Esses comandos são ferramentas de QA, não progressão normal. A população padrão permanece em 50 e retorna a esse limite na próxima etapa. As medições desta revisão constam em BROWSER_VALIDATION.md.

## Fontes e reprodução

- Cenário editável atual: `art/blender/Farm_World_Polished.blend`. O intermediário `Farm_World_Final.blend` é recriado por `finish-farm-world.py` durante a sequência completa; foi removido após a validação da fonte atual para recuperar espaço.
- Personagem editável com encaixes e movimentos: `art/blender/Gunslinger_Final.blend`.
- Roster: `art/blender/Mutant_*.blend`, versões com poses; GLBs finais em `public/models/` recebem a redução adicional de `optimize-living-roster.py`, seguido de `finalize-mutant-materials.py`. As fontes Blender finais foram sincronizadas com esses GLBs. Orçamentos reais em `roster-geometry.json`.
- Cenário desde os scans: `build-farm-world.py` → `optimize-farm-world.py` → `detail-farm-world.py` → `finish-farm-world.py` → `polish-farm-world.py` → `finish-doorway-stones.py` → `finish-tree-canopies.py` → `finish-farm-stairs.py` → `export-foliage-lods.py`. Execute a sequência completa; os scripts de composição não são cumulativamente idempotentes sobre o GLB final.
- Roster: `build-mutant-roster.py` → `optimize-roster.py` → `animate-mutants.py` → `optimize-living-roster.py` → `finalize-mutant-materials.py`.
- Ações aéreas: `animate-player-air.py` sobre o GLB que já contém os encaixes de `fit-grip.py`.

O disco C: atingiu a capacidade durante o trabalho. Foram removidos somente intermediários gerados e duplicatas de trabalho verificadas; por isso alguns caminhos em documentos históricos deixaram de existir. Um arquivo intermediário do cenário estava truncado e foi recuperado a partir do GLB exportado. Os arquivos de trabalho atuais acima substituem esses intermediários. Não foram removidos assets originais do usuário.





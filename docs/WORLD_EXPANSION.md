# Expansão contínua do mundo

Checkpoint: 07/09/2026. Cópia ativa: D:/Riskodefruta2. Sem Meshy. Preservar modelos, UVs e texturas originais dos inimigos.

## Critério de conclusão

A referência congelada em world-baseline.json contém 8.416,6403 m² de polígonos navegáveis conectados ao spawn. A meta de 25 vezes é 210.416,0081 m². scripts/measure-world.mjs mede o navmesh exportado, descarta polígonos não conectados e preserva o baseline. Área decorativa e orçamento de projeto não contam como área entregue.

Não concluído: o mapa atual permanece em 1,00 vez a referência. Exigências adicionais são travessia contínua verificável, objetivos/recompensas por região, diversidade visual, limites de entidades e recursos, validação de colisão e revisão visual. Não prometer 60 FPS ou equivalência à referência sem medições.

## Ordem de trabalho

1. Consolidar carregamento e colisão por regiões antes de multiplicar o cenário.
2. Construir e revisar o primeiro conjunto de ilhas novas, com perfis distintos de rocha/terra, caminhos e marcos, reutilizando o acervo texturizado. Criar fontes Blender editáveis.
3. Expandir em seis conjuntos temáticos: agricultura solar, brejo de esporos, basalto e brasas, terras de cristal, pomares de tempestade e raízes astrais. Proposta inicial: oito ilhas por conjunto; quantidade e dimensões devem ser revistas pela medição efetiva, não pela estimativa.
4. Conectar áreas por pontes, travessias móveis e transições com estado persistente. Cada rota precisa de colisão, navegação, recuperação de queda e teste de ida/volta.
5. Distribuir exploração, baús aleatórios físicos, encontros próprios, objetivos, chefes e recompensas. Preservar o modo de hordas.
6. Revisar combate, animação, som, VFX, água, loading e todos os pedidos abertos em OBJECTIVES_QUEUE.md.
7. Medir custo com câmera parada, deslocamento entre regiões, hordas e habilidades. Só aumentar conteúdo respeitando o orçamento medido.

## Entregas deste checkpoint

- Baseline congelado e medição reproduzível da área conectada.
- RegionResidency: reserva de orçamento antes de carregar, concorrência limitada, cancelamento, descarte de resultados atrasados, recuperação explícita de falhas e limpeza no encerramento. Integrado ao carregamento da cidade existente.
- Culling de detalhes a distância com histerese; edifícios e colisões não são removidos por esse culling.
- Nove baús físicos nas três fazendas atuais, usando o mecanismo de abertura e item aleatório existente.
- Spawns em torno da posição explorada, com procura limitada e verificação de terreno, ocupação e conectividade.
- 258 testes em 32 arquivos passaram (art/tests-world-expansion.log). Checagem TypeScript aprovada (art/typecheck-expansion.log).
- Sessão limpa no navegador chegou a 100%, entrou no jogo, mostrou personagem e baú interativo na cidade.

## Limitações verificadas / próximos passos concretos

- RegionResidency ainda controla uma região da cidade; o orçamento é abstrato, não bytes medidos de VRAM. O loader Babylon termina uma requisição obsoleta e descarta o resultado; não aborta fisicamente o download.
- Ainda faltam particionamento real de colisão/navmesh, carregamento espacial de múltiplos conjuntos e persistência de encontros fora da região ativa.
- Os novos baús bloqueiam jogador e raycast, mas seus obstáculos devem também entrar no navmesh e na simulação do servidor.
- A cidade foi revisada visualmente, mas a compra e coleta de cada baú ainda não foram exercitadas no navegador.
- Foto atual mostra celeiros com aparência repetida e terreno plano: refinamento artístico continua aberto.
- Métrica pontual no início desta sessão: 42 FPS, CPU 12,97 ms, GPU 11,22 ms, 156 draw calls, 762 meshes ativos, 1.302.996 triângulos, GTX 1650, WebGL2/qualidade alta. Não é benchmark sustentado nem prova de melhoria; eram 1 entidade e câmera inicial.
- Build e checagem do servidor serão repetidos ao fechar a próxima alteração.

## Continuidade

Meta ativa nesta tarefa. Heartbeat único a cada 30 minutos: Mutant Farm — desenvolvimento e revisão contínuos. O app permite um heartbeat por tarefa; execução, auditoria e revisão foram reunidas nele. Evitar trabalhos simultâneos sobre os mesmos arquivos. Manter o computador e o app ligados para trabalho local. Notificar apenas mudanças relevantes, falhas ou conclusão verificável.

### Fechamento da validação deste checkpoint

260 testes / 32 arquivos aprovados em art/tests-world-expansion-final.log. Build aprovado em art/build-world-expansion.log (aviso de bundle acima de 500 kB permanece); tipos do servidor aprovados em art/server-typecheck-world-expansion.log. Navmesh rebakeado: seis rotas principais completas. Dois testes adicionais verificam desvio real dos nove baús pelo navmesh exportado e bloqueio de jogador/projéteis. Volumes dos baús compartilhados entre cliente, servidor e bake; esta pendência do bloco anterior foi resolvida.

Área após obstáculos: 8.371,2004 m² conectados (0,994601 vez a referência; 3,9784% da meta final). O alvo continua 210.416,0081 m²; corrigido o relatório para ler o alvo congelado em vez de recalculá-lo sobre a medição corrente. world-baseline.json não foi alterado. Registro: art/world-area-after-chests.log.

Próxima implementação: composição de colisões por região com ativação/descarte atômicos e proteção contra entrada numa área não pronta; depois navmesh por região e a primeira expansão física com fontes Blender. Manter colisão residente enquanto jogador/inimigos dependem dela. Não esconder um buraco de carregamento com teleporte silencioso. Não ampliar o bake monolítico indiscriminadamente.

## Fronteira Solar entregue — 07/09, segundo checkpoint

Progresso real sobre o checkpoint anterior: duas ilhas adicionais conectadas e seis novos baús físicos. Pomar dos Ventos (centro 248,9,45) e Porto dos Grãos (285,15,147), com fontes editáveis em art/blender/Solar_Frontier.blend e gerador em scripts/build-solar-frontier.py. Exportação: public/models/solar-frontier.glb e solar-frontier-collision.json. Cultivo em superfícies largas, volume rochoso fechado de aproximadamente 32 m, elevadores de grãos, silos, mercado, moinhos, árvores e pontes. Modelos/texturas de inimigos não foram alterados.

Área conectada final: 20.473,6790 m², 2,432524 vezes a referência, 9,7301% da meta final. Restam 189.942,3291 m² para o alvo de 210.416,0081 m². Não considerar as duas ilhas como seis biomas finalizados. O acervo visual continua precisando de variedade e refinamento.

### Colisão, navegação e recursos

- CollisionWorld aceita regiões preparadas e independente de seu índice base. Ativação e substituição atômicas; descarte antigo não remove uma substituição mais recente. Queries de chão, overlap, raios, esferas, caminhada e movimento aéreo consultam regiões.
- A cidade antiga e a fronteira nova usam colisões regionais preparadas antes de ativar o recurso visual. Ambas continuam residentes desde o loading; descarte espacial por distância/pinning ainda não entrou. Havok mantém um corpo estático combinado para ragdolls; sua divisão permanece pendente.
- Navmesh deriva limites das geometrias, com grade ancorada em múltiplos da célula para preservar conexões. Aceita patches do terreno modelado. Ainda é um bake monolítico; tiles regionais são o próximo passo de escala.
- Corrigida a chegada da ponte do porto: a rampa termina antes da parede da ilha e se conecta a um patamar. Fonte Blender e script principal atualizados. repair-grain-port-landing.py detecta que a correção já foi aplicada e não a reaplica.
- Bake agora verifica oito rotas completas incluindo altura antes de publicar. Uma falha fica em art/navmesh-last-attempt.json e não substitui o navmesh válido.
- Seis baús novos usam colisão compartilhada entre cliente, servidor e bake. Servidor carrega também a geometria das novas ilhas.

### Evidências

- 275 testes em 34 arquivos passaram: art/tests-frontier-final-isolated.log. Incluem ida/volta de cada trecho novo, todas as pontes antigas, chegada às duas ilhas desde o spawn original no navmesh exportado, posição dos baús e chão correspondente no servidor.
- Primeira execução concorrente a Blender/build teve 274 aprovados e um timeout de 5 s no teste de determinismo. Suíte repetida sem esses processos passou mantendo testes e limites originais. Logs anteriores preservados em art/tests-frontier-final.log.
- Build e tipos de servidor aprovados: art/build-frontier-final.log e art/server-typecheck-frontier.log. Aviso de bundle acima de 500 kB permanece.
- art/navmesh-frontier-validated.log: oito rotas chegam ao destino. art/world-area-solar-frontier.log: medição final e meta congelada.
- Inspeção no navegador: loading 100%, personagem visível, inimigos nascem e atacam no Pomar dos Ventos. Detectados detalhes de vegetação degradados e rochas altas; copas foram reexportadas com cerca de 6.000 faces e rochas de borda reduzidas a 4 m, parcialmente embutidas na ilha. Refinamento: art/solar-frontier-refinement.log.

### Continuidade prioritária

1. Fazer seleção espacial de regiões com pinning dos atores e barreiras/transições legíveis para recursos ainda não prontos; dividir navmesh e Havok para não aumentar o monólito.
2. Criar objetivos e identidade visual por distrito; adicionar mais ilhas e outros biomas até a área verificada atingir o alvo. As regiões atuais ainda compartilham muitos materiais e formas do mesmo kit.
3. Revisar água, céu (uma linha ainda foi observada em certos ângulos), variedade da vegetação, poses e ataques conforme a fila original.
4. Medir desempenho sustentado com apenas o jogo em execução e cenários de horda/deslocamento, sem extrapolar a partir de uma leitura pontual durante testes/Blender.

### Revisão visual final do porto

Sessão limpa carregou a fronteira refinada até 100%, entrou no Porto dos Grãos, mostrou personagem visível, baú na praça e inimigos atacando sobre a ilha. A redução das rochas resolveu a altura excessiva dos espigões decorativos, mas as árvores ainda mostram copas pobres. Diagnóstico do acervo original: 34.787 triângulos de tronco, 1.060.032 de folhas e 504.584 de galhos; reduzir o conjunto a 6.000 faces remove folhas demais. Não considerar esse LOD aprovado visualmente. Próxima correção artística: LOD por parte/material ou impostores renderizados do modelo original, preservando copas completas sem instanciar 1,6 milhão de triângulos por árvore. A cena continua abaixo da riqueza e iluminação da referência; equivalência visual está aberta.

## Física regional e retenção de ocupantes — 07/09, 06:22

Progresso sobre o checkpoint anterior: o terreno Havok deixou de ser uma malha combinada de base + cidade + fronteira. ensureRagdollPhysics inicializa o motor uma vez por cena; addRagdollTerrain cria um corpo estático por região e devolve um descarte idempotente. FarmWorld ativa/desativa esse corpo junto com colisão do jogador e container visual. O terreno base permanece próprio. Isso elimina a montagem da cópia combinada para Havok.

RegionResidency agora tem retain(id): cada dono libera sua própria retenção. Pedidos novos e mudanças de orçamento/custo não descartam uma região retida; todos os donos precisam liberar. A retenção só aceita recursos prontos e suporta encerramento da cena sem ressuscitar cargas. FarmWorld.fixedUpdate mantém retenções para posição do jogador, corpos de inimigos ativos e raízes físicas dos ragdolls vivos. CollisionWorld.regionIdsAt inclui ambas as regiões quando o raio do ator cruza uma borda; usa XZ conservador, inclusive para atores acima da ilha. RagdollWorld registra e remove os corpos ativos por cena para esse cálculo.

Evidência: 281 testes / 35 arquivos em art/tests-occupied-regions-final.log; build aprovado em art/build-occupied-regions.log. tests/regional-havok.test.ts carrega o WASM real de Havok com NullEngine: duas esferas pousam em dois terrenos; ao remover um, só sua esfera cai e a vizinha permanece apoiada. Tests de retenção cobrem múltiplos donos, pressão de orçamento, mudança de custo, liberação duplicada e encerramento. Testes de fronteira cobrem sobreposição e regiões distantes. O build inicialmente detectou Buffer em lugar do ArrayBuffer exigido pelo tipo de Havok; o teste foi corrigido e reexecutado.

Navegador: loading chegou a 100%, visita ao Porto dos Grãos em (285,15,120), grounded true, 1 ragdoll e 9 agentes no diagnóstico. Leitura pontual: 49 FPS, CPU 13,93 ms, GPU 5,56 ms, 91 draw calls, 129 meshes ativos e 452.920 triângulos, GTX 1650. Não é benchmark sustentado.

Ainda aberto: ambas as regiões são solicitadas no loading inicial. A política espacial não está ligada; não afirmar que o streaming por distância já funciona. Próximo passo concreto: mover configuração de materiais/LOD/culling para o ciclo de vida de cada recurso (o array central de detalhes ainda guarda referências dos meshes iniciais), adicionar seleção por proximidade e passagens visíveis bloqueadas quando o destino não estiver pronto. Teleportes QA/viagens devem aguardar o destino pronto. Depois particionar o navmesh. Copas, novos biomas e expansão até 25× permanecem abertos; área não mudou nesta etapa (20.473,6790 m² / 2,432524×).

## Streaming espacial ativo no modo solo — 07/09, 06:35

O modo solo agora solicita inicialmente só farm-city. SpatialRegionInterest calcula distância aos limites das regiões, carrega a até 110 m e só deixa de solicitar após 155 m. O raio maior também mantém pedidos ainda em carregamento, evitando cancelamentos ao oscilar na borda. RegionResidency continua respeitando o orçamento (duas unidades abstratas) e as retenções reais de jogadores, inimigos e ragdolls.

RegionPresentation é dona dos detalhes visuais de cada container: configuração de materiais/luz, sombras, culling e observer de congelamento. Ao descartar, remove observer/casters e solta referências. Os meshes das regiões não são mais anexados à lista central de detalhes/LOD do terreno base. Cada carga configura seus próprios materiais, inclusive cargas posteriores ao menu.

RegionPassages mantém campos visíveis com “PASSAGEM EM ESTABILIZAÇÃO” em solo existente, antes das pontes de regiões ainda não prontas. O volume bloqueia caminhada e movimento aéreo; desaparece quando o recurso fica pronto. prepareVisit mantém pedido explícito e só libera teleporte QA após concluir a região, mantendo o jogador no chão atual enquanto aguarda. Em caso de falha, não teleporta. O diagnóstico mostra regiões prontas, retidas e cargas em andamento.

Compatibilidade: ?online=1 continua com as duas regiões pré-carregadas. O servidor cooperativo ainda não confirma prontidão espacial por cliente; liberar streaming ali agora permitiria reconciliação através de uma barreira apenas local. Streaming cooperativo e sua sincronização seguem pendentes; isto preserva o comportamento anterior.

Validação: 286 testes / 36 arquivos aprovados em art/tests-spatial-final.log; build aprovado em art/build-spatial-final.log. Os testes específicos cobrem seleção/histerese, retenção de área distante ocupada, bloqueio dos dois acessos tanto a pé quanto no ar, liberação após prontidão e limpeza de apresentação sem afetar região vizinha. O limite de tipos e bundle também passou; permanece aviso de bundle >500 kB.

Navegador confirmou: início com apenas farm-city pronta; solicitação ao porto mostrou Carregando: 1 mantendo o jogador no spawn; conclusão mostrou farm-city + solar-frontier e jogador grounded em (285,15,120); retorno ao início com remoção dos ocupantes distantes voltou a apenas farm-city, Carregando: 0. Segundo ciclo de carga/descarte também conferido. Não afirmar redução de bytes de VRAM: orçamento ainda é abstrato, sem perfil de memória medido. Navmesh segue único e todos os baús continuam instanciados; ambos precisam acompanhar a escala futura. Carregamento de texturas/índices ainda pode disputar CPU e causar pausas breves durante a partida.

Próximos passos: completar conferência visual da recarga, particionar navmesh/estado de encontros e medir recursos; melhorar copas com LOD apropriado; continuar adicionando ilhas e biomas distintos, objetivos e progressão até atingir o alvo. Área permanece 20.473,6790 m² / 2,432524×, sem alteração de geometria nesta etapa. Falhas de carga mantêm a passagem fechada, mas a política automática de retentativa/feedback de erro ainda precisa ser refinada.

Conferência final da recarga concluída: após descarregar solar-frontier e solicitá-la outra vez na mesma sessão, o diagnóstico mostrou a região pronta/retida, Carregando: 0, jogador grounded em (285,15,120). Screenshot inspecionado mostrou personagem, piso, elevador de grãos, cercas e baú com materiais presentes. Não surgiram regiões sem chão nesse ciclo testado. Leitura pontual com um único inimigo QA: 57 FPS, CPU 10,57 ms, GPU 5,62 ms; não usar como evidência de 60 FPS em hordas. Copas continuam sem a densidade necessária, já registradas como falha visual pendente.


## Copas do pomar — LODs por material, integrados e revisados

A árvore original tem 1.599.403 triângulos. A redução global para ~6 mil destruía as folhas. scripts/build-orchard-tree-lods.py agora separa tronco, galhos e folhas antes de reduzir, preservando UVs/texturas. Near: 97.998 triângulos; medium: 28.673. Fontes em art/blender/Orchard_Tree_LODs.blend; comparação com a mesma câmera/luz em art/tree-lod-review/{original,near,medium}.png. A imagem medium inicialmente saiu transparente por herdar hide_render; foi renderizada novamente com a visibilidade correta e inspecionada. O script de geração já corrige essa herança.

scripts/install-orchard-lods.py instalou as variantes nas 12 posições originais de Solar_Frontier.blend e reexportou solar-frontier.glb. São 72 nós compartilhando apenas seis geometrias (três materiais × dois níveis), confirmado no GLB por teste. Os anchors originais permanecem no Blender, ocultos e fora da exportação; terreno e colisores não foram alterados. Reexecutar install-orchard-lods.py após qualquer reconstrução do frontier; o antigo refine-solar-frontier.py não deve ser usado para árvores, pois reduz globalmente a copa.

OrchardLods troca todas as partes da árvore juntas: entra no nível próximo a 50 m, sai a 60 m; oculta além de 190 m e reaparece abaixo de 180 m. A seleção usa a posição real de cada árvore, com histerese e atualização a cada 0,25 s. RegionPresentation é dona da política; restaura visibilidade e solta referências no descarte. Não sobrepor near e medium.

Validação: 288 testes / 37 arquivos em art/tests-orchard-lods.log; build aprovado em art/build-orchard-lods.log (aviso de bundle >500 KB permanece). Navegador: carga do pomar concluída, piso/personagem presentes e copas texturizadas visíveis; testada recarga da região após reset QA, novamente com árvores. Não é medição sustentada de FPS. A paisagem continua esparsa e precisa de composição/vegetação mais rica. Nenhuma área nova foi contabilizada: permanece 20.473,6790 m² / 2,432524×.


## Recuperação das regiões durante a exploração

RegionResidency aceita política opcional de retentativa e um relógio avançado pelo proprietário, sem timers sobrevivendo à cena. FarmWorld habilita 2, 4, 8, 16 e no máximo 30 segundos entre falhas. Só regiões ainda desejadas voltam à fila, respeitando orçamento e concorrência. Sucesso limpa o histórico; cancelamento não vira falha. Descarte encerra retentativas. O carregamento de colisão recebe AbortSignal; há verificação de cancelamento antes do carregamento GLB. O download interno do GLB ainda não é interrompido: resultados obsoletos continuam sendo descartados sem ativação pelo pool.

As passagens permanecem fisicamente fechadas e mostram ROTA INDISPONÍVEL com contagem da nova tentativa após uma falha; retornam à indicação de estabilização durante nova carga e abrem apenas quando ready. O diagnóstico mostra região, número de falhas e prazo. prepareVisit permite tentativa manual e continua sem teleportar para região incompleta.

Validação: 292 testes / 37 arquivos aprovados em art/tests-region-recovery.log e mais 1 teste de mensagem em art/tests-passage-status.log (total atual 293 em 38 arquivos). Build em art/build-region-recovery.log aprovado; aviso >500 KB permanece. Testes cobrem backoff crescente/limitado, retorno da conexão, região não desejada, descarte, sinal abortado, reinício do histórico após sucesso e texto de contagem. Não foi simulada falha de rede visualmente no navegador nesta etapa; não interpretar testes de política como essa prova.

Limites: recuperação automática opera depois que o mundo inicial ficou pronto. Falha no carregamento inicial ainda usa o tratamento de erro do menu. Orçamento continua abstrato; navmesh regional, persistência de encontros e novos biomas permanecem pendentes. A área não mudou nesta etapa: 20.473,6790 m² / 2,432524× de uma meta de 25×.


## Distrito das Estufas — terceira ilha da fronteira

Expansão física em scripts/build-solar-frontier.py e art/blender/Solar_Frontier.blend: ilha centrada em (285,15,280), perfil largo de aproximadamente 148 × 144 m com volume fechado de 32 m, solo/rocha texturizados, duas estufas atravessáveis com armação metálica e cobertura translúcida, canteiros, silos e avenida central. Ponte de sete metros liga o porto em (285,15,185) à chegada em (285,15,214). A região solar-frontier passou a incluir o novo distrito; limites espaciais atualizados.

Cinco novos baús físicos: chegada, corredor oeste, corredor leste, praça norte e mirante oeste. Total da fronteira: onze baús, usando o mesmo catálogo de sorteio, cobrança e coleta existentes. Colisores compartilhados cliente/servidor. Nenhuma recompensa foi entregue automaticamente. O diagnóstico ganhou Visitar distrito das estufas; aguarda prontidão antes do teleporte QA.

Uma primeira tentativa de geração não inseriu o bloco novo devido a uma substituição de texto sem correspondência. A validação recusou as novas rotas e preservou o navmesh anterior. A inserção foi corrigida e o gerador agora possui invariantes para três terrenos/quatro ligações e limite Z da nova ilha. Log inicial de falha: art/glasshouse-navigation.log. Exportação correta: art/glasshouse-build-corrected.log. LODs das 12 árvores reinstalados com scripts/install-orchard-lods.py (art/glasshouse-lods-final.log). GLB atual: 63.457.028 bytes; colisão: 9.635.136 bytes.

O bake só publicou após 22 rotas completas: oito originais, chegada à nova ilha, dois corredores e aproximação dos onze baús a partir do spawn original. art/glasshouse-navigation-final.log e docs/navmesh-validation.json. Testes também atravessaram as quatro seções de ponte nos dois sentidos com PlayerMotor, verificaram chão dos corredores/avenida e acesso/recompensas no servidor.

Área medida pelo navmesh conectado: 35.859,05878528317 m², aumento de 15.385,37979232555 m²; 4,2604955667× a referência congelada. Meta continua 210.416,00809001856 m² / 25× (17,04% atingido). docs/world-measurement.json e art/glasshouse-area.log; área decorativa e polígonos sem caminho completo não entram.

Validação: suíte art/tests-glasshouse.log teve 296 aprovados e uma expectativa antiga de oito rotas; essa expectativa foi atualizada para 22, preservando os nomes das oito rotas antigas como obrigatórios. Os seis testes do arquivo corrigido passaram em art/tests-glasshouse-route-regression.log. Total atual: 297 testes em 38 arquivos. Build final aprovado em art/build-glasshouse-final.log e tipos do servidor em art/glasshouse-server-typecheck.log; aviso de bundle >500 KB continua.

Navegador confirmou região pronta, Carregando: 0, jogador grounded em (285,15,245), sem retornos, e cidade distante descarregada. Screenshot inspecionado: personagem, solo, armações, coberturas, plantações e silos presentes; segunda carga também conferida após reset QA. Arte ainda esparsa: avenida extensa e vazia, estufas precisam de acabamento, iluminação/sombras e horizonte precisam enriquecer. Não é equivalência às referências nem bioma artístico final. Leitura pontual com dez agentes mostrou 41 FPS e CPU18,71 ms, com outras sessões abertas; não é benchmark controlado nem certificação de 60 FPS.

Próxima prioridade: enriquecer composição e horizonte desta expansão e dividir recursos/navegação antes de multiplicar distritos; continuar rumo a 25× com variedade real e objetivos exploráveis, sem substituir o objetivo por terreno vazio.


## Continuidade do horizonte durante streaming

DistantRegions carrega proxies visuais derivados de Agricultural_City.blend e Solar_Frontier.blend. DistantRegionSet garante exclusividade: somente regiões sem recurso detalhado pronto mostram proxy; descarregamento restaura a silhueta; chegada tardia não sobrepõe a versão completa; descarte libera recursos pendentes. A ativação/desativação está integrada ao ciclo de RegionResidency. Proxies não têm colisão, não liberam passagens e não alteram a medição de área.

scripts/build-distant-regions.py mantém os volumes fechados e construções dos assets reais, reduz texturas a até 512 px e agrupa a geometria por material. Depois da primeira conferência, foram removidas apenas pedras de acabamento e vegetação miúda dos proxies, mantendo as ilhas sólidas. Cada GLB final tem um mesh com oito primitivas/materiais: farm-city 65.580 triângulos / 5.073.944 bytes; solar-frontier 55.340 / 4.372.592 bytes. Total 120.920 triângulos e 9.446.536 bytes. Report em docs/distant-region-budget.json. Eles acrescentam memória persistente: não confundir menor custo visual com memória gratuita.

Diagnóstico ganhou Revisar horizonte das estufas, posicionando (285,15,245) e olhando para a cidade. Navegador confirmou apenas solar-frontier pronta/retida, farm-city detalhada descarregada e silhuetas de construções/ilhas ainda presentes ao fundo. A primeira revisão tinha proxies de 239.588 triângulos/150 objetos; a redução final foi conferida nos GLBs por teste. Não foi medido FPS controlado depois da redução. A névoa deixa o horizonte muito azul e a composição continua precisando de acabamento; emenda do céu ainda visível na revisão e permanece pendente.

Validação: 299 testes / 39 arquivos aprovados em art/tests-distant-regions.log. Após a redução final foram acrescentados dois testes dos GLBs (oito lotes, limite de triângulos/bytes e materiais texturizados); os quatro testes do arquivo passaram em art/tests-distant-assets.log, total atual 301. Build final aprovado em art/build-distant-regions-final.log; controle de enquadramento QA incluído. Área continua 35.859,0588 m² / 4,260496×; a meta 25× e revisão global não estão concluídas.


## Céu infinito — correção de acompanhamento da câmera

SeamlessSky marcava a esfera como infiniteDistance e em seguida congelava sua matriz. O código local do Babylon confirma que a posição de câmera é aplicada ao recomputar a matriz; o congelamento impedia o comportamento normal durante exploração. Removido freezeWorldMatrix do céu, mantendo orientação, textura original e ausência de colisão. Também removido fract desnecessário da coordenada U interpolada (já limitada a 0..1), evitando descontinuidade de derivadas na amostragem.

Teste com NullEngine/FreeCamera move a câmera por spawn, estufas e (-1500,80,2000), avança renderId e usa computeWorldMatrix sem force: o centro do céu permanece igual à câmera. Isso cobre a regressão real, não apenas uma atualização forçada que ignoraria o congelamento. art/tests-sky-render-cycle.log. Suíte completa: 302 testes / 40 arquivos aprovados em art/tests-sky-final.log; build em art/build-sky-final.log aprovado, aviso >500 KB continua.

Revisão visual no enquadramento do horizonte das estufas mostrou mudança de perspectiva esperada com céu centrado, mas ainda revelou faixa/patch visível no alto do panorama. Portanto a emenda artística NÃO está resolvida. Não marcar o pedido do céu como completo com base no teste de matriz. Próxima investigação deve separar a mistura periódica/amostragem do panorama de artefatos dos pós-processamentos. Nenhuma textura original foi editada; área e meta da expansão permanecem inalteradas.


## Investigação da costura do panorama

Comparação no mesmo enquadramento das estufas: remover mipmaps não eliminou a faixa; experimento desfeito. Controles QA Céu sem mistura / Céu com mistura permitem alternar o shader em runtime. Sem mistura, a junção das extremidades fica claramente visível; não é apenas deslocamento do céu nem filtro mipmap.

A mistura agora converte cada amostra para luz linear antes da interpolação, evitando escurecimento não físico produzido por interpolar RGB codificado e só então elevar à potência. Ampliar a mistura de 0,085 para 0,14 foi testado visualmente, mas produziu nuvens duplicadas/ghosting; largura restaurada a 0,085. A imagem original permanece intacta. A diferença entre as bordas requer uma costura artística adequada do panorama; não considerar a emenda concluída.

Build dos controles e da mistura passou (art/build-sky-diagnostics.log e art/build-linear-sky.log), teste de acompanhamento permaneceu aprovado (art/tests-linear-sky.log). A suíte completa mais recente continua 302 testes / 40 arquivos. Revisão visual feita no navegador, sem alegar desaparecimento total da emenda. Próximo passo: preparar asset panorâmico com continuidade real, conferir bordas e projeção, mantendo o acompanhamento infinito já corrigido.


## Panorama v3 — correção artística das bordas

Gerado com image_gen a partir do panorama v2, preservando identidade de céu azul alienígena, planeta, nebulosa violeta e mar de nuvens, com bordas laterais mais compatíveis. Novo arquivo public/environment/cosmic-sky-v3.png; v2 preservado. Fonte gerada: C:/Users/lucas/.codex/generated_images/01a077a3-e18d-73f1-8f10-fb414019f5ea/exec-2669e7eb-0a8d-403f-bc1f-408a678074a1.png. O resultado entregue tem 1774×887, não os 3072×1536 sugeridos no prompt; não afirmar 3K/4K.

Comparação numérica RGB 0..255 das colunas extremas: diferença média v2=41,3555, v3=6,1481; metade superior v2=13,0752, v3=4,7479. Report docs/sky-panorama-comparison.json. Não é igualdade pixel a pixel, portanto mistura linear de bordas permanece. Céu, reflexo de poças, nuvens do abismo, portal e fundo do menu passaram a usar a mesma v3.

Revisão no navegador em Revisar horizonte das estufas, yaw -2,323, posição (285,15,245): a faixa escura e as nuvens duplicadas que apareciam no enquadramento anterior deixaram de ser visíveis. Captura inspecionada com panorama azul contínuo naquele campo de visão. Não foi realizada varredura integral dos 360°/polos nesta etapa; esse escopo continua pendente.

Build art/build-sky-v3.log aprovado e regressão de acompanhamento art/tests-sky-v3.log aprovada. Suíte completa mais recente permanece 302 testes / 40 arquivos; esta alteração de asset/URLs foi validada por build, teste direcionado, comparação numérica e revisão visual. Aviso do bundle >500 KB permanece. Área segue 35.859,0588 m² / 4,260496× e meta geral 25× ativa.


## Contratos opcionais de abastecimento por distrito

DistrictContracts acompanha seis contratos: Sementes, Fazenda Solar, Mercado da Colheita, Pomar, Porto e Estufas. Cada um exige dois baús reais diferentes do seu catálogo; IDs desconhecidos, repetição e aberturas posteriores à conclusão não geram progresso/recompensa adicional. RunInteractables só registra após pagamento/abertura bem-sucedidos. Ao concluir, sorteia um bônus do catálogo existente e o ejeta no chão próximo ao último baú, em direção oposta à recompensa normal para evitar sobreposição. Nenhum item é aplicado ao inventário antes de coleta com E. Reset de estágio limpa contratos junto dos baús. Hordas permanecem como objetivo principal.

HUD mostra contrato opcional mais próximo, progresso 0/2, contratos concluídos 0/6, direção relativa à câmera e distância até o próximo baú ainda fechado do contrato, em vez de apontar ao centro vazio do distrito. Ao concluir todos, informa que as rotas foram recuperadas. Texto da horda corrigido de ITEM RECEBIDO para RECOLHA O ITEM, pois a recompensa é física.

Validação: 304 testes / 41 arquivos aprovados em art/tests-district-contracts.log. Teste integrado usa NullEngine, RunInteractables, RunProgression, PlayerMotor e LootDrops reais: pagamento insuficiente não avança; dois baús debitam 75 créditos; bônus existe como drop, inventário permanece vazio; coleta posterior adiciona exatamente um item; reset limpa progresso/drops. Após separar posição do bônus, seis testes de contratos/baús passaram em art/tests-contract-bonus-final.log. Guia final testado em art/tests-contract-guidance.log e build aprovado em art/build-contract-guidance.log (aviso >500 KB permanece).

Navegador: nas estufas, painel legível mostrou Distrito das Estufas, 0/2, direção para trás e 15 m até o baú, com horda ainda ativa. Fluxo completo de coleta foi coberto pelo teste integrado, não jogado manualmente até o fim no navegador. Esta entrega é fluxo local/solo; contratos ainda não têm persistência/dormência regional nem replicação autoritativa cooperativa. Não confundir objetivos de abastecimento com encontros especiais ou progressão global completa. Área segue 35.859,0588 m² / 4,260496×; meta 25× continua aberta.


### Navegação em tiles — 7 setembro
- Gerador Recast em tiles de 25,6 m, grade alinhada e 105 tiles ocupados. O bake ainda é carregado inteiro: não é streaming regional de navegação.
- 22 rotas obrigatórias completas; teste adicional de ida/volta entre distritos e agente Detour atravessando a ponte oeste.
- A tolerância de degrau de 0,6 m mantém a ligação com a ponte suspensa. Baús são obstáculos altos apenas na geometria de navegação para não serem tratados como degraus; colisão física original preservada.
- Regressão: 306 testes / 42 arquivos aprovados (`art/tests-tiled-full-final.log`), build aprovado (`art/build-tiled-navigation-final.log`).
- Medição após excluir áreas dos baús e alterar triangulação: 35.565,9887 m² conectados, 4,225675× a referência congelada; meta permanece 210.416,0081 m². Não houve expansão física nesta etapa.
- Evidências: `docs/navigation-tiles.json`, `docs/navmesh-validation.json`, `docs/world-measurement.json`.
- Próximos trabalhos: carregar/descarregar tiles preservando agentes e rotas, encontros regionais e novos biomas/ilhas reais até a meta. Revisão visual desta alteração interna não realizada.


### Residência dinâmica de navegação — 7 setembro
- NavigationTileResidency mantém cópia CPU dos tiles, remove tiles distantes do Detour e restaura salt/índice originais. Alocações restauradas têm owner explícito; 12 ciclos de remoção/restauração e dispose idempotente testados com o bake real.
- TacticalNavigation ativa esta política no bake usado pelo jogo: carrega ao redor do jogador/agentes, histerese 110/155 m, revisão a cada 0,5 s ou deslocamento maior que 25 m. Protege caminhos até o destino atual do agente e jogador; se faltar rota, restaura tudo antes de reavaliar. Agente desconectado mantém os tiles por segurança.
- Há cache JavaScript integral e download inicial integral: isto reduz dados residentes no Detour, não elimina o cache nem implementa download por tile. Sem alegação de ganho sustentado de FPS.
- Diagnóstico exibe tiles e bytes: navegador mostrou 34/105 e 171 KiB residentes no início, cache 398 KiB; após visita às estufas, 67/105 e 259 KiB com 10 agentes. Caminhos antigos podem reter mais tiles.
- 308 testes / 43 arquivos aprovados (`art/tests-navigation-residency-full.log`); build final aprovado (`art/build-navigation-residency-final.log`). Teste integrado cobre teleporte e perseguição atravessando a ponte com descarga ativa.
- Botão QA Horda normal corrigido para usar a posição atual do jogador, antes criava todos na origem antiga; não altera diretor normal.
- Revisão visual nas estufas: personagem e HUD presentes, distrito ainda visualmente esparso/sem relevo suficiente. Expansão física continua em 35.565,9887 m² / 4,225675×, não houve aumento nesta etapa.
- Próxima prioridade: expansão física com novo bioma, terreno e composição mais ricos, conteúdo explorável, colisão e medição real. Dormência/persistência de encontros e rede continuam abertas.


### Planaltos agrícolas — expansão integrada em 7 setembro
- Três ilhas: Campos Altos (500,280), Moinhos do Leste (720,320), Vale das Sementes (610,520). Terreno contínuo com colinas suaves, falésias fechadas de 40 m, cultivos texturizados, celeiro ampliado, silos, moinhos e depósitos. Não são três biomas artísticos finalizados.
- Quatro pontes físicas, seis segmentos de navegação: os acessos à ilha elevada receberam patamares antes da borda após dois testes detectarem colisão com a falésia. Afloramentos reais incluídos no bake para os agentes não tentarem atravessá-los.
- Região highland-farms com JSON de colisão, GLB, fonte art/blender/Highland_Farms.blend e script scripts/build-highland-farms.py. Proxy distante próprio, oito lotes de material, aproximadamente 4 MB; compartilhamento de plantas preservado.
- Nove baús novos posicionados pela colisão real e três contratos opcionais (agora nove). Bônus segue drop físico aleatório; sem inventário automático. Cliente e servidor incluem a mesma região e nove colliders de baús.
- FarmWorld aceita catálogo de regiões; orçamento de residência passou de duas para três unidades abstratas para suportar retenção durante a terceira região. Não representa medição de VRAM. Multiplayer carrega todas as regiões como antes; streaming autoritativo cooperativo permanece pendente.
- Navegação: 35 rotas completas, 293 tiles. Consultas longas ampliadas para 8.192 nós / 2.048 polígonos; antes o limite truncava rotas na entrada embora a ponte estivesse conectada.
- Medição final: 122.560,5037 m² conectados, 14,561690× a referência congelada (58,2468% da meta 210.416,0081 m²). docs/world-baseline.json intacto.
- Validação: 324 testes / 44 arquivos aprovados em art/tests-highlands-full.log. Após correção tipada da identificação regional, 17 testes de travessia/servidor/contratos passaram em art/tests-highlands-server-contracts.log. Inclui 12 direções físicas de travessia, nove pisos de baús, rotas longas e nove colliders no servidor. Build final art/build-highlands-final.log e server:typecheck art/server-typecheck-highlands.log.
- Navegador: visita carregou highland-farms e solar-frontier, personagem apoiado em (431,18.6,280), contrato Campos Altos 0/2 e nove contratos totais; 112/293 tiles / 361 KiB Detour / 843 KiB cache naquele instante. Horda local perseguiu e atacou. Amostra ~36 FPS não é benchmark controlado nem comprova 60 FPS.
- Pendentes: acabamento/densidade, sombras regionais, interiores sobre fundações, orientação de alguns inimigos e legibilidade de telegráficos. Expandir mais 87.855,5044 m² conectados para atingir 25×, com diversidade artística e conteúdo; restante da fila original continua aberto.


### Sombras acompanhando a exploração — 8 setembro
- Volume direcional acompanha a câmera, alinhado aos texels para reduzir deslocamento instável das sombras. Seleção por distância aos limites mundiais das malhas, com histerese, atualização a cada 0,25 s e descarte por proprietário.
- Aplicado às regiões e às ilhas iniciais; removida a restrição de projetores ao redor da origem. Limites por contêiner são contagem de malhas, não orçamento comprovado de triângulos/VRAM.
- 327 testes / 45 arquivos aprovados (art/tests-following-shadows-full.log); build aprovado (art/build-following-shadows-final.log). Aviso de bundle grande permanece.
- Revisão visual das novas sombras pendente: ferramenta de inspeção do navegador indisponível nesta retomada. Não alegar ganho de FPS ou equivalência artística às referências. Área permanece 122.560,5037 m² / 14,561690×.


### Apresentação da viagem — 12 setembro
Loop independente do mapa corrigido no Blender e integrado em 720p/30 FPS, com cabeça apontada às ilhas. Vídeo é apresentação, não expansão física: área permanece 122.560,5037 m² / 14,561690×. Entrada orbital contínua, novas ilhas/biomas e restante da meta 25× seguem pendentes. Evidência: docs/loading-headfirst-validation.json, art/build-headfirst-loop.log e CURRENT_IMPLEMENTATION.md.

Entrada aérea agora usa o cenário real durante aproximação de 900 m, sem alterar a área navegável. Revisão visual/entrada orbital completa pendentes; evidência técnica em art/tests-arrival-flight-full.log e art/build-arrival-flight-final.log.


### Trilhas dos planaltos — 12 setembro
- Onze trajetos autorados em docs/highland-trails.json conectam entradas de pontes, praça, celeiro e suprimentos dos três planaltos. Teste usa PlayerMotor e CollisionWorld reais, em ida/volta sem pular, exigindo chegada sem respawn ou recuperação de penetração. A primeira rede de nove rotas passou; a revisão visual identificou falta de acesso ao celeiro e baú dos moinhos, adicionados e testados.
- scripts/author-highland-trails.py projeta uma malha contínua sobre triângulos reais do terreno, 5,5 cm acima da superfície; textura/normal brown_mud_02 com bordas de alpha por vértice e UV mundial. Não adiciona piso físico, não cobre vazios; colisão/navmesh preservados. Removidas somente 28 samambaias sem colisão que encobriam caminhos. Objetos sólidos e assets originais preservados.
- Fonte nova art/blender/Highland_Farms_Trails.blend preserva Highland_Farms.blend original. GLB residente atualizado: 51.693.864 bytes, trilha em uma malha com 23.772 triângulos. Executar author-highland-trails.py após alterações de terreno/landings, depois build-highland-distant.py (agora usa a fonte com trilhas).
- Corrigida exportação distante que propagava COLOR_0 para materiais opacos ao juntar tudo: trilha permanece separada; auditoria dos dois GLBs confirma transparência só na trilha, textura de cor e normal. Proxy: duas malhas, 73.344 triângulos, 6.291.744 bytes, texturas até 512. Isto aumenta geometria/proxy; não afirmar ganho de FPS. Trilhas não ocupam seleção limitada de casters.
- Visão geral offline renderizada e revisada em art/highland-trails-overview.png: rede visível, acesso do celeiro integrado, destinos conectados. Campo ainda esparso e distante da riqueza das referências; falta revisão em câmera de gameplay e possível ajuste de contraste/material. Render Blender não prova visual do Babylon.
- 29 testes / quatro arquivos aprovados em art/tests-highland-trails-final.log; build aprovado art/build-highland-trails.log, aviso de bundle >500 KB permanece. Auditoria docs/highland-trails-export-validation.json e docs/highland-trails-authoring.json. Nenhuma nova área: 122.560,5037 m² conectados / 14,561690×; meta 25× intacta.
- Próximos: trilhas/acessos das regiões anteriores, revisão visual no jogo, densidade e composição dos biomas, restantes 87.855,5044 m² conectados. Colisões específicas relatadas, órbita/apresentação, combate, persistência e restante da fila continuam abertos.


### Rootwood — pontes corrigidas e copas preservadas, 13 setembro
- Processo de autoria anterior terminou com ROOTWOOD STAGING COMPLETE; sessão 66447 encerrada, sem reinício duplicado. GLB e colisão estão em art/rootwood-staging, não em catálogo de runtime.
- Primeira validação física encontrou quatro falhas: entrada na pedra dos planaltos e chegadas sob falésias em duas pontes. scripts/fix-rootwood-landings.py desloca a entrada para (797,342), eleva patamares antes das bordas, transforma madeira e caixas correspondentes e rebakeia colisão. Fonte original preservada; fonte corrigida Rootwood_Region_Landings.blend. Executar depois de build-rootwood-region.py, antes de árvores.
- scripts/validate-rootwood-traversal.mts passou 24 percursos: seis segmentos de ponte e seis caminhos, ambos sentidos, sem respawn/recuperação e chegada com erro menor que 0,5 m. Evidência art/rootwood-traversal.json e art/rootwood-traversal-final.log. A primeira falha está em art/rootwood-traversal.log. Isso não valida ainda navmesh global ou todos os obstáculos fora das rotas.
- Render inicial mostrou copas destruídas por decimação do kit. Corrigido por scripts/install-rootwood-trees.py: 300 âncoras com seis geometrias compartilhadas de Orchard_Tree_LODs, mantendo troncos/colliders. Fonte final de arte art/blender/Rootwood_Region_Trees.blend; GLB staging 59.528.444 bytes. Ajustar distâncias de LOD/proxy antes de integrar 300 árvores; não presumir bom FPS.
- art/rootwood-overview.png revisado após a troca: copas presentes, corredores e construções separados, circuito de pontes visível. Ainda faltam trilhas texturizadas, refinamento/diferenciação artística, recompensas/contratos, catálogo/região/servidor, barreira de entrada, navegação global, perfil de desempenho e revisão em gameplay. Fonte/render em scripts/render-rootwood-review.py; Blender finalizado, sem jobs de autoria ativos.
- Build da versão jogável aprovado art/build-rootwood-staging-checkpoint.log, com aviso >500 KB. Não significa integração da região: área válida segue 122.560,5037 m² / 14,561690×. Não contar geometria staging/decorativa para meta 25×.
- Próxima tarefa imediata da fila: implementar morte dramática antes de Renascer/Voltar ao menu, agora que autoria/correção física chegou a checkpoint. Depois retomar integração/conteúdo dos pomares e demais pendências. Pedido de origem voltou a solicitar andamento; envio permanece sem autorização após rejeição anterior, nenhuma nova tentativa feita. Desenvolvimento local sem bloqueio.


### Rootwood integrado na partida — 13 setembro
- Pedido explícito de integrar o mapa gigante priorizado. Catálogo FARM_REGIONS, servidor, regiões de colisão, barreira de preparação em (796,26.4,342), proxy distante e GLB detalhado agora incluem rootwood. Acesso pela ponte a leste dos Moinhos do Leste; rota real existente desde o início. F1 possui Visitar bosque gigante, usado para revisão, sem substituir a ligação física.
- Seis trilhas com PBR e borda desgastada projetadas sobre o relevo (25.352 triângulos), removidas 21 samambaias sem colisão do corredor. Fonte Rootwood_Region_Trails.blend; export detalhado 68235536 bytes. Proxy distante 54.511 triângulos / 4.988.304 bytes / texturas até 512, malha transparente separada dos opacos.
- Nove baús pagos com item aleatório físico, três contratos (Bosque da Colheita, Ruínas do Engenho, Terraços das Sementes); total 12 distritos e 13 campos de recompensa. Alturas dos centros corrigidas para o relevo real (35/43/29). Colisão de baús compartilhada pelo cliente/servidor/bake.
- Duas caixas obstruíam a volta pelo centro das trilhas: movidas para fora das interseções. Acesso de teste ao baú pela face voltada à rota, sem atravessar a caixa. 42 percursos físicos passaram (pontes, trilhas e acessos em ambos sentidos), sem retorno ao spawn nem recuperação de penetração: art/rootwood-integrated-traversal.log e art/rootwood-traversal.json.
- Navegação global reexportada: 44 rotas completas aprovadas, incluindo todos os baús novos desde o spawn. Área conectada final 222945.843862 m² / 26.488698018×, acima de 210.416,008090 m²; referência congelada intacta. Medição por polígonos caminháveis com caminho completo, não área decorativa: docs/world-measurement.json, art/rootwood-world-measurement-final.log. Apenas o requisito quantitativo de área foi alcançado; objetivo global/artístico e funcionalidades restantes NÃO estão concluídos.
- Árvores mantêm seis geometrias compartilhadas e materiais originais. Rootwood limita detalhe a três copas próximas + 20 médias, distâncias 18/85 m com histerese; primeiros frames não exibem todas as 300. Teste verifica exclusividade, limites e restauração. Árvores distantes hoje são ocultadas; silhuetas distantes/proxy de floresta e transição menos perceptível são pendências artísticas. Não afirmar 60 FPS.
- Revisão no Babylon em seed rootwood-integrated-review: região carregou até Prontas: farm-city, rootwood; posição (883,31.2,355); gameplay mostrou personagem, caminho texturizado, árvores, baú e contrato Bosque da Colheita / 0 de 12. Amostra inicial com duas abas de jogo e tarefas locais não é benchmark. Cenário ainda esparso, coberturas/apoios merecem refinamento, falta densidade/identidade das referências. Aba QA fechada preservando a aba do usuário.
- 28 testes / seis arquivos passaram: LODs, contratos, proxy, streaming, recompensas de todos os campos e colisão de regiões (art/tests-rootwood-integration.log). Build cliente/checagem servidor passaram antes do ajuste final de alturas/obstáculos; rodada completa e build final em andamento.
- Pendências preservadas: ampliar/refinar diversidade e conteúdo, performance controlada, acabamento de estruturas/terreno e árvores distantes, órbita/entrada, morte/áudio/VFX e restante da fila. Não encerrar meta ativa pelo número 26,49×.

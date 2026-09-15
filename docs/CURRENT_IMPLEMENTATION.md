# Estado atual — 07/09/2026

Projeto ativo: D:\Riskodefruta2. Babylon.js 9.25 / TypeScript / Blender. Sem API Meshy. A cópia antiga em C: permanece preservada. A fila cumulativa está em OBJECTIVES_QUEUE.md.

## Combate e inimigos

- Cinco GLBs originais: berinjela, milho, cenoura, tomate e melancia. Geometria, materiais, imagens e skins preservados pela auditoria original-enemy-integrity.json. O chefe reutiliza a melancia em escala maior. Não usar o pipeline histórico de substituição de anatomia.
- Recast/Detour Crowd, separação e setores de ataque; FSM de animação, passadas por deslocamento. Orientação frontal corrigida removendo a rotação extra na raiz. Asas próximas amostradas a cada render, ciclo de 0,44 s.
- Nascimentos individuais saindo da terra e clipes próprios de ataque/carga, sem o ataque de espada de origem. Tomate voa/cospe fogo; melancia anda em quatro patas, rola, morde e cospe caroços. A postura de tiro do milho existe; sua arma aguarda o asset do usuário.
- Ragdoll articulado Havok, limite de quatro corpos ativos e correção da escala refletida dos esqueletos. Knockback, dano visível, barras de vida, rastros e decals.
- Pistolas acompanham os braços em mira vertical. MP I lança uma sequência de balas curvas em leque com ricochete físico por segmentos, sem alvo travado. MP II distribui a barragem durante o mortal e sua finalização; MP III alterna mira por braço e pose cruzada com IK. As três atuações acompanham a duração integral das vozes fornecidas.
- População inicial 24, limite adaptativo entre 12 e 32; spawns graduais e respiros entre hordas. 50/100/150 são testes de QA. Geometria compartilhada, poses por distância, sombras e ragdolls limitados.
- Elites dourados têm defesa/ouro; gigantes multiplicam vida/dano/velocidade por três e tamanho por 1,6; luminosos têm dano e ataque extra. Nem todo parâmetro do gigante é multiplicado por três.

## Mundo e travessia

- Dez volumes fechados de rocha/terra texturizada sob as ilhas, quatro locais e seis distantes; relatório solid-geology.json registra zero arestas não-manifold. Colisão do relevo e navmesh recompostos.
- Cinco ilhotas flutuantes de cenário, dois discos voadores decorativos e uma ilha móvel acessível entre a principal e o posto oeste. Ciclo de 18 s, paradas de 3 s, piso elíptico e transporte do jogador testados. Os inimigos usam as pontes fixas; não embarcam na ilha móvel.
- Cachoeiras com advecção e mistura de textura; poças com reflexo de ambiente e ondulações; vento na esquiva e passos gravados por superfície. Reflexo das poças não é planar.
- Camadas de nuvens abaixo das ilhas e cabo de resgate durante a queda. O retorno usa o último piso fixo seguro e penalidade de vida. Revisão visual ampla do resgate ainda pendente.

## Baús e progressão

- Baú próprio do Blender, oco, com tampa articulada. Cada baú cobra uma vez e sorteia um item ao abrir. A tampa começa a levantar antes da ejeção; o PNG RGBA descreve um arco, cai junto ao baú e permanece girando. E recolhe o item e só então aplica seu efeito. Sem menu de escolha, sem entrega imediata e sem seleção por teclas 1–3.
- O chão do drop é consultado na colisão; posições obstruídas são evitadas. Os itens permanecem até a coleta ou mudança de estágio. O altar também entrega recompensas no mundo.
- 90 PNGs associados a 90 definições jogáveis e sorteáveis. Os 78 itens antes ausentes agora concedem atributos cumulativos; os 12 anteriores mantêm o balanceamento e os hooks de incêndio, explosão e cura por abate. São 90 itens, não 90 tipos diferentes de mecânica. Inventário compacto e catálogo completo no Tab.
- XP, níveis, atributos no Tab, créditos por abate, itens, chefe e fenda. A passagem aumenta o estágio reutilizando o mesmo mapa; ainda não há outro mapa autoral distinto.

## Validação e limites

203 testes em 22 arquivos aprovados; TypeScript e build de produção aprovados. Registros: art/validation-expanded.log e art/build-current.log. O build avisa sobre chunks maiores que 500 kB.

No navegador, baú reforçado abriu e sorteou Mira de precisão: créditos 100 → 55, inventário permaneceu igual até E. Após recolher: ícone entrou uma vez e créditos continuaram em 55. Tampa aberta e transparência do item conferidas. Navegação para celeiro, oeste e leste validada após ajuste dos baús.

Desempenho ainda varia: houve amostras anteriores de 60 FPS com cinco inimigos e 41–60 com 24, mas a revisão recente em Alta chegou a 17 FPS com 14 hostis. Não são medições isoladas nem garantia de 60 FPS. O disco C: voltou a ficar cheio durante testes; uma execução falhou por arquivos temporários ausentes, e a repetição com TEMP/TMP em D: passou inteira. Não atribuir toda queda de FPS ao disco sem perfil.

A referência visual ainda não foi alcançada. Próximos trabalhos: perfil de desempenho em horda, revisão visual de orientação e animações em todos os estados, arma do milho, balanceamento do catálogo e expansão dos mapas e investigação separada de terreno destrutível. Não considerar decal como buraco físico.

## Fontes atuais

- art/blender/Farm_World_Polished.blend + Solid_Island_Geology.blend + Alien_Islets_And_Fruit_Saucer.blend + Interactive_Farm_Chest.blend.
- scripts/build-solid-geology.py, build-alien-world.py, build-interactive-chest.py.
- scripts/restore-original-enemies.mjs + biped-combat-clips.mjs + creature-clips.mjs preservam os originais e acrescentam animações.
- O GLB runtime do jogador inclui a correção posterior de scripts/repair-player-grips.mjs. Gunslinger_Final.blend sozinho ainda não reproduz todos os ajustes finais dos sockets.
- npm usa cache no D:; Iniciar-Jogo.ps1 configura também TEMP/TMP no D:. Não apagar a cópia antiga como parte destas correções.

## Combate, arsenal e cinematográficas — revisão acumulada desta sessão

- Dano recebido: vinheta, indicador direcional, número de HP perdido, barra com atraso, câmera e gravação de impacto destacada. Regeneração espera dois segundos após dano. Conferido no navegador com −25 HP.
- Tiros comuns não interrompem a FSM do inimigo. Impactos fortes podem atordoar por 0,18 s, com intervalo de 0,85 s. Corpos vivos bloqueiam por varredura e deslizamento; o jogador não empurra agentes como um carrinho. Trombadas geram resposta breve.
- Rolar em movimento inicia corrida a 12,6 m/s; parar ou atirar interrompe; salto mantém a corrida. O motor usa velocidade realmente percorrida para as passadas.
- Varredura contínua da cápsula e câmera contra triângulos de cenário, incluindo paredes profundas das ilhas, quinas aéreas e tetos. Recuperação de sobreposição em volumes fechados retorna ao último piso seguro sem curar. Testes usam a geometria real da ilha a −4/−8/−12/−16 m.
- Seis clipes de locomoção novos: recuo e deslocamento lateral à esquerda/direita, andando e correndo. Seleção pela direção local, mistura diagonal, transição de estados; 61 amostras por clipe. Mesh, skin, materiais, texturas e sockets preservados.
- 50 balas compartilhadas pelas duas pistolas; R ou esvaziar inicia recarga de 1,35 s. Armas são lançadas em arco, giram, recebem carregadores e voltam às mãos. A câmera permanece no gameplay; o som gravado entra ao iniciar; habilidades usam sua própria munição de MP.
- Cartuchos reutilizam 48 elementos, sem corpos Havok extras. Som de contato real, dois ressaltos e descarte após cinco segundos. Gravações CC0 e licenças em foley-sources.json.
- Close 3D com preparo heroico durante o grito; câmera retorna ao combate no começo do nome. Base baixa, pernas afastadas, braços abertos; aura turquesa nas pistolas, poeira e fragmentos texturizados. O HUD desaparece durante o close.
- Áudio original preservado: duração real aproximada de 6,034 s / 5,799 s / 5,878 s. Relógio do AudioContext conduz preparo e ação; pausa suspende a voz, uma nova skill não corta a fala anterior. Cues iniciais 1,22 / 1,22 / 1,20 s, estimados por transcrição local; o terceiro tem menor confiança e pode precisar de ajuste fino após escuta humana. Auditoria em skill-voice-audit.json. Não foi feito upload externo desses áudios.
- A sequência normal de MP I tem 48 balas ao longo da atuação; MP II até 48 disparos distribuídos. Os testes diretos sem voz mantêm durações curtas para avaliar balística isoladamente. O mortal físico ocupa a abertura de MP II, seguido da postura de disparo até finalizar a voz.

## Modo de hordas atual

A entrada padrão usa hordas sucessivas no mapa existente. Cada onda contém 7 + 3 × número da onda de inimigos comuns; as ondas 5/10/15… também têm chefe. Spawns respeitam o orçamento de população. Concluir exige todos mortos, ejeta um item aleatório do catálogo no centro, concedido apenas após recolher com E e inicia intervalo de oito segundos. Não há escolha. Baús continuam com a coleta física própria, independente da recompensa da onda.

Vida dos inimigos multiplica por 1,16 a cada onda e dano cresce 12 pontos percentuais por onda. A simulação de dez ondas verificou chefes em 5/10, um prêmio por onda, falhas de spawn sem avanço indevido e limite de população. No navegador: onda 1 concluída, Célula de descarga recebida, onda 2 iniciada; adicionar o catálogo inteiro mostrou a pilha da célula em ×2 e vida máxima em 403 no nível 2.

A expedição com fenda permanece em ?mode=expedition; não foi criado outro mapa. O modo de treino permanece em ?mode=training.

## Arte e revisão

Fonte editável atual do jogador: art/blender/Gunslinger_Directional_And_Skills.blend. Gerador de clipes: scripts/author-directional-animation.mjs, lendo a cópia com grips corrigidos em art/processed/gunslinger-before-directional.glb. O script save-directional-blend.py salva o .blend sem reexportar/destruir o GLB original.

F1 inclui revisão de pose I/II/III e saída da revisão, recarga, conclusão de onda, onda 5 e catálogo de 90 itens. São controles QA, sem efeito numa nova partida. Revisão final do conjunto visual ainda não equivale à referência. Durante esta sessão houve amostras de 36–48 FPS com dez inimigos e 28 FPS logo após dez mortes/ragdolls; posteriormente o navegador de fundo foi limitado a aproximadamente 1 FPS. Essas condições não certificam desempenho sustentado.

## Ritual arcano e biblioteca elemental — 07/09

As durações de áudio anteriormente registradas eram as dos arquivos inteiros. A habilidade agora usa o fim vocal: I 3,40 s; II 3,36 s; III 3,90 s. A liberação continua em 1,22 / 1,22 / 1,20 s. Medição local com transcrição e Silero VAD em docs/skill-voice-vad.json; não houve validação auditiva humana nesta revisão. Um fade de 60 ms encerra a voz, sem alterar pitch. A animação e as emissões usam o mesmo limite. Filas de disparos são descartadas caso um frame atravesse esse limite; tiros já em voo terminam sua trajetória.

O ritual é geometria e animação autoradas no Blender: art/blender/Arcane_Skill_Ritual.blend e public/models/arcane-skill-ritual.glb. Treze camadas, 3.756 triângulos, preparação 0–60 e liberação 60–120, amostragem exportada a 60 Hz e remapeada pelo relógio do áudio. Runas, seis pontas, selos e marcas radiais no chão; condensadores, espirais e descargas nas duas pistolas. Não usa os antigos toros gerados pelo runtime. Três luzes na cor da habilidade (I dourado, II coral, III violeta), emissão com fade e círculo ancorado ao chão da ativação. A câmera procura espaço antes do close e oculta temporariamente folhagem que envolve a lente.

ElementalEffects oferece emit(kind, position, scale), update(dt), clear() e dispose(), com fogo, água, terra, eletricidade, trevas e explosão. Texturas em public/textures/vfx/elemental-atlas.png, prompt e método em docs/elemental-atlas-prompt.txt. O atlas RGBA foi gerado com image_gen integrado; o shader preserva o alpha real e suaviza as bordas. Limite: oito bursts simultâneos, 24 camadas de partículas e 48 gotas/detritos reutilizados. Água usa também gotas PBR com reflexo/refração de ambiente; terra e explosão lançam fragmentos texturizados com gravidade. Não é simulação volumétrica de fluidos, destruição do terreno nem efeito AAA certificado.

F1 contém VFX Fogo / Água / Terra / Eletricidade / Trevas / Explosão e Encerrar prévia VFX. São demonstrações reutilizáveis, sem dano adicional. Eletricidade e terra já complementam o ritual. O fogo também alimenta o ataque incendiário do tomate, seus impactos e queimaduras. Água, trevas e demais combinações continuam disponíveis para futuras habilidades.

O diretor agora repõe inimigos vivos retirados pelo orçamento de performance, impedindo que aposentadoria conte como vitória da horda. A revisão global das referências e desempenho sustentado continuam em aberto.

Correção da revisão: o atlas gerado contém alpha real (RGBA, alpha 0–254). Os blocos eram causados pelo shader ignorar tex.a; agora preserva a transparência. As auras são contínuas e acompanham as duas armas e o corpo. Margem vocal de +0,50 s solicitada após escuta pelo usuário: duração atual I 3,90 s, II 3,86 s, III 4,40 s.

## Multiplayer cooperativo — 07/09

- Servidor autoritativo em Node (`server/`, Colyseus 0.18.5): cliente envia intenção (`NetInput` com `seq`), servidor decide posição, cadência, pente, MP e timeline de skill; estado a 30 Hz, simulação a 60 Hz; rewind anexado aos jogadores para o hitscan da Fase 3.
- Simulação pura (`server/FarmSimulation.ts`) reutiliza `PlayerMotor`, `CollisionWorld` (malha + volumes sólidos, índice de raios ~1,3 s por sala), `IslandFerry`, `PistolMagazine`, `MPCharge`, `SkillTimeline`, `RunProgression`. Sem Babylon.
- Verificado: dois clientes reais pelo SDK veem a mesma posição autoritativa; `seq` repetido é ignorado e dez pacotes de FIRE em 160 ms viram ~3 tiros pela cadência do servidor. 227 testes / 27 arquivos.
- Fases seguintes (docs/MULTIPLAYER.md §8): predição/interpolação no cliente, hitscan com rewind, `EnemySimulation` puro, hordas/diretor, skills sem pausa global, itens/economia atômica, chefe/fenda, reconnect, Playwright e loadtest.
- Fase 2 multiplayer: predição local + reconciliação por seq, remotos interpolados pelo Predict do SDK, `?online=1`. Mira de braço dos remotos desligada (CharacterVisual procura ossos por nome na cena inteira). 232 testes / 28 arquivos.


## Revisão acumulada — ataques, MP, loading e cidade (07/09)

Cópia ativa: D:/Riskodefruta2. A cópia C não recebeu estas alterações.

- Berinjela: preparo de 0,9 s com aviso de trajetória; investida comprometida a 10 m/s durante até 0,95 s, corpo inclinado e ciclo Run sincronizado ao deslocamento. Colisão causa 24 de dano base e impulso 10 uma única vez. Perto do alvo, mordida de 16. O Detour suspende desvio/separação apenas na investida e restaura ao perseguir, sem sair do navmesh. Testes cobrem acerto, esquiva e parede.
- Cenoura original: laser ligado ao RightHand, saída local (0,6,0) no centro da arma da mão robótica, braço acompanha o alvo indicado. Preparo 1,15 s, linha fina, descarga de 24 de dano base e cauda visual de 0,4 s. Raio limitado a 24 m, bloqueado pelo cenário e esquivável. Confirmado visualmente no navegador; texturas e modelagem do inimigo preservadas.
- Caminhada 5,4 m/s; corrida 8,1 m/s (antes 9 e 12,6). Mantidos rolagem seguida de corrida e velocidade de corrida durante salto.
- MP: 100 pontos, custos I/II/III de 25/55/100, regeneração 1,8/s, ganho por impacto de tiro 3,5 e de skill 0,2. Barra sobre a vida, aviso de MP insuficiente. Testes de custo, teto, regeneração e eventos de dano.
- Tiros: canal de cadência próprio do jogador, sem cooldown compartilhado com milho; gravações pré-carregadas no menu e decodificadas após gesto. Teste comprova som para cada disparo consecutivo após ataque do milho. Qualidade auditiva subjetiva ainda depende de escuta; não foi certificado sincronismo audiovisual em todas as taxas de quadros.
- Skills I/II: volumes de acerto ampliados em 0,65/0,85 m e barragem com dispersão reduzida; visibilidade até o volume real impede a tolerância de atingir através de cobertura fina. MP I continua em leque livre, sem target lock.
- Ritual: cores por habilidade, duas camadas extras com contra-rotação no III. A aura usa menos camadas e menor escala/opacidade para não esconder o personagem. Limite de quatro luzes por material evita falha de shader/UBO que deixava o personagem invisível. O jogador usa skinning CPU com limites ativos conservadores.
- Loading: filme 3D independente renderizado no Blender, 120 quadros/30 FPS/4 s, H264 960×540; personagem mergulha de cabeça em loop. Vídeo começa no HTML inicial, é reutilizado no menu e pausa ao jogar. Mapa, equipamentos e navmesh carregam por trás; Play aguarda preparação dos materiais. Fonte: art/blender/Independent_Cosmic_Loading.blend. Entrada como meteoro de 1,8 s com impacto, terra e marca de rachadura; não escava o terreno de verdade.
- Cidade: três ilhas largas adicionais, celeiros 1,65×, silos altos, plantações, mercados e quatro pontes. Fonte: art/blender/Agricultural_City.blend. Colisão das estruturas extraída da malha; encontro da ponte norte corrigido e navmesh ampliado. Seis testes de travessia/rotas completos. O desenho visual ainda não equivale às referências; os novos distritos não têm conteúdo de exploração completo.
- Tomate: brilho de carga sem alterar escala, chama texturizada em voo, explosão, fogo temporário no chão e queimadura no jogador. Poças são conformadas à malha a +0,045 m, com reflexão planar de orçamento limitado. Realismo visual desses materiais continua em refinamento.
- Disparo básico: clipes Fire_R/Fire_L com recuperação de braços/tronco; fonte atualizada em Gunslinger_Directional_And_Skills.blend. Hordas concedem recompensa somente pela coleta do item no chão. Falas encerram em 3,90 / 3,86 / 4,40 s, incluindo a margem de meio segundo solicitada.

Validação desta revisão: 249 testes em 30 arquivos aprovados (art/tests-current.log), incluindo os 90 itens, áudio por disparo, combate real no Detour, colisões e progressão. Build e TypeScript registrados em art/build-current.log; servidor em art/server-typecheck-current.log. Revisão no navegador: loading até 100%, personagem visível, MP, laser na mão direita e ritual III. Houve amostras próximas de 21–32 FPS na GTX 1650 durante QA; 60 FPS sustentados e equivalência visual com as referências permanecem pendentes.

## Continuidade e expansão — checkpoint validado em 07/09

Trabalho exclusivo em D:/Riskodefruta2. Meta de expansão ativa e heartbeat único a cada 30 minutos. WORLD_EXPANSION.md contém plano, evidência, limites e próximos passos.

Novos recursos: carregador de regiões com orçamento/cancelamento e integração inicial da cidade, culling de detalhes com histerese, nove baús físicos exploráveis e spawns em torno da região do jogador. Colisões dos baús compartilhadas com servidor e navmesh; inimigos contornam os obstáculos. 260 testes / 32 arquivos, build e tipos do servidor aprovados. Sessão limpa de navegador chegou a 100%, personagem visível, cidade e interação do baú revisadas. Compra/coleta de todos os novos baús e desempenho sustentado ainda não certificados.

Referência congelada: 8.416,6403 m²; alvo 25×: 210.416,0081 m². Área conectada após descontar novos obstáculos: 8.371,2004 m². A expansão de 25× NÃO está concluída. Os módulos de infraestrutura não equivalem a múltiplos biomas entregues. Não há certificação de equivalência visual ou 60 FPS.

## Fronteira Solar e colisão regional — 07/09

Duas novas ilhas navegáveis, Pomar dos Ventos e Porto dos Grãos; seis novos baús, três trechos de ponte incluindo o patamar corrigido. Área total conectada 20.473,6790 m² (2,43× a referência; alvo 25× ainda aberto). Fontes Blender, GLB texturizado, colisões e navegação no projeto D. Cliente e servidor enxergam o chão e os obstáculos novos.

275 testes / 34 arquivos, build e tipos do servidor aprovados; ver WORLD_EXPANSION.md para logs, revisão visual e limites. Região física agora tem ciclo de vida independente, mas as duas regiões ficam residentes desde o loading e o navmesh/Havok ainda precisam ser particionados. Não há certificação de 60 FPS ou equivalência à referência visual.

## Havok regional e proteção de ocupação

281 testes / 35 arquivos e build aprovados. Terrenos Havok da cidade/fronteira agora têm ciclo de vida independente e inicialização única do motor por cena. Retenção do RegionResidency ligada a jogador, inimigos ativos e ragdolls; validação real de Havok confirma queda apenas na região removida. Navegador chegou a 100% e confirmou ragdoll ativo no porto. Evidências e limitações em WORLD_EXPANSION.md.

Streaming por distância continua pendente: remover referências centrais de apresentação, selecionar recursos por proximidade, bloquear passagens para destinos não prontos e particionar navmesh. Área permanece 20.473,6790 m², longe da meta 25×; não declarar conclusão global.

## Streaming espacial solo integrado

Regiões solicitadas por proximidade (110 m para carregar / 155 m para liberar), mantendo as ocupadas por atores e ragdolls. Apresentação e física são descartadas junto com o container. Passagens sinalizadas bloqueiam entrada em destinos não prontos; viagens QA aguardam a carga. Ciclo real de carga/saída/descarte confirmado no navegador. 286 testes / 36 arquivos e build aprovados. Cooperativo permanece pré-carregado até implementar confirmação de prontidão com o servidor. Detalhes, evidências e limitações em WORLD_EXPANSION.md.


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

Revisão final da horda QA nas estufas: inimigos nasceram ao redor da posição visitada, perseguiram o personagem e dispararam; screenshot em sessão CUA. Persistem sobreposição de rótulos/telegráficos e orientação visual de alguns inimigos a revisar. O diretor foi pausado pelo próprio controle QA, por isso o cabeçalho permaneceu PREPARE-SE; não usar esta cena como prova do fluxo normal da horda.


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

Vista limpa final dos Campos Altos revisada no navegador após retomar a simulação: câmera para leste, relevo contínuo, cultivos no solo e celeiro ampliado presentes; HUD Campos Altos 0/2 e 0/9 contratos. A paisagem ainda está esparsa e sem sombras/variedade suficientes para equivaler às referências. Pausa congela HUD e culling até retomar; a primeira captura pausada não foi usada como prova de apresentação final.


### Sombras acompanhando a exploração — 8 setembro
- Volume direcional acompanha a câmera, alinhado aos texels para reduzir deslocamento instável das sombras. Seleção por distância aos limites mundiais das malhas, com histerese, atualização a cada 0,25 s e descarte por proprietário.
- Aplicado às regiões e às ilhas iniciais; removida a restrição de projetores ao redor da origem. Limites por contêiner são contagem de malhas, não orçamento comprovado de triângulos/VRAM.
- 327 testes / 45 arquivos aprovados (art/tests-following-shadows-full.log); build aprovado (art/build-following-shadows-final.log). Aviso de bundle grande permanece.
- Revisão visual das novas sombras pendente: ferramenta de inspeção do navegador indisponível nesta retomada. Não alegar ganho de FPS ou equivalência artística às referências. Área permanece 122.560,5037 m² / 14,561690×.


### Recompensas regionais e apoio do personagem — 8 setembro
- Horda entrega item aleatório físico no campo mais próximo, com piso/espaço de coleta verificados. Se não houver piso disponível, aguarda sem consumir o sorteio nem a recompensa pendente; retentativa limitada a uma por segundo. Guia de direção/distância permanece até coleta.
- Dez campos testados com colisão e navmesh reais, incluindo os planaltos; sem inventário automático.
- Reproduzidos dois defeitos de locomoção: 64 quadros sem apoio em descida de oito degraus; pouso sobre triângulo inclinado permanecia airborne. Controlador agora acompanha descidas até a altura de degrau e reconhece contato da cápsula arredondada com rampas caminháveis. Bordas altas continuam queda; paredes/tetos continuam bloqueando. Não afirmar cobertura de todo asset individual.
- Pena orbital concede +1 pulo aéreo por unidade, sem aumentar altura; cargas renovadas no chão/retorno seguro. Outros itens de altura permanecem independentes. Cliente/servidor e HUD de atributos atualizados.
- 339 testes / 48 arquivos aprovados: art/tests-ground-feather-rewards-full.log. Build art/build-ground-feather-rewards-final.log e server:typecheck art/server-typecheck-ground-feather.log aprovados. Dois erros de tipagem em testes encontrados nos builds intermediários e corrigidos; logs finais são a evidência de aprovação.
- Revisão visual pendente por indisponibilidade de ferramenta de navegador. Os relatos de trilhas, entrada orbital/loading e morte/reinício permanecem na fila; morte/reinício em andamento.


### Derrota e nova tentativa sem recarga solo — 8 setembro
- PlayerHUD passa a usar apresentação de derrota própria, sem filme/barra de loading: VOCÊ MORREU, horda alcançada/vencidas, abates, tempo, nível, créditos e todos os itens com ícone/quantidade. Resumo copia a tentativa antes do reset. Layout responsivo definido, mas não revisado no navegador nesta sessão.
- Tentar novamente no modo solo mantém cena, cenário, colisão, navmesh, modelos e pools. Reinicia progressão, baús/contratos/drops, diretor/inimigos/projéteis, vida, MP, munição 50, contadores, poses e habilidades; sem location.reload nesse fluxo. O botão de continuar após pausar volta ao handler normal, não reinicia outra vez.
- O reinício cooperativo e o botão Nova expedição continuam usando reconexão/recarregamento; não afirmar reinício autoritativo de rede implementado. A tentativa reutiliza o mapa, sem promessa de repetir exatamente os mesmos sorteios da anterior.
- 341 testes / 49 arquivos aprovados em art/tests-attempt-retry-full.log; build art/build-attempt-retry-final.log e servidor art/server-typecheck-attempt-retry.log aprovados. Teste novo preserva resumo após reset e percorre cinco resets de armas com mesmo pool/contagem de meshes; não substitui teste manual do fluxo completo de morte.
- Próximos: revisão visual da derrota/reinício; mergulho de cabeça coerente no loading e entrada contínua espaço/órbita/mapa; trilhas legíveis, assets de colisão relatados e expansão 25× continuam abertos.
- Revisão offline de art/loading-loop/cinematic-preview.png mostrou personagem diagonal de costas, ilhas projetadas para o lado dos pés. scripts/render-loading-film.py aplica roll de câmera de 180 graus; corrigir composição e postura em fonte Blender, não apenas aumentar tempo da chegada. Nenhum asset de loading foi alterado nesta etapa.


### Loading de cabeça — revisão Blender integrada em 12 setembro
- Retomada confirmou render anterior encerrado e nenhum Blender ativo; a última etapa produziu progresso verificável. Leitura/edição no disco D exigiu execução aprovada devido à mudança de sandbox, sem bloqueio permanente.
- Cena salva tinha Headfirst_Dive com rotação -pi/2 e cabeça apontando no sentido oposto às ilhas. Recriados keyframes com +pi/2 e oscilações menores; câmera sem roll de 180 graus, destino enquadrado pelos limites reais das três ilhas. Primeiras composições com destino recortado foram rejeitadas antes da integração.
- Fontes: scripts/reframe-loading-dive.py, scripts/render-headfirst-loop.py, scripts/encode-headfirst-loop.py e art/blender/Headfirst_Loading_Review.blend. Original Independent_Cosmic_Loading.blend e vídeo antigo preservados.
- index.html e PlayerHUD usam public/ui/cosmic-descent-v2.mp4 e loading-poster-v2.jpg. Vídeo independente do carregamento do mapa em runtime: 1280×720, 30 FPS, 120 quadros decodificados, 4 segundos, 481.240 bytes. docs/loading-headfirst-validation.json e art/loading-headfirst-encode.log.
- Quadros 1, 60 e 120 revisados offline: cabeça segue para o destino, botas atrás, três ilhas visíveis e espaço esquerdo para o menu. Aparência ainda não equivale às referências; não afirmar loop sem qualquer emenda, 60 FPS de gameplay ou transição orbital concluída.
- Build aprovado: art/build-headfirst-loop.log; avisos de bundle >500 KB e duração de plugins continuam. Suíte completa mais recente permanece 341 testes / 49 arquivos; alteração de vídeo/URLs validada por decodificação integral e build, sem repetir testes de gameplay inalterado.
- Tentativa anterior de revisão via computer-use expirou em autorização da janela: Computer Use app approval timed out. Não houve revisão da derrota/reinício no navegador. Não é rejeição automática de edição do projeto.
- Próxima etapa: transição contínua entre filme/menu e entrada no mapa (espaço, aproximação, pouso), sem substituir a meta por apenas uma chegada de 22 m. Trilhas, colisões específicas, revisão visual e expansão de 14,561690× até 25× permanecem abertas.


### Aproximação aérea contínua e revelação do mapa — 12 setembro
- MeteorArrival substitui a chegada de 22 m/1,8 s por trajetória Hermite: 900 → 300 → 30 → 0 m, descida de 4 s e recuperação de 0,8 s. Deslocamento horizontal proporcional à altura aproxima o personagem do ponto real de pouso. Motor/colisão e diretor permanecem bloqueados na entrada. Isto é aproximação aérea, não prova de uma órbita planetária completa.
- Personagem, câmera e aura usam a mesma posição da trajetória. Corrigida câmera que antes mirava no chão enquanto root do personagem estava elevado. Raiz visual inclina para mergulho e volta à vertical abaixo de 30 m; ainda utiliza clips existentes de pulo/pouso, com revisão artística de pose pendente. Impacto usa o ponto físico de pouso e ocorre uma única vez.
- Filme do loading permanece brevemente sobre a cena, revelando o mapa em 0,85 s ao iniciar; camada sem controles interativos durante a revelação. Estado playActive evita esconder o menu ao pausar durante essa abertura. Escape/retomada e composição final ainda precisam de teste visual no navegador.
- 344 testes / 50 arquivos aprovados (art/tests-arrival-flight-full.log), build aprovado (art/build-arrival-flight-final.log). Oito testes direcionados cobrem trajetória monotônica/continuidade, pausa/valores inválidos, impacto único, posição do root real sem mover o motor e regressões de reinício/incêndio. O fixture de posição não carrega clips; não valida qualidade da animação.
- Aviso de bundle >500 KB permanece. Nenhuma medição nova de FPS, equivalência artística ou revisão visual do runtime nesta etapa.
- Próximo: revisão visual da aproximação e do menu/pausa, pose de mergulho dedicada e sequência espacial/atmosférica coerente. Trilhas/colisões específicas e expansão física até 25× continuam abertas; área não mudou (122.560,5037 m² / 14,561690×).


### Visibilidade durante a aproximação — 12 setembro
- Reproduzida falha com mundo pausado: câmera descia de 900 m mas vegetação/LOD permaneciam na seleção inicial. Teste antes da correção falhou em art/tests-arrival-visibility-before.log.
- ViewUpdateGate permite reavaliar detalhe, coroas de árvores e casters após 12 m de deslocamento acumulado da câmera, independentemente do relógio da simulação. Visão estacionária mantém intervalo de 0,25 s; posição anterior é copiada, valores de tempo inválidos ignorados. Não retoma inimigos ou física na entrada.
- 15 testes direcionados aprovados em art/tests-arrival-visibility-after.log (entrada, sombras, regiões, escadas/pouso). Outros 13 aprovados em art/tests-arrival-and-run-regressions.log (inclui um teste repetido de visibilidade): pena, reinício, recompensas e cadência visual. Build aprovado em art/build-arrival-visibility.log; aviso de bundle >500 KB permanece.
- Teste integrado usa meshes Babylon reais em NullEngine: altitude oculta detalhe, aproximação restaura medium/near, vegetação e caster, afastamento remove. Não equivale a revisão visual em navegador nem medição de FPS.
- Pendências preservadas: colisões específicas/trilhas, revisão visual da morte/reinício e chegada, pose dedicada/orbita completa, expansão física 25×. Nenhuma área adicionada nesta etapa.


### Trilhas dos planaltos — 12 setembro
- Onze trajetos autorados em docs/highland-trails.json conectam entradas de pontes, praça, celeiro e suprimentos dos três planaltos. Teste usa PlayerMotor e CollisionWorld reais, em ida/volta sem pular, exigindo chegada sem respawn ou recuperação de penetração. A primeira rede de nove rotas passou; a revisão visual identificou falta de acesso ao celeiro e baú dos moinhos, adicionados e testados.
- scripts/author-highland-trails.py projeta uma malha contínua sobre triângulos reais do terreno, 5,5 cm acima da superfície; textura/normal brown_mud_02 com bordas de alpha por vértice e UV mundial. Não adiciona piso físico, não cobre vazios; colisão/navmesh preservados. Removidas somente 28 samambaias sem colisão que encobriam caminhos. Objetos sólidos e assets originais preservados.
- Fonte nova art/blender/Highland_Farms_Trails.blend preserva Highland_Farms.blend original. GLB residente atualizado: 51.693.864 bytes, trilha em uma malha com 23.772 triângulos. Executar author-highland-trails.py após alterações de terreno/landings, depois build-highland-distant.py (agora usa a fonte com trilhas).
- Corrigida exportação distante que propagava COLOR_0 para materiais opacos ao juntar tudo: trilha permanece separada; auditoria dos dois GLBs confirma transparência só na trilha, textura de cor e normal. Proxy: duas malhas, 73.344 triângulos, 6.291.744 bytes, texturas até 512. Isto aumenta geometria/proxy; não afirmar ganho de FPS. Trilhas não ocupam seleção limitada de casters.
- Visão geral offline renderizada e revisada em art/highland-trails-overview.png: rede visível, acesso do celeiro integrado, destinos conectados. Campo ainda esparso e distante da riqueza das referências; falta revisão em câmera de gameplay e possível ajuste de contraste/material. Render Blender não prova visual do Babylon.
- 29 testes / quatro arquivos aprovados em art/tests-highland-trails-final.log; build aprovado art/build-highland-trails.log, aviso de bundle >500 KB permanece. Auditoria docs/highland-trails-export-validation.json e docs/highland-trails-authoring.json. Nenhuma nova área: 122.560,5037 m² conectados / 14,561690×; meta 25× intacta.
- Próximos: trilhas/acessos das regiões anteriores, revisão visual no jogo, densidade e composição dos biomas, restantes 87.855,5044 m² conectados. Colisões específicas relatadas, órbita/apresentação, combate, persistência e restante da fila continuam abertos.


### Revisão no navegador e custo por etapa — 12 setembro
- Servidor D estava parado (conexão recusada). Iniciado npm run dev em 127.0.0.1:5173 com TEMP/TMP no D. Navegador in-app abriu seed trail-review; menu mostrou filme de mergulho, progresso 25/50/100 e botão jogar pronto. Qualidade artística ainda distante das referências; não foi capturada a sequência inteira de aproximação.
- Screenshot de gameplay após chegada confirma personagem visível, MP 100, munição 50, vegetação e cenário. Morte pela horda mostrou VOCÊ MORREU, resumo (horda 1, zero abates, 30 s) e estado sem itens; TENTAR NOVAMENTE · MAPA PRONTO voltou ao gameplay com contadores zerados sem barra do carregamento inicial. Não foi validado layout com 90 itens, nem pause/continue completo.
- Visita QA aos planaltos confirmou trilha texturizada visível e aderida ao relevo à frente do personagem, acesso ao celeiro na esquerda e plantas fora do corredor. Não houve travessia manual de todos os 11 caminhos; os testes físicos anteriores cobrem ida/volta. Capturas foram exibidas pela ferramenta nesta conversa, não arquivadas em PNG nesta etapa.
- Amostras não controladas na GTX 1650/WebGL2: 24–30 FPS na primeira passagem; após atualização do diagnóstico, 40 FPS / simulação 0,38 ms por quadro / apresentação 17,97 ms por quadro / GPU 8,67 ms, uma entidade inimiga. Compilação de shaders, recarga, chamadas da ferramenta e população variaram; não usar como comparação antes/depois nem prova de ganho.
- Application agora mede tempo de todos os passos fixos por quadro e render total (incluindo preparação visual), com média por janela de pelo menos 500 ms. Diagnóstico separa Simulação CPU / Apresentação CPU / Cena Babylon. O contador antigo Frame CPU era somente frameTimeCounter do Babylon e não cobria toda lógica. GPU é medida separada e não deve ser somada ingenuamente aos tempos CPU.
- 11 testes de fundamento/loop aprovados art/tests-workload-diagnostics.log; build aprovado art/build-workload-diagnostics.log. Instrumentação não altera passo fixo ou limites, não constitui otimização de FPS. Próximo perfil deve separar animação, atualização visual e renderização com população/posição constantes.
- Limitação da ferramenta: ação por índice dinâmico acabou acionando Receber item (QA), observada pelo Podador ×1/100 créditos; não considerar essa rodada uma baseline pura. Tentativa por locator seguida de screenshot retornou aba fora da sessão, e listTabs confirmou lista vazia. Revisão não continuou por outro canal e não há estado de aba a preservar. Nenhuma falha de jogo inferida da perda da aba.
- Área permanece 122.560,5037 m² / 14,561690×. Expansão 25×, biomas, densidade, perfil controlado, colisões específicas e restante da fila permanecem abertos.


### Região Rootwood — autoria em andamento, 12 setembro
- scripts/build-rootwood-region.py cria três ilhas sólidas (Bosque da Colheita, Ruínas do Engenho, Terraços das Sementes), bosque texturizado com corredores livres, construções e quatro pontes em circuito. Fonte planejada art/blender/Rootwood_Region.blend e saídas art/rootwood-staging/, separadas do jogo até validação.
- Blender iniciado com TEMP/TMP no D, sessão de execução 66447, PID 25112. Última observação nesta etapa: processo vivo, CPU acumulada 163,95 s / cerca de 670 MB; log art/rootwood-authoring.log registra as três ilhas construídas, ainda sem exportação final. Não reiniciar por falta de linhas: verificar o mesmo handle/processo. Sem processo duplicado iniciado.
- Validador preparado em scripts/validate-rootwood-traversal.mts: carrega colisão dos planaltos + staging, testa quatro pontes e seis trajetos em ambos sentidos com PlayerMotor real; grava art/rootwood-traversal.json. Executar somente após exportação concluída. Render separado scripts/render-rootwood-review.py, ainda não executado.
- Próximo: esperar processo vivo finalizar, inspecionar log/arquivos, executar validador físico, corrigir conexões, renderizar/revisar, adicionar trilhas e recompensas, integrar catálogo/servidor/barreiras/navmesh e medir desde o spawn. Nenhuma área nova contabilizada: 14,561690× ainda é a medição válida.
- Novo pedido recebido de tarefa de voz: reação dramática ao golpe fatal antes da derrota, com sofrimento/impacto ressoando e opções Renascer/Voltar ao menu. Registrado na OBJECTIVES_QUEUE; PlayerScene.on(PlayerKilled) atualmente encerra imediatamente e PlayerHUD.defeated possui reinício em memória. Implementação dessa sequência ainda pendente.
- Tentativa de enviar atualização à tarefa de origem 01a098aa-ead5-72b0-82a0-40663d68632e foi rejeitada pela revisão automática por falta de autorização explícita para divulgar detalhes internos/caminho do projeto ao destino. Não reenviada nem contornada; trabalho local não bloqueado.


### Rootwood — pontes corrigidas e copas preservadas, 13 setembro
- Processo de autoria anterior terminou com ROOTWOOD STAGING COMPLETE; sessão 66447 encerrada, sem reinício duplicado. GLB e colisão estão em art/rootwood-staging, não em catálogo de runtime.
- Primeira validação física encontrou quatro falhas: entrada na pedra dos planaltos e chegadas sob falésias em duas pontes. scripts/fix-rootwood-landings.py desloca a entrada para (797,342), eleva patamares antes das bordas, transforma madeira e caixas correspondentes e rebakeia colisão. Fonte original preservada; fonte corrigida Rootwood_Region_Landings.blend. Executar depois de build-rootwood-region.py, antes de árvores.
- scripts/validate-rootwood-traversal.mts passou 24 percursos: seis segmentos de ponte e seis caminhos, ambos sentidos, sem respawn/recuperação e chegada com erro menor que 0,5 m. Evidência art/rootwood-traversal.json e art/rootwood-traversal-final.log. A primeira falha está em art/rootwood-traversal.log. Isso não valida ainda navmesh global ou todos os obstáculos fora das rotas.
- Render inicial mostrou copas destruídas por decimação do kit. Corrigido por scripts/install-rootwood-trees.py: 300 âncoras com seis geometrias compartilhadas de Orchard_Tree_LODs, mantendo troncos/colliders. Fonte final de arte art/blender/Rootwood_Region_Trees.blend; GLB staging 59.528.444 bytes. Ajustar distâncias de LOD/proxy antes de integrar 300 árvores; não presumir bom FPS.
- art/rootwood-overview.png revisado após a troca: copas presentes, corredores e construções separados, circuito de pontes visível. Ainda faltam trilhas texturizadas, refinamento/diferenciação artística, recompensas/contratos, catálogo/região/servidor, barreira de entrada, navegação global, perfil de desempenho e revisão em gameplay. Fonte/render em scripts/render-rootwood-review.py; Blender finalizado, sem jobs de autoria ativos.
- Build da versão jogável aprovado art/build-rootwood-staging-checkpoint.log, com aviso >500 KB. Não significa integração da região: área válida segue 122.560,5037 m² / 14,561690×. Não contar geometria staging/decorativa para meta 25×.
- Próxima tarefa imediata da fila: implementar morte dramática antes de Renascer/Voltar ao menu, agora que autoria/correção física chegou a checkpoint. Depois retomar integração/conteúdo dos pomares e demais pendências. Pedido de origem voltou a solicitar andamento; envio permanece sem autorização após rejeição anterior, nenhuma nova tentativa feita. Desenvolvimento local sem bloqueio.


### Bordas de objetos e morte com arremesso — 13 setembro
- Reproduzida suspensão a 2 m do chão em duas posições fora da borda/canto de um prop. AABB expandida criava apoio quadrado invisível; substituído somente narrow phase aéreo por distância cápsula/caixa com avanço conservador. Broad phase mantida. Antes: dois testes falharam; depois: 22 testes de bordas, escadas, malha, regiões e pena passaram. Evidências art/tests-prop-edge-before.log e art/tests-prop-edge-after.log. Não prova correção de todos os assets/locais relatados.
- Fluxo de derrota revisado no navegador: reação antes de VOCÊ MORREU, resumo, RENASCER e VOLTAR AO MENU; retorno ao menu mantém 100% pronto; renascimento restaura HP/MP/munição e contadores sem recarga de página. Revisão com inventário extenso continua pendente; coop ainda tem fallback de reload.
- Pedido novo explícito: personagem voando e gritando de costas na morte. DeathFlight projeta para trás com impulso vertical, subpassos e colisão real, isolado do motor vivo; câmera acompanha posição visual. FinalDeath tem 169 quadros / 2,8 s, tronco inclinando para trás e braços reagindo. Primeira inspeção visual revelou inclinação invertida; corrigido eixo e auditoria do modelo importado agora exige cabeça atrás da bacia. art/death-flight-authoring.log, scripts/inspect-death-facing.mjs.
- HaelDB, Male Grunt/Yelling sounds (OpenGameArt, CC0), arquivo original 1yell11.wav de 2 s, sem síntese, incluído como player-death-scream.wav. Reprodução 0,95 e atraso 0,08 s: termina antes dos 2,8 s da reação. Origem em docs/foley-sources.json. Balanceamento auditivo final no jogo ainda precisa de revisão.
- Auditoria docs/death-animation-audit.json confirma geometria, materiais, rig e 25 clipes anteriores preservados. Voo/pouso, parede, pausa, reinício e proxies: 12 testes aprovados art/tests-death-flight.log. Build aprovado art/build-death-flight.log (aviso bundle >500 KB).
- Suíte ampla encontrou um teste antigo que exigia uma única malha de proxy, anterior à separação da trilha transparente. Teste atualizado para manter até oito lotes opacos, mais uma trilha nos planaltos, validar COLOR_0 restrito à trilha e orçamento explícito 75 mil triângulos/6,5 MB. Outros proxies mantêm orçamento anterior. Rodada final pendente.
- Fila anterior intacta: colisões específicas e demais trilhas, chegada orbital, revisão de morte após a correção do eixo, Rootwood ainda staging, área 14,561690×; meta 25× não concluída.

- Fechamento dos testes: rodada completa 365 testes teve 352 aprovados e 13 timeouts de 5 s em dois arquivos, sem assertion funcional. Repetidos os dois arquivos com um worker/timeout 30 s após fechar a aba QA: net-simulation 7/7 (art/tests-death-flight-recheck.log; filtro highland-world não correspondeu a arquivo e não foi contado); highland-traversal 15/15 (art/tests-death-flight-highlands.log). Todos os 365 casos têm resultado aprovado entre rodada completa e repetições. Não é medição de FPS.
- Removidos textos de gameplay durante reação fatal. AbyssPresentation deixa de exibir resgate quando o contador de retornos diminui no reinício e esconde véu/cabo com HP zero.


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

## 13/09/2026 — Horizonte planetário e fechamento da integração Rootwood
- Inclinação visual da câmera por posição e direção de observação; raio visual 2400 m, limite de 4 graus, velocidade máxima 2 graus/s, suavização de 1,4 s e atenuação ao olhar verticalmente. Mira e terreno permanecem em coordenadas do mundo; closes de habilidades mantêm sua composição.
- Testes: 8/8 em planetary-horizon e city-traversal. A execução completa anterior passou 367/368; a única falha era a contagem antiga de rotas (35 em vez de 44), corrigida e revalidada neste teste direcionado. Não foi repetida a suíte inteira depois dessa correção.
- Build final e verificação TypeScript do servidor passaram. Aviso conhecido de bundle acima de 500 kB permanece.
- Rootwood integrado: 222945,84386181 m² conectados, 26,488698 vezes a base congelada; 44 rotas de navegação e 42 travessias físicas verificadas. A expansão visual, a densidade e o desempenho ainda precisam de refinamento; isso não encerra o objetivo global.
- Evidências: art/tests-rootwood-camera-final.log, art/build-rootwood-camera-final.log, art/server-rootwood-camera-final.log, docs/world-measurement.json.
- A câmera passou validação automatizada de limites, sentido, transições e taxas de quadros; a avaliação visual deste novo efeito em jogo permanece pendente.

## 13/09/2026 — Pavilhões do bosque sustentados
- Revisão da geometria encontrou quatro pilares entre 0,96 m e 4,27 m abaixo dos telhados. Corrigidos no Blender e nas malhas de colisão; seis travessas adicionadas com colisão para câmera/projéteis, acima das rotas de circulação.
- Fonte editável: art/blender/Rootwood_Region_Pavilions.blend. Script reproduzível scripts/fix-rootwood-pavilions.py usa baseline preservada rootwood-before-pavilions-collision.json. Modelos detalhado/distante e colisão integrados em public/models.
- Proxy distante: 2 meshes, 54583 triângulos, 5498400 bytes. Vegetação distante/impostores ainda pendentes; não aumentar o orçamento de árvores antes de medir o custo.
- Evidência: docs/rootwood-pavilion-repair.json; 42/42 travessias físicas; 13/13 testes direcionados; 44 rotas globais após regeneração via tsx. Área conectada manteve 222945,84386181 m² (26,488698×). Build aprovado com aviso conhecido de tamanho de bundle.
- Revisão visual no navegador: bosque em posição 883/31,2/355, personagem, trilha, baú, pilares e travessas visíveis; inclinação suave do horizonte perceptível. Captura na conversa, não arquivada em arquivo. Ainda faltam giro completo/combate para validar conforto da câmera.
- Avaliação visual: cenário ainda esparso, coberturas finas e vegetação distante descontínua. Os apoios melhoraram, mas esta entrega não equivale à fidelidade visual pedida. Próximo foco: copas distantes eficientes, identidade/densidade de cada praça e revestimento das construções.
- Logs: art/rootwood-pavilions.log, art/rootwood-pavilions-distant.log, art/rootwood-pavilions-traversal.log, art/tests-rootwood-pavilions.log, art/rootwood-pavilions-navigation.log, art/rootwood-pavilions-measurement.log, art/build-rootwood-pavilions.log.

## 13/09/2026 — Copas distantes com textura da árvore original
- Nova textura RGBA 512×512, 357580 bytes, renderizada no Blender a partir do LOD próximo da árvore original. Fonte e dimensões em docs/far-canopy-bake.json; script scripts/bake-far-canopy.py; textura public/textures/orchard-canopy-far.png.
- FarCanopies desenha as árvores que perderam prioridade de detalhe em um lote de thin instances: uma malha de quatro vértices, até 300 instâncias/600 triângulos, uma chamada por passe. Matrizes reutilizadas, limites espaciais atualizados e descarte ao liberar a região. Sem colisão, picking ou sombras adicionais.
- Integração opt-in em Rootwood. Near/medium mantêm seus limites 3/20; a representação distante fica exclusiva das árvores ocultadas pelo orçamento ou alcance e limitada a 550 m. Não modifica textura/modelagem dos inimigos ou árvores próximas.
- Validação: 4/4 testes em far-canopies e orchard-lods, typecheck e build aprovados. Teste cobre lote único com 277 copas, exclusão das 23 detalhadas, posições, limites, descarte e reentrada no alcance. Não representa benchmark gráfico.
- Revisão no navegador na posição 883/31,1/355: linha de árvores agora preenche os espaços vazios do horizonte, próximas continuam detalhadas; captura na conversa. Amostra sem combate no menu regional: 47 FPS, 76 draw calls, 696550 triângulos; após entrada, 39 FPS e 77 draw calls. Amostras sem protocolo controlado, não demonstram ganho comparativo nem garantem 60 FPS.
- Pendências: balancear iluminação da captura distante (tronco escuro), revisar trocas em movimento e copas das regiões ainda não residentes. O proxy distante do bioma continua sem a floresta; a entrega atual cobre Rootwood residente. Próximo trabalho deve estender continuidade ao streaming e enriquecer as praças/construções.
- Evidências: art/far-canopy-bake.log, art/far-canopy-typecheck.log, art/tests-far-canopies.log, art/build-far-canopies.log.

## 13/09/2026 — Copas no proxy regional e novos pedidos
- Exportadas 300 posições diretamente das árvores de Rootwood_Region_Pavilions.blend para public/models/rootwood-canopies.json, sem inventar novas colocações. DistantRegions mantém um lote de copas enquanto Rootwood não está residente; oculta e suspende atualização quando o detalhado assume, restaura ao descarregar, e libera recursos inclusive em respostas tardias.
- FarCanopies agora alcança 1100 m, compatível com horizonte distante da câmera. Textura rebake com iluminação ambiente 1,15 para reduzir o tronco excessivamente escuro; render RGBA revisado.
- Testes: 12/12 em distant-regions, far-canopies e orchard-lods. Incluem correspondência dos 300 IDs com GLB, limites das colocações, exclusão entre proxy/detalhado e interrupção de atualizações após descarte. Typecheck/build aprovados; aviso conhecido de bundle permanece.
- Revisão de gameplay nos planaltos com Rootwood não residente: partida e proxies sem erro aparente; a encosta/celeiro ocultam o bosque desse ponto. Portanto, a transição de copas em aproximação contínua ainda não foi comprovada visualmente. Não declarar essa revisão completa.
- Logs: art/rootwood-canopy-placements.log, art/far-canopy-lighting.log, art/canopy-streaming-typecheck.log, art/tests-canopy-streaming.log, art/build-canopy-streaming.log.
- Próxima prioridade do usuário: continuidade do loading para queda mantendo pose, esconder somente interface, impacto de cabeça e levantar. Em seguida recarga andando/correndo com pernas e braços independentes.
- Diagnóstico inicial dessas próximas correções: CharacterVisual.ts linha de arrival usa Jump/Land e reduz rotação conforme dive perto do chão, causando giro antecipado; MeteorArrival.dive suaviza abaixo de 30 m. PlayerScene.ts cancela sprint ao recarregar e fornece EMPTY_INPUT enquanto magazine.reloading; CharacterVisual usa ReloadCast de corpo inteiro com retorno antecipado. Nenhum desses comportamentos foi corrigido ainda nesta entrega.

## 13/09/2026 — Menu com o mesmo personagem 3D e chegada invertida
- Corrigida a causa do corte: assim que personagem/pistolas ficam prontos, o menu passa a mostrar o personagem real da cena a 900 m, ainda durante carregamento do mapa (captura revisada em 62%). O vídeo independente continua disponível antes desses recursos; o botão Jogar continua bloqueado até preparação completa.
- Ao jogar, sai apenas a interface: ator/câmera/pose permanecem, incluindo fase do balanço. Removido fade do vídeo sobre uma segunda pose. Corrigida regra CSS antiga que escondia canvas durante menu. Pré-queda e gameplay usam a mesma instância do personagem e da câmera.
- Inclinação agora permanece 180 graus até contato, com compensação visual vertical de 1,7 m para o corpo invertido. Impacto aos 4 s; pausa invertida de 0,36 s e recuperação até 6 s. Câmera a 3,8 m com retorno suave à câmera normal. HUD de combate oculto durante a sequência.
- Validação: 9/9 testes direcionados (arrival-flight, arrival-visibility, incendiary-arrival); build final aprovado. Cobre continuidade de trajetória, orientação no contato, fase do balanço, pausa/reinício e retorno ao solo.
- Revisão no navegador confirmou personagem 3D visível antes de jogar, mesma pose/enquadramento imediatamente após saída da interface, e retorno ao gameplay com chão/cratera/personagem/UI presentes. As capturas não capturaram o instante de impacto e toda recuperação; não afirmar revisão visual completa desses instantes.
- Limitações artísticas: recuperação ainda deriva do clipe Jump combinado com rotação do root; requer clipe dedicado para mãos apoiando e levantar natural. Não é ainda a sequência orbital cinematográfica completa do pedido original. Compensação de 1,7 m requer inspeção do contato do capacete no modelo animado. Pré-queda usa balanço suave, ainda sem detritos/paralaxe rica.
- Logs: art/tests-headfirst-arrival.log, art/build-headfirst-arrival-final.log. Próxima prioridade: recarga sem bloquear andar/correr, com pernas e braços independentes; manter revisão de contato/recuperação na fila.

## 13/09/2026 — Recarga andando/correndo
- Removido cancelamento explícito de sprint ao recarregar e substituição de movimento por EMPTY_INPUT no cliente/servidor. Regra compartilhada ReloadMovement preserva eixos, salto/esquiva/interação, suprime fire/charging enquanto recarrega para não cancelar sprint sem disparo real.
- CharacterVisual passa a executar locomotion normalmente e aplicar ReloadCast apenas a tronco, pescoço/cabeça, braços/mãos/grips, com entrada/saída curta. Hips e pernas permanecem na passada ou no salto. Câmera normal preservada.
- Pistolas lançadas usam início relativo à posição interpolada do personagem: acompanham deslocamento durante o arco e retornam aos grips atuais, evitando ficar para trás ao correr.
- QA solo: botão Recarga correndo por 2 s, sem ignorar colisões; reinício limpa a revisão. Não disponível online.
- Validação: 20/20 testes direcionados em reload-movement, net-simulation, combat-feel; typecheck cliente, servidor e build final aprovados. Testes verificam corrida/salto durante recarga, bloqueio de consumo, pernas preservadas diante de um clipe de recarga com translação de quadril extrema e retorno dos braços à locomoção.
- Revisão no navegador: recarga a 25–30%, HUD CORRENDO, pistolas lançadas acima do personagem e câmera de gameplay; depois posição passou de aproximadamente (-0,5,0,-15,6) para (-1,0,-2,3), com 50/50 balas. Capturas na conversa. Revisão foi protegida por invulnerabilidade QA e durou 2 s.
- Não comprovado visualmente ainda: curvas rápidas, recarga junto da esquiva e salto, catch das duas armas quadro a quadro. Multiplayer validado na simulação autoritativa, não em duas janelas conectadas. Desempenho observado com 10 inimigos foi ~29 FPS; não afirmar 60 FPS.
- Evidências: art/tests-reload-movement.log, art/build-reload-movement-final.log, art/reload-movement-server-final.log.
- Próximas prioridades: clipe dedicado de impacto de cabeça/apoio/levantar; revisão completa da fila e desempenho de combate. Continuar acabamento dos biomas e conteúdo explorável; objetivo global permanece incompleto.

## 13/09/2026 — GPU do personagem e retomada da tentativa
- SkinningPolicy ativa ossos em textura na GPU quando suportado, mantendo fallback CPU. Revisão visual confirmou personagem visível no loading, gameplay e pose III com aura.
- Comparação manual A/B/A na mesma cena pausada: GPU 58/54 FPS contra CPU 40; apresentação 15,16/16,02 ms contra 23,38 ms, 167 draw calls e 1.593.521 triângulos constantes. Evidência docs/player-skinning-comparison.json. Não é benchmark de horda ativa nem garantia de 60 FPS.
- Testes skinning/chegada/recarga: 9 aprovados em art/tests-skinning.log. Recarga/combate/servidor: 20 aprovados em art/tests-reload-movement.log.
- Removida pausa duplicada de Application; a cena passa a ser a fonte de verdade. Loop suspende o acumulador durante pausa; reinício limpa pausa e botão acompanha o estado real.
- Reprodução no navegador: derrota, pausa no resumo (tick 8849), voltar ao menu (tick 8857 e botão Pausar), Jogar (tick 9553 crescente). Mesmo mapa mantido residente, sem rebuild.
- Build final aprovado: art/build-reload-pause-final.log. Aviso conhecido de tamanho de bundle permanece.

## 13/09/2026 — Autoria da recuperação de chegada (candidato, não integrado)
- Criados ArrivalDive (1 s constante) e ArrivalRecovery (2 s / 121 amostras), a partir do rig original, com compressão de tronco/pernas e ajuste de apoio. Fonte scripts/author-arrival-animation.mjs; backup art/processed/gunslinger-before-arrival.glb; candidato art/processed/gunslinger-arrival-candidate.glb.
- Auditoria scripts/audit-arrival-animation.mjs confirma preservação exata de geometria, materiais, texturas, nós, skin, clipes prévios e prefixo binário; chaves finitas e duração conferidas. Resultado docs/arrival-animation-audit.json.
- Blender renderizou seis poses (0, 20, 40, 60, 80, 100%). Arquivo editável art/blender/Gunslinger_Arrival_Review.blend; renders art/arrival-review-0.png até -5.png. Script scripts/render-arrival-review.py; log art/arrival-review-render.log.
- Revisão visual detectou suspensão dos pés na primeira versão; segunda versão corrige translação vertical e introduz flexão/IK das pernas, mas o instante 60% ainda parece levantar inclinado sem apoio real das mãos. Botas ainda precisam checagem de orientação durante o desdobramento. Não aprovar nem integrar como recuperação final.
- Próxima ação: substituir orientação aproximada dos braços por apoio de mãos com IK e coordenar transferência de peso para pés; rever continuidade de contato do capacete, armas nos grips e retorno exato ao Idle. Integrar apenas depois de render aprovado e testes de runtime/chegada.
- Arquivo de produção public/models/gunslinger.glb e runtime permanecem sem alteração nesta entrega; não necessário rebuild do jogo para avaliar arte candidata. Goal global permanece ativo, sem conclusão artística alegada.
## 14/09/2026 — Recuperação dedicada integrada e prévia corrigida
- Resolvida a divergência entre cálculo e render: a prévia Blender aplicava rotação externa X com sinal errado. Corrigido para +pi*dive e 60 FPS antes da importação. Comparação de 18 posições (Head/LeftHand/RightHand em seis momentos) apresentou erro máximo de 0,000007865 m frente à autoria Babylon: docs/arrival-blender-parity.json; scripts/audit-arrival-blender.py.
- Agora os renders mostram apoio invertido dos braços e transferência para pernas flexionadas. Fontes art/blender/Gunslinger_Arrival_Review.blend e scripts/author-arrival-animation.mjs; seis renders art/arrival-review-0.png a -5.png. As críticas anteriores sobre braços elevados eram parcialmente causadas pela conversão incorreta da prévia; manter revisão de palmas, armas e contato em gameplay.
- ArrivalDive e ArrivalRecovery incorporados a public/models/gunslinger.glb após conferir byte a byte que a produção ainda era igual ao backup art/processed/gunslinger-before-arrival.glb. CharacterVisual seleciona os clipes dedicados; fallback Jump continua para modelos legados. Geometria/texturas/rig e 26 clipes anteriores preservados.
- Novo teste importa o GLB real e executa CharacterVisual: mãos entre 4,5 e 13 cm do solo com corpo invertido aos 40% da recuperação; cabeça abaixo de 50 cm; final em pé e rotação limpa ao retornar à locomoção. O teste é de articulações, não prova ausência de penetração da malha/armas.
- 8 testes passaram (arrival-authored, arrival-flight, reload-movement), build final aprovado: art/tests-arrival-authored.log e art/build-arrival-authored.log. Aviso conhecido de bundle grande permanece.
- Prévia localhost estava desligada; Vite reativado em D com sessão 79318. Navegador carregou 100%, permitiu Jogar e reportou modelo pronto/GPU. Captura de tela falhou duas vezes e a aba em segundo plano reportou 1 FPS/tempo descartado alto; não usar essa sessão para benchmark nem alegar revisão visual completa da sequência no jogo.
- Próxima ação: capturar sequência completa em gameplay com armas/câmera, verificar contato do capacete/palmas, passagem ao Idle e enquadramento durante levantar. Revisar também curvas/salto/esquiva com recarga e performance ativa. Objetivo global permanece incompleto.
## 14/09/2026 — Contato da superfície e pistolas na chegada
- Auditoria nova mede a malha deformada, não só articulações: a primeira recuperação integrada enterrava partes do corpo até 11,2 cm e as pistolas até 22 cm nos quadros amostrados. Os testes anteriores de ossos não cobriam esse defeito.
- Autoria agora corrige altura usando os 16.816 vértices deformados do corpo. Pulsos orientam os canos tangentes ao chão e a parte superior das armas para cima; preparação antecipada para terminar antes do apoio. Correção gravada no clipe, sem varredura de vértices por quadro no jogo.
- Auditoria de 241 amostras das duas pistolas (95.654 vértices por amostra) encontrou mínimo +2,51 cm e nenhum quadro penetrante: docs/arrival-weapon-contact.json, scripts/audit-arrival-weapon-contact.mjs. Auditoria do corpo em 11 poses: sem vértices abaixo do solo; docs/arrival-mesh-contact.json. Essas medições usam plano horizontal e não validam terreno irregular.
- Teste de CharacterVisual com GLB real agora inclui corpo e duas pistolas nos grips corretos, 241 momentos (incluindo interpolação entre chaves), tolerância mínima de -8 mm. Oito testes passaram em art/tests-arrival-surface.log; build final aprovado art/build-arrival-surface.log; preservação dos 26 clipes anteriores/modelagem/texturas auditada novamente.
- Seis renders atualizados no Blender e poses 40%/60% inspecionadas. Arquivo editável Gunslinger_Arrival_Review.blend atualizado. Renders ainda não incluem pistolas; a cobertura das armas nesta etapa é geométrica automatizada, não revisão cinematográfica em gameplay.
- Backup anterior aos ajustes em art/processed/gunslinger-before-surface-clearance.glb e gunslinger-before-wrist-clearance.glb. Produção atualizada com candidato validado. Nenhum Blender/teste/build permanece ativo ao fechar a etapa.
- Pendente: revisar ritmo, sensação de peso, contato do capacete e armas na sequência completa do navegador, além de retorno ao Idle; não considerar acabamento final aprovado somente por ausência de penetração. Próxima prioridade segue essa revisão e depois locomoção/recarga/performance e mundo.

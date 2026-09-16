# Fila de trabalho — pedidos acumulados

Pedidos novos são acrescentados; não cancelam a etapa em andamento. Sem Meshy API. Modelagem, UVs e texturas originais dos inimigos preservadas. Variantes de elite poderão receber cor/brilho em runtime conforme autorização posterior do usuário.

## 1. Correções de combate e movimento — em validação

- [x] Recast/Detour: rotas pelas ilhas e pontes, crowd avoidance, setores de ataque, limite de atacantes simultâneos.
- [x] Restaurar cinco inimigos originais com auditoria binária; animar somente os esqueletos.
- [x] Corrigir sockets distantes, pronação direita e mira vertical dos braços/armas. Teste das duas armas em 15 direções aprovado.
- [x] Reproduzir e corrigir escala explosiva do ragdoll. Cinco espécies testadas por 240 passos físicos.
- [x] Passadas vinculadas ao deslocamento, FSM com transições, salto e esquiva mais suaves, salto de parede.
- [x] Tomate: asas, voo, cuspe de fogo. Melancia: quatro patas, rolamento, mordida e caroços. Implementados; revisão visual pendente.
- [x] Colisão extraída das peças do mundo, pisos triangulados e proteção de cercas/portas/objetos.
- [x] Céu com mistura periódica na emenda; confirmar rotação completa no navegador.
- [x] Vida, dano visível, marcas de bala e tiros gravados.
- [ ] Melhorar visibilidade do rastro do tiro; QA de impactos e habilidades no navegador.
- [ ] Verificar colisão e animações no cenário final, consolidar build e documentos.

## 2. Desempenho e diretor — próxima etapa

- [x] Limite máximo normal, adaptação à taxa de quadros e diretor ciente do orçamento.
- [x] Compartilhamento entre inimigos iguais, LOD de animação/sombras e limite de ragdolls.
- [x] Hordas com crescimento gradual e intervalos de recuperação.
- [x] Elite dourado: defesa/recompensa; gigante: atributos ×3; luminoso: dano ou habilidade extra.
- [x] Knockback aplicado por jogador e inimigos com colisão.

## 3. Progressão e objetivos

- [ ] Exibir atributos e seus efeitos, recompensas, baús aleatórios e objetivo antes do próximo estágio.
- [x] Integrar os 90 PNGs RGBA de assets/perks preservando transparência.
- [ ] Validar fluxo de matar → ganhar créditos/XP → comprar item → cumprir objetivo → avançar.

### Arma do milho — novo pedido, aguardando asset do usuário

- [ ] Substituir gesto de tapa por postura de atirador, sockets, recuo e disparo no cano da nova arma.
- Lista de assets sugeridos enviada: arma, chefão original, ninhos, baús com tampa, altar, barrancos/rochas, vegetação mutante e adereços agrícolas. Não substituir os modelos fornecidos.
- Atualização: baús serão modelados por nós no Blender, com tampa separada e abertura interativa.

### Nascimento, ataques e profundidade — pedido seguinte

- [x] Criar animação própria de nascimento da terra para cada espécie.
- [x] Trocar ataques genéricos de origem por ataques próprios; milho com postura de arma, sem tapa.
- [x] Reforçar movimento e espuma nas cachoeiras.
- [ ] Dar profundidade visível ao vazio, transição de queda e retorno compreensível ao chão seguro.

## 4. Resposta do ambiente e áudio gravado

- [x] Vento na esquiva.
- [x] Poças com reflexos, ondulações e interação ao pisar.
- [x] Passos de grama, madeira, concreto e água com gravações baixadas e licenças registradas.
- [x] Substituir efeitos sintéticos de criaturas, impacto e habilidades por amostras gravadas.

## 5. Ideia de terreno destrutível

- [ ] Investigar trecho de terra destrutível por habilidade forte, incluindo geometria, colisão e atualização da navegação. Não considerar uma simples marca visual como buraco físico.

## Critérios globais

- [ ] Revisão visual comparada às quatro referências; identidade artística ainda não equivalente.
- [ ] Medir desempenho real com o limite normal e registrar limitações honestamente.
- [ ] Atualizar MILESTONES.md e evidências a cada etapa concluída.

## Revisão recebida após migração para D:

- [x] Fechar os platôs e ilhas com volume contínuo de terra/rocha texturizada e colisão.
- [x] Corrigir orientação frontal de todas as espécies, inclusive berinjelas.
- [x] Eliminar pico de trabalho ao liberar habilidade 2; distribuir tiros pelo mortal.
- [x] Habilidade 1: pedido histórico de dois disparos, substituído depois pelo leque ricocheteante.
- [x] Habilidade 3: mira por braço, alternância rápida e pose cruzada estilizada.
- [ ] Asas mais rápidas/sutis, amostragem contínua próxima e revisão de FPS.

## Mundo alienígena vivo — novo pedido enfileirado

- [x] Ilhas flutuantes de cenário com movimentos lentos e silhuetas completas.
- [x] Ilhas conectadas por pontes e rotas legíveis.
- [ ] Plataformas/ilhas acessíveis que se alinham em momentos definidos; transporte do jogador, colisão móvel, ponto seguro e navegação sincronizados.
- [x] Discos voadores das frutas com animação de voo e identidade visual agrícola alienígena.

## Correção dos baús — sorteio e coleta no mundo

- [x] Remover escolhas e entrega imediata. Cada baú sorteia um único item ao abrir, anima a tampa, ejeta o PNG RGBA e mantém o item girando no chão até a coleta com E. Validar cobrança e coleta únicas, transparência e chão real.

Estado consolidado: CURRENT_IMPLEMENTATION.md (07/09). Itens marcados indicam implementação; revisão visual global e performance sustentada continuam pendentes. A ilha móvel já transporta o jogador com colisão, mas a navegação dos inimigos permanece nas pontes fixas.

## Sensação de combate e parkour — pedidos acumulados de 07/09

- [x] Dano recebido com direção, perda de vida visível, impacto de câmera e áudio destacado.
- [x] Reduzir atordoamento dos tiros comuns; impactos fortes com intervalo de reação.
- [x] Corpos dos inimigos bloqueiam o jogador sem deslizarem ao encostar.
- [x] Após rolar, manter corrida até parar/atirar; preservar velocidade no salto.
- [x] Colisão contínua no walljump e parkour, incluindo quinas e tetos.
- [x] MP I: sequência em leque de balas curvas que ricocheteiam, sem alvo travado.

## Novos pedidos durante a revisão

- [x] Impedir entrada nas laterais profundas das ilhas e em pedras, com colisão da malha e recuperação de sobreposição; câmera fora da rocha.
- [x] MP I com animação cinematográfica própria de preparação e varredura das pistolas.
- [x] Animações de recuo e passos laterais, escolhidas pela direção local do movimento.

## Cinemáticas, arsenal e modo de hordas — pedidos acrescentados
- [x] Sincronizar os três áudios do usuário: preparo no grito, close 3D, disparo e saída do close no nome da habilidade.
- [x] Cartuchos com som gravado de impacto no chão.
- [x] Carregador padrão de 50 balas e recarga acrobática com arremesso das pistolas.
- [x] Auditar os 90 itens, implementar efeitos e comprovar acúmulo de atributos.
- [x] Modo de hordas progressivas com item aleatório ao concluir cada onda e chefe a cada cinco ondas.

- [x] Ajustar as animações à duração integral das falas e criar pose heroica conforme a nova referência, com aura nas armas, pedras e terra.

Revisão de 07/09: 203 testes / 22 arquivos, TypeScript e build aprovados. Os itens marcados nesta sessão indicam implementação e verificações descritas em CURRENT_IMPLEMENTATION.md; equivalência visual global e 60 FPS permanecem abertos.

## Ritual arcano e encerramento da fala — novos pedidos
- [x] Criar no Blender círculo arcano com runas no chão, auras das pistolas e animação de preparação/liberação; substituir os aros simples atuais.
- [x] Encerrar animação e emissões no fim da voz, excluindo silêncio/cauda dos arquivos e disparos atrasados por FPS baixo.
- [x] Revisar no jogo legibilidade, brilho, partículas e integração com a pose, usando a nova referência.

- [x] Biblioteca reutilizável de fogo, água, terra, eletricidade, trevas e explosão, com materiais/texturas, limites de custo e prévia no diagnóstico.

## Novos pedidos — combate, recompensa e entrada
- [x] Melhorar animação dos disparos básicos com alternância, recuo e recuperação do corpo.
- [x] Recarga mais ágil, mantendo a câmera de gameplay.
- [x] Melhorar áudio dos inimigos e de seus ataques com gravações.
- [x] Recompensa da horda ejetada no centro da fase e concedida somente ao recolher.
- [x] Menu Press Start com carregamento por trás e entrada do jogador como meteoro, impacto no solo e liberação do controle somente após chegada.

## Multiplayer cooperativo — pedido de 07/09

Servidor autoritativo em Node com Colyseus 0.18; cliente envia intenção, servidor decide resultado, Babylon apresenta. Câmera, cinemática, VFX, áudio e ragdoll ficam locais. Desenho e mapa completo do estado: docs/MULTIPLAYER.md; servidor em server/.

- [x] Fase 0 — auditoria: simulação pura vs. apresentação, cheiros de single-player, schema proposto (docs/MULTIPLAYER.md).
- [x] Fase 1 (parcial) — server/ com simulação autoritativa reutilizando PlayerMotor/CollisionWorld/IslandFerry/pente/MP/timeline; 6 testes em Node sem DOM (tests/net-simulation.test.ts).
- [x] Fase 1 — sala sobre defineInput/setFixedTimestep/allowRewindState do 0.18 (sem netcode artesanal); Schema Builder sem decorators; @colyseus/sdk no cliente; dois clientes reais via @colyseus/testing (tests/net-room.test.ts).
- [x] Fase 2 — predição local com reconciliação por seq (src/net/Reconciliation.ts, 5 testes), remotos via Predict do SDK e RemotePlayers; ?online=1 no PlayerScene; painel F1 com RTT/correções.
- [ ] Fase 3 — hitscan no servidor com rewind (sweepSphere + raio×esfera), shotId com dedupe do cosmético local.
- [ ] Fase 4–5 — EnemySimulation puro extraído de EnemySwarm; avisos/projéteis como registros; IA com LOD de taxa.
- [ ] Fase 6–9 — hordas/diretor, MP e skills sem pausa global (castId/tick), itens/procs/economia atômica, chefe e fenda.
- [ ] Fase 10–12 — late join/reconnect, Playwright com dois navegadores e simulador de latência, @colyseus/loadtest.
- Decisões registradas: tick de simulação 60 Hz (calibração do FixedLoop/PlayerMotor e 203 testes), patch 20–30 Hz; server/ adicionado sem mover src/ (o subconjunto puro já é a camada compartilhada).

## Pedidos acumulados — fogo, loading e cidade agrícola
- [x] Tomate com brilho crescente antes de cuspir chama, explosão incendiária, chão em fogo e queimadura no jogador.
- [x] Loading independente do mapa: personagem mergulhando em loop até todos os recursos estarem prontos, inspirado nas quatro novas referências.
- [ ] Aumentar escala e riqueza das fazendas; ilhas largas com volume rochoso modelado, celeiros grandes e ligações por pontes formando uma cidade agrícola.
- [ ] Corrigir transparência do personagem, altura/reflexos das poças e adicionar meio segundo de margem ao fim das falas.

## Revisão de MP, habilidades e inimigos
- [x] Barra de MP: regeneração lenta e ganho ao acertar, custos distintos por habilidade.
- [x] Sincronizar cada tiro com áudio, sem bloqueio compartilhado com milho ou efeitos.
- [x] Aumentar tolerância de acerto das habilidades I/II sem mira travada nem atravessar paredes.
- [x] Runas com cores distintas; ritual III mais elaborado.
- [x] Berinjela com investida de atropelamento e sinal de preparação.
- [x] Cenoura com laser ancorado na arma da mão robótica.
- [x] Reduzir caminhada e corrida do jogador.


Validação de 07/09: 249 testes / 30 arquivos; detalhes em CURRENT_IMPLEMENTATION.md. As caixas marcadas indicam implementação e as verificações ali descritas, não equivalência com a arte de referência. Cidade já expandida e navegável; riqueza visual, conteúdo explorável e performance sustentada continuam na fila. Transparência do jogador e margem vocal corrigidas; o realismo das poças permanece em refinamento.

## Expansão autônoma de 25 vezes — pedido acumulado de 07/09
- [x] Congelar área conectada de referência: 8.416,6403 m²; medição reproduzível em scripts/measure-world.mjs.
- [x] Criar continuidade com meta ativa e heartbeat de desenvolvimento/revisão a cada 30 minutos (limite do app: um por tarefa).
- [x] Acrescentar nove baús físicos às fazendas atuais e spawns que acompanham a região explorada.
- [ ] Ampliar área navegável conectada até pelo menos 210.416,0081 m², sem contar cenário inacessível.
- [ ] Dividir carregamento, colisão e navegação em regiões com orçamento medido e persistência de encontros.
- [ ] Construir ilhas e biomas distintos, texturizados, com fontes Blender editáveis e rotas verificadas.
- [ ] Distribuir objetivos, encontros, variantes, chefes e recompensas para dar propósito à exploração ampliada.
- [ ] Revisar a fila inteira, incluindo animações, sons, água, combate, loading, travessias e multiplayer incompleto.
- [ ] Validar desempenho sustentado e documentar evidência visual e funcional por entrega.

Checkpoint e critérios: WORLD_EXPANSION.md. Nesta revisão: 258 testes / 32 arquivos aprovados; área atual ainda 1,00 vez a referência. Carregador de regiões tem testes de orçamento e ciclo de vida, mas ainda precisa controlar múltiplas regiões reais.

### Incremento de expansão validado
- [x] Primeiras duas ilhas adicionais conectadas: Pomar dos Ventos e Porto dos Grãos, com fonte Blender e seis baús físicos.
- [x] Colisão preparada por região e testes de travessia nos dois sentidos; oito rotas principais completas no navmesh.
- [ ] Transformar a residência inicial das regiões em streaming espacial com pinning de atores, navmesh por tiles e Havok regional.
- [ ] Continuar ampliação: área comprovada 20.473,6790 m² / alvo 210.416,0081 m² (2,43× / 25×).

Evidência: 275 testes / 34 arquivos em art/tests-frontier-final-isolated.log, build/servidor aprovados e checkpoint em WORLD_EXPANSION.md. Variedade de biomas, qualidade visual global e desempenho continuam abertos.

### Streaming solo
- [x] Seleção espacial, retenção de regiões ocupadas, apresentação por recurso e passagens protegidas enquanto o destino carrega.
- [x] Ciclo de carga/descarte confirmado no navegador; 286 testes / 36 arquivos e build aprovados.
- [ ] Navmesh regional, persistência/dormência dos encontros e orçamento de memória medido.
- [ ] Streaming cooperativo com prontidão sincronizada entre clientes e servidor.


### Copas do pomar
- [x] Redução por material preservando UVs/texturas, LODs compartilhados nas 12 árvores e descarte regional. 288 testes / 37 arquivos e build aprovados.
- [ ] Vegetação mais densa/variada, transição distante mais discreta e perfil sustentado de desempenho com hordas.


### Recuperação durante exploração
- [x] Retentativas espaçadas para regiões desejadas, cancelamento do JSON e indicação de falha/contagem nas passagens; política e build validados.
- [ ] Exercitar falha de rede no navegador; recuperação inicial do menu e interrupção real do download GLB.


### Distrito das Estufas
- [x] Terceira ilha da fronteira, ponte física, duas estufas atravessáveis e cinco baús adicionais; 22 rotas completas verificadas.
- [x] Área conectada medida em 35.859,0588 m² / 4,260496×.
- [ ] Acabamento/densidade do distrito, horizonte e iluminação; diversidade de biomas e expansão até 25× continuam pendentes.


### Horizonte durante streaming
- [x] Proxies texturizados das regiões reais, troca exclusiva e descarte; oito lotes de material por região.
- [ ] Perfil de desempenho controlado, névoa/horizonte e emenda do céu; composição artística global ainda pendente.


### Céu na expansão
- [x] Remover matriz congelada do céu infinito e validar acompanhamento da câmera além de 2 km.
- [ ] Emenda/faixa visual ainda aparece no panorama; revisão de shader/pós-processamento continua necessária.


### Panorama v3
- [x] Asset com bordas mais compatíveis; enquadramento que mostrava faixa escura revisado sem a faixa anterior.
- [ ] Revisar 360° completos e polos; comparação artística global ainda aberta.


### Exploração dos distritos
- [x] Seis contratos opcionais de abrir dois baús diferentes, bônus aleatório físico, direção/distância e reset por estágio.
- [ ] Encontros específicos, progressão global, persistência e sincronização cooperativa dos contratos.


### Navegação para expansão
- [x] Bake em tiles de 25,6 m, 22 rotas completas, baús bloqueando o crowd e 306 testes aprovados.
- [ ] Streaming regional dos tiles, persistência/dormência dos encontros e expansão física até 25×. Área atual medida: 35.565,9887 m² / 4,225675×.


### Residência de navegação
- [x] Descarga/restauração de tiles Detour com retenção de caminhos; teleporte, perseguição e 12 ciclos testados; 308 testes aprovados.
- [ ] Download por tile/cache limitado, dormência/persistência de encontros; novo bioma e ampliação física até 25×.


### Planaltos agrícolas
- [x] Três ilhas sólidas com relevo, quatro pontes/seis segmentos, nove baús e três contratos; 12 direções físicas verificadas, navegação e integração servidor validadas.
- [x] Área conectada medida: 122.560,5037 m² / 14,561690×.
- [ ] Meta 25×, novos biomas/artes, densidade/iluminação e encontros regionais. Demais pedidos anteriores não cancelados.


### Sombras da expansão
- [x] Volume acompanha câmera; seleção próxima nas ilhas iniciais/regiões, descarte e 327 testes aprovados.
- [ ] Revisão visual e perfil controlado de desempenho.
- [x] Recompensa física de horda no campo explorado e guia de coleta; dez campos/rotas reais testados.


### Relato do usuário — 8 setembro: locomoção, pena e reinício
- [x] Reproduzir/corrigir perda de apoio em escadas e pouso em inclinações; 55 testes direcionados aprovados.
- [ ] Revisão visual e travessia dos assets específicos relatados; não considerar toda a colisão encerrada.
- [ ] Trilhas legíveis entre pontes e ilhas, sem encontros confusos de rochas e acessos.
- [x] Pena acrescenta um pulo aéreo por unidade (duplo/triplo/etc.), preserva altura; servidor, descrição, HUD e testes atualizados.
- [x] Corrigir orientação da queda no loading: loop Blender de cabeça integrado, 120 quadros decodificados e quadros revisados offline.
- [ ] Conferir reprodução/loop e menu no navegador; acabamento artístico ainda aberto.
- [ ] Transição contínua do espaço/órbita até chegada ao mapa ao jogar, sem corte seco direto ao chão.
- [x] Reinício solo em memória preserva mapa/modelos/pools; coop continua pendente.
- [ ] Teste visual do fluxo completo morrer → tentar novamente → pausar/continuar.
- [x] Tela de derrota distinta com resumo copiado e inventário; 341 testes/build/servidor aprovados.
- [ ] Revisão visual do layout de derrota no navegador.
Novos pedidos entram após a entrega de recompensas em andamento; locomoção e pena são as próximas prioridades. Não cancelam expansão nem fila anterior.


### Entrada no cenário — aproximação
- [x] Trajetória aérea contínua até pouso, câmera/aura no root correto e revelação gradual do mapa; 344 testes/build aprovados.
- [ ] Validar visualmente entrada/pausa; pose dedicada e sequência orbital/atmosférica completa continuam pendentes.

- [x] Corrigir seleção visual congelada durante chegada com mundo pausado; reprodução antes/depois, testes de regressão e build aprovados.

### Rede de caminhos dos planaltos
- [x] Onze trajetos texturizados ligados a pontes, celeiro e suprimentos, aderidos ao relevo; ida/volta física validada, render offline revisado e build aprovado.
- [ ] Revisão na câmera do jogo, acessos das regiões anteriores e enriquecimento do entorno. Não encerra pedido global de trilhas nem colisões.

- [x] Revisão inicial no navegador: personagem após pouso, derrota sem itens, reinício solo e trilha nos planaltos visíveis.
- [ ] Concluir travessia manual, derrota com inventário extenso, pausa/retomada e captura contínua da aproximação.
- [x] Separar medição CPU de simulação e apresentação para orientar perfil de desempenho.

### Pedido de morte dramática recebido em 12 setembro
- [ ] Golpe fatal com reação dramática, sofrimento e som de impacto ressoando antes de mostrar a derrota; depois opções Renascer e Voltar ao menu, ambos validados. Preservar fila e trabalho dos pomares em andamento. Origem: tarefa 01a098aa-ead5-72b0-82a0-40663d68632e; enviar resultado ao concluir ou bloquear.


- [x] Rootwood em preparação: três ilhas, conexões físicas corrigidas, 24 travessias e copas revisadas offline.
- [ ] Rootwood: trilhas, recompensas, catálogo/streaming/navmesh global, orçamento de árvores e medição conectada. Não integrado ainda.
- [ ] Próxima execução imediata: morte dramática e opções Renascer/Voltar ao menu; depois retornar à integração Rootwood.

### Atualização — arremesso fatal e apoio em props, 13 setembro
- [x] Reproduzir/corrigir apoio invisível nas bordas e cantos dos colliders de objetos; 22 testes direcionados aprovados.
- [x] Validar no navegador Renascer e Voltar ao menu com mapa pronto no solo.
- [x] Implementar morte voando para trás, câmera acompanhando, grito humano gravado e clipe dedicado; testes físicos e integridade aprovados.
- [ ] Concluir revisão visual da pose após inverter eixo identificado na primeira captura; balanceamento auditivo e inventário extenso.
- [ ] Demais regiões/obstáculos, órbita/entrada, trilhas e expansão Rootwood continuam na ordem da fila.

### Integração do mapa gigante solicitada pelo usuário — 13 setembro
- [x] Rootwood no jogo: três ilhas ligadas por pontes, trilhas, nove baús, três contratos, carregamento regional e navegação global. Revisão em gameplay concluída.
- [x] Área conectada acima de 25×: 26,488698× segundo medição do navmesh desde o spawn. Critério de área somente; objetivo global continua ativo.
- [x] 42 percursos físicos e 44 rotas globais aprovados; 28 testes direcionados.
- [ ] Fechar verificação completa/build final e aprimorar bosque: estruturas e apoios, árvores ao longe, densidade, identidade visual e desempenho controlado.

- [ ] Novo pedido após integração Rootwood: inclinação suave/intencional da câmera para sensação de arco planetário formado pelas ilhas; manter mira, colisão e conforto, transições limitadas, não gravidade esférica real.

### Atualização — horizonte planetário
- [x] Integrar inclinação suave por posição/direção, limitada a 4 graus, sem modificar gravidade ou direção da mira.
- [x] Validar limites, sentido, transições, independência da taxa de quadros e compilação cliente/servidor.
- [ ] Revisar visualmente a sensação da curvatura planetária durante exploração e combate.

### Refinamento do bosque — apoios
- [x] Fechar build final da integração e corrigir pilares desconectados dos telhados; atualizar colisão/proxy distante e revisar no jogo.
- [x] Revalidar 42 percursos físicos, 44 rotas globais, área conectada e 13 testes direcionados.
- [ ] Vegetação distante com representação leve, praças mais densas e construções com acabamento; revisão de conforto da câmera em giro/combate.

### Bosque — continuidade das copas
- [x] Renderizar textura transparente da árvore original e integrar copas distantes em lote único no bioma residente; testes/build e revisão em gameplay.
- [ ] Equalizar iluminação da copa distante e validar transição caminhando; estender copas ao proxy de região ainda não residente.
- [ ] Benchmark controlado de exploração/hordas; 60 FPS ainda não comprovados.

### Correção de chegada — pedido recebido durante continuidade das copas
- [ ] Manter a pose do personagem ao sair do loading; retirar somente a interface e fazer a animação conduzi-lo continuamente para a cena de queda.
- [ ] Impacto de cabeça, sem virar para uma aterrissagem de herói; levantar depois de bater no chão. Validar transição inteira em vídeo/gameplay, incluindo retorno após morte sem novo carregamento do mapa.
- Prioridade imediata após concluir continuidade das copas em andamento. Preservar demais objetivos.

### Recarga durante locomoção — novo pedido
- [ ] Permitir recarregar andando e correndo, com pernas mantendo a passada e braços/pistolas executando a recarga acrobática, sem travar movimento ou trocar a câmera. Validar corrida, salto, recarga vazia/manual e interrupções.
- Enfileirado após transição loading/queda; continuidade das copas em conclusão.

### Copas entre regiões
- [x] Integrar lote das 300 copas ao proxy regional com exclusão frente ao detalhe, descarte e testes; rebake mais claro e build aprovado.
- [ ] Rever aproximação contínua em ponto sem obstrução: a vista dos planaltos escolhida ficou encoberta pelo relevo/celeiro.
- Próxima execução: transição loading→impacto de cabeça→levantar, seguida de recarga em movimento (pedidos prioritários recém-recebidos).

### Chegada contínua — implementação inicial revisada
- [x] Mesmo ator/câmera 3D antes/depois de Jogar; interface sai sem troca de pose, balanço preservado; testes e revisão visual antes/depois.
- [x] Manter invertido até impacto, segurar contato e só depois recuperar orientação; testes de trajetória/tempo aprovados.
- [ ] Clipe dedicado de impacto/apoio/levantar e revisão contínua do contato do capacete; composição orbital mais rica.
- Próxima execução imediata: recarga andando/correndo, sem câmera especial e com pernas independentes.

### Recarga em movimento — implementada e revisada
- [x] Andar/correr/saltar durante recarga no cliente/servidor; pernas independentes da acrobacia dos braços e pistolas acompanhando deslocamento.
- [x] Testes de movimento/animação/servidor (20), build e captura em gameplay com CORRENDO + RECARREGANDO, final 50/50.
- [ ] Revisar curvas, esquiva e salto com recarga em vídeo; duas sessões online.
- Próxima prioridade: animação dedicada do impacto de cabeça e levantar; depois revisão de desempenho e demais pendências artísticas/combate.

### GPU e pausa — continuidade da recarga
- [x] Skinning na GPU com fallback por capacidade; revisão de visibilidade e comparação A/B/A registrada.
- [x] Corrigir simulação presa após pausar uma derrota e reiniciar; revisão no navegador e build aprovados.
- [ ] Manter pendente benchmark de hordas ativas, curvas/esquiva/salto com recarga em vídeo e duas sessões online.
- Demais pedidos preservados, incluindo impacto de cabeça/apoio/levantar dedicado e acabamento do mundo.

### Recuperação dedicada — candidato em revisão
- [x] Autorados dois clipes candidatos, preservação de assets auditada e seis poses renderizadas no Blender.
- [ ] Apoio real das mãos/transferência de peso e orientação das botas: candidato ainda não aprovado nem integrado.
- [ ] Depois: continuidade completa loading/contato/levantar com armas em gameplay, teste e build.
### Recuperação dedicada — integração inicial concluída, 14/09
- [x] Corrigir eixo/FPS da revisão Blender e comprovar paridade de articulações com Babylon.
- [x] Integrar ArrivalDive/ArrivalRecovery preservando modelos/clipes; 8 testes e build aprovados; renders de apoio revisados.
- [ ] Revisão completa de gameplay com armas, palmas/capacete e câmera: captura indisponível nesta sessão. Não declarar acabamento cinematográfico final.
### Contato real durante recuperação — 14/09
- [x] Corrigir penetração da malha do personagem e das pistolas; orientar pulsos antes do apoio; teste dos modelos reais em 241 momentos e build aprovados.
- [ ] Revisão visual contínua com armas, câmera e sensação de peso permanece pendente; render do corpo e testes geométricos não substituem gameplay.

### Menu em queda livre — pedido de 15/09
- [x] Close no personagem, grande e centralizado à direita do painel, na altura do tronco e com o corpo inteiro no quadro; volta suave ao enquadramento da descida em 1,4 s após Jogar.
- [x] Queda viva em vez de pose pendurada: `FreefallFlutter` (vento nos braços, pernas alternadas, olhar e rolagem) sobre o quadro único do ArrivalDive, mesmo relógio do menu até a descida e desaparecendo perto do chão; 4 testes.
- [ ] Revisão do usuário da intensidade do movimento e do sinal da flexão do joelho.

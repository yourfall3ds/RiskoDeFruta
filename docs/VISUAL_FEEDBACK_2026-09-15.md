# Revisão visual — 15/09/2026

## Prioridade nova — painel para ouvir e trocar sons
Usuário quer ouvir cada som por inimigo e substituir rapidamente. Claude separado está implementando `docs/CLAUDE_AUDIO_LAB_TASK.md`, limitado a arquivos novos de catálogo/overrides/painel. **Principal:** integrar API em `RecordedAudio.enemy()` e botão/link F1 quando `docs/CLAUDE_AUDIO_LAB_DELIVERY.md` existir. Não criar painel concorrente. Painel deve refletir sons reais, inclusive camada de ataque secundária; mudança aplicada ao jogo sem reload via BroadcastChannel. Preservar ajustes atuais de áudio e usar catálogo compartilhado para defaults. Codex faz CSS/QA visual.

Adicionar `audio-lab.html` como entrada no build Vite (mantendo index.html), para funcionar também no preview/build. O CSS `src/ui/enemy-audio-lab.css` já existe. Uma instância por WeaponAudio, dispose adequado, overrides não podem impedir áudio padrão enquanto carregam nem afetar tiros do jogador por grupos compartilhados. Silenciar um evento de uma espécie não silencia outras.

Revisão inicial do catálogo e critérios de QA em `docs/AUDIO_LAB_REVIEW_NOTES.md`; aplicar quando o agente concluir os arquivos.

## QA da expedição já integrada (aba separada, 1280x720)
**Revisão após integrar os SVG:** o feixe agora tem borda suave e não é faixa chapada (aprovado), mas está BRANCO, perdendo o estado âmbar/menta. Causa confirmada no shader local Babylon StandardMaterial: `emissiveColor += emissiveSampler.rgb`, então emissiveTexture branca SOMA branco à cor. Usar SVG só como opacityTexture e emissiveColor para tint, ou multiplicação explícita coerente; não somar branco. Checar beam/core/boundary.

**Colisor de totem:** `arcane-skill-ritual.glb` é conjunto de VFX (Ground_EtchedRadials, Ground_FocusDiamonds, RisingFilaments, Left_ElectricFlares etc), não pedestal sólido. Caixa fixa radius .62/height1.15 não corresponde ao objeto visível: não colocar piso/bloco invisível sob runas. Se marco for apenas selo de energia no chão, remover collider do efeito e usar chão existente; se houver corpo físico, escolher/criar corpo visível com dimensões reais e gerar colisor do corpo. Não chamar caixa invisível de asset pisável aprovado.

Codex criou assets originais `public/textures/expedition-beam.svg` (halo lateral suave, núcleo estreito e fade vertical) e `public/textures/expedition-boundary.svg` (limite fino segmentado com interior transparente). Integrar nos VFX do totem como textura com alpha real, mantendo cor por estado. Não repetir quad chapado; o SVG é branco para tingimento pelo material. Não cobre problema de projeção no terreno, que ainda precisa ajuste. Fonte SVG original do projeto, sem dependência/licença externa.
- Quatro marcos aparecem e o HUD de rota está legível: Campo inicial, Posto oeste, Lavoura leste, Distrito das Sementes. CSS do Codex já estiliza `.expedition-route` e `.harvest-resonance`; não sobrescrever.
- **Feixe do totem reprovado visualmente:** uma faixa retangular âmbar larga, chapada, sem queda de opacidade, corta o celeiro do chão ao topo da tela. Use núcleo fino e halo suave com alpha radial/lateral e fade vertical, brilho moderado; não simplesmente quad opaco. Precisamos de marco com silhueta própria, não baú de recompensa com faixa presa nele. Base imóvel: remover giro de todo `visual.root`; só energia/peça flutuante pode girar. Corpo físico precisa colisão e topo pisável.
- Disco de raio 11 plano só em uma altura pode desaparecer sob solo e cruzar degraus; sinalizar limite sobre o chão de forma coerente ao relevo, discreto, distinguível de perigo inimigo.
- Texto inicial ainda diz recolher item no centro e chefe a cada cinco ondas. Atualizar copy/controles para expedição/totens/dash/desarmado conforme implementação real.
- `PlayerScene` mapeia `mode==='expedition'` para `'classic'`; corrigir URL explícita de expedição. HUD usa camera.position para interação de totem: usar player.position para distância/range, orientação da câmera apenas para seta.
- Incluir QA de aproximar/ativar marco e acelerar carga sem afetar jogo normal; necessário conferir recompensa/reset/ciclo completo sem depender de teclado sustentado na ferramenta do navegador.

## Bug novo — círculos falsos de área (screenshot do usuário)
**Patch JÁ APLICADO pelo Codex:** `docs/CLAUDE_TELEGRAPH_REVIEW_2026-09-15.md`, `EnemyBehaviors`, `EnemySwarm`, `CombatPresentation`, novo `tests/telegraph-shapes.test.ts`. Verificação real na árvore atual: 52 testes passaram (telegraph-shapes/enemy-swarm/combat-feel). Preservar implementação. Revisão adicional pendente da faixa: ela usa min(alcance, distância do alvo), mas investida passa desse ponto se jogador recuar; precisamos alcance comprometido completo, truncado por parede real, sem subestimar perigo. Avisos futuros devem acompanhar terreno ao refatorar relevo.

**Adendo aplicado também:** `.temp/telegraph-range-fix.patch`, com faixa cobrindo impulso inteiro e corte por colisão real. 32 testes de telegraph-shapes passaram após aplicar. Este patch só mudou `telegraph/rushReach` e testes, sem apagar lastKill nem mudanças do principal. Não reaplicar patches antigos.

Usuário vê múltiplos anéis vermelhos sobrepostos mesmo em ataques sem dano circular. Causa confirmada em `EnemySwarm.ts`: todo windup chama `effects.warning(..., 'intent')` incondicionalmente, antes de acrescentar linha/cone. Escolher aviso pelo ATAQUE atual, não só pela espécie. Mordida comum: animação/som de preparo, sem círculo no alvo. Milho/sementes direcionais: direção/muzzle, sem área circular. Investida: faixa correspondente ao trajeto e largura de contato, sem anel extra; laser: direção real. Chefe: cone só na varredura, círculos só onde explosão/raízes/fogo/ácido realmente atingem. Chamadas BOSS_ATTACKS também têm intent de raio diferente do efeito; auditar todas. Invocação usa sinal distinto de perigo. Hoje `line()` estica um torus e vira uma elipse: criar faixa/retângulo apropriado. Forma, tamanho, local e momento do aviso devem corresponder ao dano real, com pool/reset funcionando. Testar cada ataque e screenshot em multidão. Preservar sinais úteis, eliminar falsa informação de área.

## Bug novo — mira da primeira skill
Usuário reproduziu: solta MP I para um lado, vira a mira/mouse para o outro e a arma continua atirando na direção inicial. Corrigir para cada NOVO disparo da sequência usar yaw/pitch atuais (mira viva em horizontal/vertical), incluindo sockets e animação dos braços. Balas já em voo conservam trajetória. Não reutilizar castYaw/castPitch ou forward capturado ao soltar para toda a rajada. Pode manter breve preparo cinematográfico, mas liberar controle e orientação na fase de tiros. Testar MP I girando 90°/180° durante execução; câmera, canos, VFX e raycasts precisam concordar.

Achado após etapa 6: `Vector3.LerpToRef(fanDirection, camera.forward, dt*3.2); normalize()` NÃO resolve giro de 180 graus: vetores antipodais mantêm a direção anterior após cada normalização com t<0.5. Mesmo MP II usa esse padrão. Para disparos novos copiar mira atual (ou interpolar yaw pelo menor arco com tratamento antipodal, se realmente necessário). Teste explícito com forward oposto, não só ângulo pequeno.

## Direção de áudio atualizada pelo usuário
Usuário acha os vocais dos bichos bizarros, parecendo gato e kaiju. Revisar/remover esses timbres genéricos de animais/monstros enormes. Identidade desejada: casca que range/racha, caroços/sementes estalando, folhas agitadas e impactos de polpa, com sons curtos e volume controlado. Manter distinção entre espécies e avisos de ataque; não resolver simplesmente silenciando todos os inimigos. Usar gravações locais/licenciadas, documentando seleção. Evitar pitch extremo que vira miado ou urro. Sons de hit no jogador continuam prioridade e não podem ser mascarados por vozes ambientes.

## Revisão técnica já disponível — leia antes da validação final
`docs/CLAUDE_MOVEMENT_REVIEW_2026-09-15.md` está pronta (read-only). Corrigir achados reais de reset do dash, conflito dash/esquiva/recuo, faces íngremes excluídas pelo índice e divergência de atributos/inputs em coop. Itens ainda sem integração são pendências esperadas das etapas seguintes, não presumir concluídos. Completar testes reais de dash/declive/cargas.

**Correção da direção de balanceamento:** a leitura inicial de 9 m/s confundia tuning bruto com movimento efetivo (antes caminhada ~5.4, sprint ~8.1). Portanto 5.5/8 praticamente não nerfam movimento. Adotar caminhada **4.4 m/s** e corrida **6.8 m/s** inicialmente, mantendo resposta imediata e itens de velocidade perceptíveis. Isso substitui os valores provisórios 5.5/8 do briefing e da etapa 1.

## PRIORIDADE NOVA — posição da recompensa
Usuário: "Quando passar a horda deve dropar o item no lugar do monstro que matou para concluir ou proximo". O local atual fixo de recompensa foi explicitamente substituído. Armazenar posição da última morte que conclui horda/chefe, resolver chão próximo acessível e ejetar item ali. Evento de totem por tempo usa último abate local válido ou o próprio totem. Nada de exigir matar todos para satisfazer essa âncora visual; manter progressão por sobrevivência. Recompensa deve existir uma vez e marcador precisa usar posição final real. Testar morte no ar/perto de borda.

## PRIORIDADE NOVA — áudio pedido pelo usuário
O usuário relatou nesta sessão: "ta faltando barulho de hit quando os inimigos me acertam, e impacto dependendo da habilidade". Implementar na etapa de áudio do briefing, auditando de ponta a ponta o evento de dano recebido, volume/mix, limites de repetição e sons específicos de cada impacto. Não tratar o som da arma atirando como substituto do impacto. Dano periódico de fogo pode ter cadência controlada; o primeiro acerto direto sempre precisa ser audível. Checar inimigos corpo a corpo e projéteis, especiais I/II/III, tiro em pedra/terra/madeira/carne, erros/misses silenciosos quanto a hit.

## Estado da delegação
Primeira chamada bloqueada por OAuth expirado; após abrir PowerShell para login, a segunda chamada começou com sucesso. Claude está executando o briefing, log local `.temp/claude-expedition-retry.jsonl`.

## Alterações diretas do Codex
- `src/ui/PlayerHUD.ts`: hierarquia de relatório de morte com score discriminado, tempo, abates, itens, hordas e créditos. Score inicial: 100/abate + 500/horda + 75/item + segundos vivos. Substituir contribuição das hordas por totens quando integrar o novo modo.
- `src/style.css`: canvas visível durante relatório, painéis translúcidos, área central livre, inventário rolável e layout responsivo. Barras comuns sem nomes/números visíveis.
- Typecheck passou. Relatório conferido em navegador com morte via botão QA, 36 s, 1 abate e 1 item: score 211, corpo e cenário visíveis, inventário à direita, valores no rodapé e botões legíveis. Barras comuns conferidas em combate sem nomes/números visíveis. Reinício/responsividade ainda em revisão.
- Claude pode editar `PlayerHUD.ts` para integrar objetivos, mantendo estrutura `.defeat-report`/`.defeat-score`. CSS está sob autoria do Codex nesta etapa.

## Referência de texturização obtida
**Divisão nova:** Claude separado implementa só `src/world/materials/StochasticGroundPlugin.ts`, testes/fixture e `docs/CLAUDE_TERRAIN_MATERIAL_DELIVERY.md` seguindo `CLAUDE_STOCHASTIC_MATERIAL_TASK.md`. Principal integra nos materiais do mundo após entrega; não criar plugin concorrente. Codex revisa A/B no navegador. Principal segue responsável por relevo, árvores/vento, clima e integração.
Clone local: `.tools/references/three-hex-tiling`.
Fonte: https://github.com/Ameobea/three-hex-tiling
Commit: b27c1107495eb5c85d5ceab4ea3cb6d03fe2e1bb
Licença MIT, Casey Primozic e outros, 2023–2024 (preservar aviso se adaptar código).
Referência suporta albedo, normal, roughness e metalness coerentes, até três amostras por mapa. Adaptar GLSL ao Babylon MaterialPluginBase, sem adicionar Three ao jogo. Isso reduz repetição, não inventa resolução de textura. Variação macro de cor/umidade + escala micro deve evitar ilhas com aparência de tabuleiro ou manchas hexagonais.

## Direção de arte
- Combate desarmado: progresso registrou Fire_R/Fire_L/Release como substitutos de soco/chute. Isso ainda não atende à aparência pedida: não chamar combo visual concluído só por causar dano. O GLB público tem esqueleto/bones acessíveis; avaliar camada de poses dedicada de braço/perna/quadril com antecipação, contato e recuperação para direitas/esquerdas/gancho/chutes/giro, preservando locomoção. Falta de `art/` original limita clipes autorais externos, mas não impede pose dedicada sobre o rig disponível. Revisar no navegador cada golpe antes de aprovar.
- Observação no jogo atual: afloramentos ainda lembram blocos retangulares gigantes; plantações/ripas repetem intervalos muito uniformes. Vários picos de pedra alinhados no horizonte deixam as bordas artificiais. Quebrar essa repetição com massas geológicas assimétricas, cobertas parcialmente por solo e vegetação, sem bloquear circulação.
- No HUD, contador de hostis usa coluna de 30px e quebra `8 / 28` em três linhas em 1165px. Remover contagem/cota do centro de atenção ao integrar sobrevivência; usar pressão/ameaça e progresso do objetivo.
- Terra em massas largas, trilhas em tons de ocre, manchas de vegetação com tamanhos variados; pedras formando afloramentos e degraus plausíveis, sem colar fileira repetida de blocos na borda.
- Cada ilha precisa de silhueta de relevo: crista baixa, depressão e terraços ligados. Preservar chegadas das pontes e entradas das casas. Colisão e malha são o mesmo compromisso, nunca relevo puramente em shader.
- Vegetação: raiz firme e flexão nas extremidades; árvores com alpha-test, normais e backface corretos, copa consistente entre LODs. Não aplicar balanço de tronco inteiro em árvores gigantes.
- Objetivos: quatro marcos com numeração e feixe discreto; energia âmbar quando disponível, menta durante carga, núcleo escuro/com luz residual ao concluir. Propulsores usam a mesma linguagem menta, sem confundir com ataque inimigo.
- Câmera acompanha intenção sem tirar mira do jogador. Lentidão apenas para finalizações especiais com intervalo. Evitar flash branco em toda morte.
- Frutas: casca saturada, interior claro, sementes escuras, poucos fragmentos grandes com massa mais partículas leves. Sem chuva infinita de polígonos.
- Clima preserva identidade e navegação: sol quente, sombra fria, tempestade azul-esverdeada, noite com recortes das ilhas e totens visíveis; transições contínuas.

## Mecânicas e referências
Referência de combinação de combate/movimento e progressão: notas oficiais de Dead Cells, https://dead-cells.com/patchnotes/21 . A proposta Ressonância da Colheita é uma hipótese de design deste projeto, sem alegação de nunca ter sido tentada em outro jogo.
Step Tracker: link exato solicitado ao usuário; não localizado com segurança. Não confundir com pedômetros para Android.

## Reproduções adicionais
- QA: `fatal-player` não mata ao receber todos os itens, pois o dano igual ao HP é reduzido por armadura. Ajustar comando de diagnóstico para dano letal efetivo (apenas QA), sem alterar regras de dano de gameplay. Isso bloqueia testar o relatório cheio diretamente com o botão existente.
- Copas inspecionadas como PNG e como GLB: alpha existe nas duas texturas; materiais de folhas originais são BLEND/doubleSided. No bosque, copas parecem ralas e com perda de massa na distância. Revisar transição por tamanho aparente/raio da copa e densidade das variantes; não é ausência de canal alpha.
- Uma segunda tarefa Claude SOMENTE de revisão técnica está escrevendo `docs/CLAUDE_MOVEMENT_REVIEW_2026-09-15.md`; não há segundo autor de código.
- Planaltos, ponto QA `431,18.7,280`: trilha geometricamente plana até o horizonte, pequenos tufos idênticos; céu azul saturado domina toda metade superior. Necessário relevo local e atmosfera que separe planos sem ocultar rota.
- Teleporte QA cidade → planaltos: HUD permaneceu `10/32`, zero por nascer, sem inimigos locais; confirma necessidade de reciclar distantes e spawn centrado no jogador.
- Reiniciar pelo novo relatório zerou tempo, abates, itens, créditos e removeu relatório da interface. Cenário voltou a rodar.
- Relatório também verificado em fixture do componente real (`.temp/hud-review.html`, explicitamente marcada DADOS SIMULADOS), 92 definições/230 itens, 800×600: sem overflow horizontal, inventário rolável, métricas sem sobreposição. A fixture testa layout apenas. CSS corrigiu a quebra do contador `10 / 30` em três linhas.
- Causa provável dos passos: `FootingPresentation.update` dispara por distância fixa de 1.65 m; isso é independente do clipe direcional e do pé apoiado. Referência alternativa identificada: https://github.com/dropecho/unity_footstep (detecção de contato/animation events); NÃO é o Step Tracker pedido, não alegar que seja. Modelos neurais como UnderPressure são desnecessários para este caso de clipes conhecidos.

## Revisão adicional 20:18 — integração e copy pendente
- `PlayerHUD.defeated` ainda soma completedWaves e mostra HORDAS VENCIDAS, sem totens/estágio do modo expedição. Integrar AttemptSummary com objetivos/estágio real e pontuação por marco; preservar modo horda legado e estrutura/CSS do relatório.
- `CombatHUD` texto TAB ainda fala chefes a cada cinco ondas e derrotar chefe para avançar hordas mesmo em expedição. Adaptar copy ao modo atual.
- Codex já ocultou também o nome acima da barra do chefe via CSS (pedido do usuário: só barrinha), e formatou `.run-weather`. Não precisa reeditar CSS.
- Nova cópia no navegador travou em37% por importação dinâmica de shader Vite antiga durante otimização da nova dependência ParticleSystem. Parece cache/dev, não shader do plugin (ainda não integrado). Codex está verificando recarga após otimizador estabilizar; não alterar shader genericamente por isso.

## Direção da rota — uso do mapa grande
QA real nos Campos Altos: todos os quatro marcos ficam428–542m atrás do jogador. A seleção atual ordena só pela proximidade e escolhe Campo inicial, Posto oeste, Lavoura leste, Distrito das Sementes. Isso não atende ao percurso por mapa amplo pedido pelo usuário. Planejar primeiro marco perto da partida e demais distribuídos em distritos/elevação diferentes, por exemplo cidade agrícola → fronteira solar → planaltos, com caminhos reais e validação de streaming/nav. Não aceitar automaticamente os3candidatos quase sobrepostos do início. Garantir geração/validação dos locais antes de exibir no HUD, distância percorrível e no mínimo rota estável sem atravessar vazio. Preservar seed/reset e fallback seguro se um distrito falhar. O usuário deve conseguir explorar entre objetivos, com ameaça local contínua; a run não deve ser quatro círculos no mesmo campo.

## QA desempenho — bosque gigante
Ao visitar rootwood via F1 na cópia de teste (posição883,31.1,355), a HUD mostrou2FPS, versus~38FPS nos planaltos; GPU RTX3080Ti. Estavam prontas/retidas highland-farms,solar-frontier,rootwood. A UI demorou e botões chegaram a dar timeout. Não aumentar cegamente copas/LOD sem investigar frameCPU, render, nav e meshes desse cenário. Meta: copas legíveis e orçamento estável, eliminar explosão de custo. Codex vai retestar depois da implementação.

## QA visual do clima após correção
Na cópia atual, F1 Chuva e Noite mudam o céu REAL e o terreno parece molhado. Noite mantém inimigos e caminho legíveis; feixe disponível agora aparece âmbar. Console sem erros. Porém, nas capturas da chuva (inclusive após alguns segundos), quase não se percebe nenhuma gota contra o céu/celeiro. Revisar legibilidade/escala das gotas e posição do emissor para chuva ser reconhecível, sem virar cortina opaca. A fase foi selecionada antes de pausar simulação para uma captura; não confundir pausa com estado climático real. A cobertura hoje é céu uniforme, aceitável como primeira versão mas ainda sem nuvens com volume/detalhe.

## Coordenação e manutenção do clima
- Claude independente está fazendo só revisão estática read-only do desempenho do bosque, entrega docs/CLAUDE_ROOTWOOD_PERF_REVIEW.md. Leia quando existir, sem esperar antes de continuar outros itens.
- WeatherPresentation guarda materiais de regiões em Map forte, mas verifica `_wasDisposed`, propriedade que não aparece em Material do Babylon instalado. Usar onDisposeObservable/remover registro para não reter materiais descartados pelo streaming. Preservar valores originais e verificar aplicação de umidade em material frozen (no jogo já parece molhado; não quebrar esse resultado).
- Shader StochasticGround está em QA GPU: compilação falha ainda. NÃO integrar até docs/CLAUDE_TERRAIN_MATERIAL_DELIVERY.md registrar correção aprovada no navegador. Codex passou erro exato ao autor.

## QA das poses corporais
Expor no F1 revisão do combo desarmado com ciclo lento e possibilidade de ver cada golpe/pose de contato, câmera que mostre o corpo inteiro e saída limpa para jogo. Codex precisa verificar soco direito/esquerdo/gancho/chutes/giro sobre rig real, não só eventos de dano. Não usar browser para revisar; preparar controles. Preservar controles e origem ao sair/resetar.

## Assets de clima prontos — Codex
- Texturas originais novas: public/textures/weather-rain.svg e weather-mote.svg. Usar em WeatherPresentation; a largura física da gota atual~.035m com alpha.35 pode ser pequena demais a8m. Ajustar com moderação e QA.
- Gravação real de chuva CC0 obtida e manifest rain integrado: public/audio/weather/rain-ylmir-01.ogg. Fonte/licença em docs/licenses/rain-ylmir.md. Não existe mais bloqueio de falta de gravação. Atualizar comentário de ambientRain no RecordedAudio. Verificar início após prepare/context unlock e suspensão/retomada/reset: evento onRain não deve ser perdido se buffer ainda carregando e intensidade permanecer fixa.

## StochasticGround liberado para integração
Correção do shader testada pelo Codex em GPU real na fixture após reload: dois lados renderizam. Comparação brown_mud_02 e brown_mud_leaves_01 com12xUV revela redução clara das faixas repetidas. Autor ainda conclui testes/relatório. Usar whitelist existente; confirmar no mapa. Não chamar aumento de resolução nem prometer remover todo padrão.
- A/B adicional: rock_face_03 aprovado na fixture, toggle desligado devolve original; sem erros novos. Testados terra batida, folhas e pedra. Falta medir custo em mapa carregado.

## Revisão visual real da nave — render do modelo
Codex renderizou art/blender/Dropship_Insertion_Deck.blend (Cycles24amostras, câmera ortográfica3/4) em .temp/dropship-review.png. Estrutura geral mostra deck aberto e corrimãos corretamente, mas precisa destes ajustes antes de aprovar:
1. Casco e suportes ficaram marrom-listrados, parecendo madeira, sobretudo a superfície enorme do disco. Trocar para metal pintado grafite/oliva com desgaste moderado; reduzir esticamento/repetição e aspecto de tábuas. Preservar PBR e export compatível glTF.
2. A faixa inteira da boca ficou branca brilhante. Usar marcação de perigo amarelo/preto sem emissão, com guias menta pequenas nas laterais; não uma placa luminosa branca cobrindo a saída.
3. Escoras diagonais abaixo do meio do deck parecem penduradas sem terminar em outra peça. Conectar extremidades a volumes estruturais reais ou remover.
4. Propulsores laterais parecem caixas com face acesa. Modelar boca/nozzle com profundidade, aro e recesso para leitura de motor; manter poucas peças e LOD simples.
5. Verificar contato dos pés nos relevos/ripas do piso (são~.1m acima do deck): corrida não deve atravessar nem flutuar. Revisar na cinematográfica real; render isolado não valida personagem/câmera.
Não mudar o asset para cubos em runtime. Refinar modelo Blender real e exportar nova versão preservando fonte. Codex fará nova renderização e QA no jogo.

## Relatório da expedição — layout revisado
Codex atualizou CSS para6indicadores e alinhou a base dos números. Fixture do PlayerHUD real com dados simulados (estágio3,3/4marcos,249abates,230itens,score46985) conferida1280×720 e800×600: sem sobreposição, inventário rolável à direita e área central livre. No modo compacto600×480, relatório vira fluxo rolável. Isso valida layout; a morte real com novos dados ainda requer teste integrado. Não editar CSS sem coordenação.
# Nave — QA adicional no navegador

Na aba de revisão `?review=arrival`, o botão Jogar iniciou corrida no deck e a captura seguinte mostrou o personagem mergulhando de cabeça sobre as ilhas. A sequência encerrou e devolveu o HUD/controle ao chão com cronômetro 00:02 e vida130/130. O impacto e o levantar não foram capturados em detalhe nessa passagem; não tratar como aprovação quadro a quadro. A composição do menu confirma casco/guarda-corpo com listras marrons parecendo madeira e o pé parece sem contato firme: polimento solicitado em `.temp/claude-intro-polish.jsonl`.

# Trabalho concreto: entrada da nave e revisão corporal

Você implementa; Codex dirige e faz QA no navegador. Não usar browser, Playwright/Puppeteer, screenshots, stash/reset/commit/push. Usuário autorizou estas mudanças na sessão; não pedir novamente. Leia SESSION_BRIEF_2026-09-15, CLAUDE_DELIVERY_2026-09-15 e VISUAL_FEEDBACK_2026-09-15 para contexto.

## Propriedade
Você pode editar PlayerScene.ts, MeteorArrival.ts, CharacterVisual.ts, FreefallFlutter.ts, novos módulos de intro, MeleePoses.ts, DebugOverlay.ts, PlayerHUD.ts/CombatHUD.ts e WeatherPresentation.ts/WeatherCycle.ts conforme itens abaixo. NÃO editar CSS, FarmWorld, streaming, física, GroundMaterials, StochasticGroundPlugin, EnemyAudioLab/Overrides/Catalog nem assets originais. Outro Claude cuida de terreno/vegetação e outro corrige shader. Preserve toda integração atual e alterações preexistentes nos arquivos. Audio RecordedAudio só se necessária integração pontual, sem alterar controles de substituição do usuário.

## 1. Entrada cinematográfica completa
Personagem aguarda em uma plataforma aberta de nave antes do play. Ao jogar corre na plataforma, salta pela borda, mergulha de cabeça, atinge chão com impacto/poeira/som, recupera o corpo e levanta antes de liberar controle. Construir nave/plataforma visível e plausível (deck, volume estrutural, corrimão nas laterais, saída aberta), compondo modelos reais existentes. Base concreta: `public/models/alien-world.glb` contém `FruitSaucer`, usado por AlienWorld.ts; os GLBs de mundo contêm peças de passagem/estrutura que podem ser instanciadas sem reimportar a cena toda. Respeitar a regra visual do usuário em `.claude/skills/no-procedural-3d-in-games`: não substituir modelos por blocos/cones. Derivar/compor assets reais, sem retângulo flutuante solitário. Não tocar assets originais.

O GLB público gunslinger tem rig/clipes: ler e usar; poses procedurais/aditivas dedicadas podem completar transições. Não tratar falta de Blender/art/como bloqueio. Preservar correções em MeteorArrival/FreefallFlutter, integrar em vez de teleporte. Câmera acompanha corrida/mergulho, dá contexto do destino, controla shake/FOV e retorna suave ao gameplay; entrada curta, clara, com opção acessível de pular se adequado. Reset/reinício/cancelamento não deixam personagem suspenso, câmera presa, sons tocando ou controles liberados na hora errada. Co-op não pode rodar colisão/entrada divergente. Entregue fluxo completo, não só estrutura.

## 2. Poses de corpo a corpo e QA
MeleePoses já substitui Fire_R/Fire_L por poses dedicadas, mas Codex ainda não viu. Adicionar F1 revisão de combo lento, controle para etapa/pose de contato, câmera de corpo inteiro e saída limpa. Conferir curvas com rig real e guarda das armas. Se houver acúmulo de transformações ou pernas ignoradas por blended animations, corrigir. Não afirmar animação aprovada por testes estáticos.

## 3. Revisões pequenas de apresentação já observadas
- PlayerHUD.defeated ainda usa completedWaves e HORDAS VENCIDAS. Integrar estágio/marcos efetivos da expedição e score por marco, mantendo modo legado, estrutura/CSS atual do relatório. TAB CombatHUD ainda diz chefe a cada5ondas; adaptar copy ao modo.
- WeatherPresentation usa `_wasDisposed`, inexistente no Material instalado; remover registros de materiais por onDisposeObservable para não reter regiões descartadas.
- Chuva/noite/solo molhado agora se veem. Porém gotas quase invisíveis nas capturas: melhorar tamanho/alpha/posição e usar textura dedicada que Codex fornecerá em public/textures/weather-rain.svg se existir; pólen usa weather-mote.svg se existir, evitando reutilizar anel de totem. Não produzir cortina opaca. A noite está legível: preservar.
- Grupo rain no manifest ainda falta. Não inventar gravação ou trocar por respingo de passo. Codex vai providenciar fonte licenciada; preserve gancho existente.

## Entrega
Testes significativos do fluxo intro, cancel/reset e integridade das poses; typecheck e testes focados. Não executar suite inteira repetidamente. Documentar posições/controles QA e resultado em docs/CLAUDE_INTRO_PRESENTATION_DELIVERY.md; atualizar após cada integração. Persistir até entrada completa e controles de revisão prontos. Codex verificará visual e retornará correções. Não pedir permissão para trabalho já autorizado.

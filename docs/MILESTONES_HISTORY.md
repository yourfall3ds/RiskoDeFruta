# Estado dos marcos

**Revisão atual: rodada completa integrada, 60 testes aprovados e build validado.** Consulte [RUN_IMPLEMENTATION.md](RUN_IMPLEMENTATION.md) para o estado atual, fontes e limitações. Os registros abaixo são históricos: pendências de IA, itens, boss, pontes e cachoeiras neles descritas foram superadas nesta revisão. Fidelidade artística e medição de desempenho são avaliadas separadamente; nenhum teste de código certifica semelhança visual.

**Registro anterior (histórico):** cenário padrão substituído por fazenda em ilhas suspensas, com arquitetura texturizada no Blender, vegetação fotogramétrica e céu cósmico. **42 testes aprovados**, incluindo travessia da subida até a porta do celeiro e limites elípticos das ilhas; build de produção aprovado. Armas nas palmas e três espécimes com vida/reação/queda preservados. Ver `WORLD_PRESENTATION.md` e `WEAPON_AND_ENEMY_REVIEW.md`. Os registros por marco abaixo preservam o histórico.

## M10 antecipado — ambiente inicial de 06/09/2026

- [x] Celeiro vermelho, silos metálicos, moinho, cercas e canteiros em uma composição fixa exportada pelo Blender.
- [x] Ilha principal, platô elevado acessível por rampa e seis ilhas distantes decorativas.
- [x] Rochas, árvores e plantas texturizadas CC0; caminho de terra com material próprio e vegetação nas bordas.
- [x] Céu cósmico com planeta, iluminação ambiente HDRI, sol quente, ACES, bloom e sombras.
- [x] Importação assíncrona com entrada bloqueada até carregar mundo/personagem/armas; bancada anterior em `?mode=training`.
- [x] Scans com malhas compartilhadas e redução adicional para ilhas distantes. GLB final: 31.101.556 bytes; original de composição: 141.554.992 bytes.
- [ ] Fidelidade final às quatro referências. Faltam frutas/canteiros próprios, cachoeiras, pontes suspensas, cavernas/portais, tratores, raízes e acabamento dos penhascos.
- [ ] Benchmark de hordas e validação completa de todas as rotas. Os três inimigos ainda são espécimes de treino.

Fonte de arte final desta revisão: `art/blender/Farm_World_Dressed.blend`. Reprodução: `build-farm-world.py`, `optimize-farm-world.py`, `detail-farm-world.py`, nesta ordem.

## M0 Foundation — implementado

Arquivos centrais: `src/core/*`, `src/engine/*`, `src/game/*`, `src/content/*`, `src/ai/AIScheduler.ts`, `src/debug/DebugOverlay.ts`. Dependências exatas em `package.json` e lockfile. Estrutura final e interfaces descritas antes da implementação e registradas em `ARCHITECTURE.md`.

Critérios de aceitação:

- [x] TypeScript strict, Vite, imports Babylon modulares, WebGL2.
- [x] Bootstrap, feedback de erro de inicialização e cleanup de aplicação/HMR.
- [x] Scene lifecycle e reinício com mesma/nova seed.
- [x] Simulação fixa 60 Hz com render desacoplado e suspensão em aba oculta.
- [x] Event bus com eventos exigidos pelo prompt, entidades leves e contrato de dano.
- [x] RunRNG com streams independentes e conteúdo registrado/validado.
- [x] Infraestrutura de pooling limitada e AI scheduling.
- [x] F1 com métricas reais e controles M0. Recursos futuros não são botões falsos.
- [x] Typecheck/build/testes automatizados e fluxo de diagnóstico no navegador.

Testes automatizados cobrem equivalência de simulação em taxas de render diferentes, catch-up/pausa, isolamento de streams, propriedade de listeners, validação do conteúdo, ciclo das entidades, reset/capacidade dos pools, troca/falha de cena, justiça do scheduler com 300 jobs e cinco reinícios com cenas Babylon reais via NullEngine.

Validação WebGL2 no navegador local: cena visível, F1 e métricas operacionais. Observação inicial: ~60 FPS, 14 draw calls, 12 entidades de teste, pool 12/24 sem esgotamento. Isso não é benchmark de gameplay, nem aprovação do alvo de 50 inimigos. Frame CPU não representa tempo GPU.

Resultado final: **12 testes aprovados em 2 arquivos**, typecheck aprovado e build de produção concluído. No navegador, F1 abriu/fechou o diagnóstico, pausa manteve o tick fixo, reinício com mesma seed zerou ticks/IA sem aumentar meshes ou pool, nova seed alterou a URL e a distribuição, e retomar reativou a simulação. Prévia de desenvolvimento deixada em execução em `http://127.0.0.1:5173/`.

## Requisito que habilita M1

**Todos os critérios M0 acima aprovados**, permitindo que input, player e câmera usem uma simulação determinística por seed/entrada, lifecycle testado e diagnóstico operacional. M1 deve iniciar com PlayerTuning/CameraTuning, ações de input, cápsula independente do visual e testes de movimento/colisão. Meshy não é dependência.

## M1 e protótipo de habilidades — revisão de 06/09/2026

- Movimento, salto, coyote/buffer, esquiva dupla, retorno do vazio e colisão estão no campo jogável.
- Câmera sobre o ombro substitui a composição central original por instrução posterior do usuário: 2,25 m, FOV vertical 60°, personagem no terço esquerdo. Testes de projeção em 1672×941 e 718×696 e retração diante de parede aprovados.
- Pistolas alternadas a 6,7 tiros/s com hitscan, recoil por braço e impactos. Teste manual no navegador: 6 acertos em 18 disparos antes da revisão de câmera. Modelo visível e solo/céu revisados após a alteração.
- MP: thresholds exatos de 0,6 / 1,4 / 2,6 s, UI segmentada, tons diferentes, liberação sem cooldown; pistolas bloqueadas durante carga e velocidade reduzida a 70%. Perfurante duplo, leque com deslocamento para trás e tempestade automática de três segundos em alvos de treino.
- Testes Babylon NullEngine verificam perfuração de múltiplos alvos, distribuição da tempestade e obstrução por paredes. Cancelamento ao perder foco/pausar evita liberação involuntária.
- GLB do personagem: 2.580.820 bytes, uma malha com skin, texturas 2K, locomoção e novas poses Aim/Fire_R/Fire_L/Charge/Release. Arquivo de trabalho: `art/blender/Gunslinger_Combat.blend`.
- Solo PBR e céu HDRI locais de Poly Haven CC0; licenças em `ASSET_LICENSES.md`. Ilhas distantes sem textura removidas.
- **33 testes em 5 arquivos aprovados**, typecheck e build de produção aprovados. Bundle principal ~1.905 kB minificado / 471 kB gzip; aviso de tamanho do Vite permanece.

Isso não aprova os marcos M2/M3 completos: MP usa alvos de treino sem vida/reação de inimigos, e Backflip Barrage ainda tem apenas deslocamento e leque, sem animação de backflip própria.

## TODOs reais

- M1: animação de salto própria e acabamento das poses. Arma fornecida já presa às palmas; o rig não tem dedos individuais. Walk está preservada no GLB, mas a locomoção digital seleciona Run/Idle. Colisão atual usa AABBs expandidos e rampas simples; não é solução geral de cápsula contra triângulos e paredes de inclinação arbitrária.
- M2: ragdoll, áudio final e inimigos com comportamento. Vida/reação/queda já existem para três espécimes, com DamageContext e VFX limitados.
- M3: animação de backflip e integração de MP com dano, crítica e procs de inimigos reais. Valores de dano/quantidade dos protótipos precisam de balanceamento.
- M4–M9: navegação, espécies e comportamentos, director, itens/procs, economia, boss e wormhole.
- M10: acabamento final das referências e itens em aberto na revisão do ambiente acima.
- M11: benchmark de 50/100/150 hostis, animation LOD, shadow budgets e compressão de assets. 300 jobs vazios não aprovam 300 hostis.
- Avaliar split/lazy loading do bundle real com loaders e HDRI, sem apenas esconder o aviso de tamanho.
- TEMP_ASSET_REQUIRED: props agrícolas finais, frutas, raízes e cenário final. Não declarar a cena idêntica às referências.
- Três rigs de inimigos preparados; navegação e ataques específicos ainda pendentes. Gunslinger preparado em cópia de trabalho.
- Persistência de runs, replay completo e determinismo entre backends não fazem parte do M0.

O restante do master prompt continua como especificação dos marcos futuros. M0 não equivale ao vertical slice aprovado da seção 78.




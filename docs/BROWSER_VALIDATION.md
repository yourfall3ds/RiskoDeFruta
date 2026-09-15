> HISTÓRICO de 06/09, anterior à restauração dos cinco inimigos e aos baús aleatórios. O estado vigente, validações e limitações estão em [CURRENT_IMPLEMENTATION.md](CURRENT_IMPLEMENTATION.md). Limites de população, roster, áudio e escolhas abaixo descrevem a versão antiga.

# Validação no navegador — 06/09/2026

Build de produção local, WebGL2, janela de teste em 1280 × 720, resolução nativa, seed `0224ab8685107f9f`. GPU informada pelo ANGLE: NVIDIA GeForce GTX 1650 / Direct3D11. Medições observacionais na máquina em uso, sem isolar outros aplicativos.

## Fluxos exercitados

- Carregamento completo de mundo, personagem, pistolas, sete espécies e chefe; botão de entrada liberado após os assets.
- Tiros por clique: três disparos e dois acertos registrados na primeira amostra, com número de dano visível.
- Mercado: três ofertas diferentes; compra pelo teclado descontou 45 de 100 créditos, adicionando Cristal de mutação ao inventário.
- Tempestade de tiros acionada pelo comando explícito de QA: 8 abates, 80 créditos e XP suficiente para subir ao nível 2; efeito terminou sem continuar disparando.
- Barragem com mortal via QA: personagem recuou 4 m, pose aérea visível, dano em leque e mais três abates. Testes automatizados cobrem o arco e o retorno ao chão.
- Chefe chegou pelo director com população cheia. Finalização acelerada via QA acionou morte, recompensa, fragmentos e formação da fenda.
- Após cinco segundos, a fenda apareceu. Interação real por E levou ao estágio 2: dois itens preservados, 215 créditos convertidos em XP, nível 4, 166 HP, hostis reiniciados em zero e novos preços.
- Pausa por Esc funciona também sem pointer lock; menu permite continuar e alternar qualidade.
- Recargas/reinícios mantiveram uma instância do HUD e nove listeners do EventBus da rodada. Os comandos de invulnerabilidade e população não persistem no reinício.
- Console: nenhum erro novo nas revisões finais. Um erro de instrumentação de GPU observado às 20:00 foi corrigido pela importação da extensão correspondente do Babylon antes dos testes finais.

Os comandos de QA de habilidades/chefe não constituem uma partida vencida por jogabilidade normal. Os tempos de carga de MP, dano, procs, colisão, pontes e progressão também são cobertos pelos testes automatizados.

## Desempenho e limites

Qualidade Alta: sombras PCF 2048, SSAO em meia resolução, bloom, ACES e FXAA. Equilibrada: sombras 1024 e SSAO desligado; texturas, modelos próximos, câmera e resolução de saída são preservados. A troca pode provocar um pico temporário de compilação de shaders.

As métricas de CPU e GPU são médias recentes de um segundo. FPS usa a janela do engine; esses números não formam necessariamente uma soma exata. Contagens de triângulos incluem o LOD selecionado na câmera, sem multiplicar passagens de sombra/pós-processamento. O pico/falhas de tiros se refere ao pool das pistolas; atividade/capacidade inclui também os efeitos inimigos.

A população normal é limitada a 50. Os botões de 100 e 150 são testes de estresse explícitos. Não foi atingida a meta de 60 FPS sustentados com 50 inimigos concentrados em qualidade alta. Não certificar performance nem fidelidade artística com base no resultado dos testes de código.

Amostras registradas durante a sessão, antes da última substituição das copas/atmosfera. Jogador parado, invulnerabilidade de QA e inimigos concentrados próximos; picos de criação/troca de shader foram excluídos destas linhas. Não são percentis de uma execução isolada nem comparação perfeitamente sincronizada entre presets.

| Cena / qualidade | Hostis | FPS observado | CPU recente | GPU recente | Draw calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Entrada, Alta | 0 | 60 | 7,97 ms | 9,90 ms | 108 |
| Horda, Alta | 50 | 47 | 13,99 ms | 11,92 ms | 184 |
| Horda e chefe, Alta, contatos limitados | 50 | 55 | 11,56 ms | 15,16 ms | 186 |
| Horda, Equilibrada | 50 | 46 | 14,22 ms | 8,95 ms | 175 |
| Estresse e chefe, Equilibrada | 100 | 21 | 26,83 ms | 9,45 ms | 245 |
| Estresse e chefe, Equilibrada | 150 | 14 | 39,71 ms | 16,54 ms | 310 |

Os testes de 100/150 identificam o limite prático desta versão; não são os limites da partida normal. A última passagem adiciona copas texturizadas mais leves e muda a orientação inicial para −0,13 rad, mantendo FOV 60° e distância de 2,25 m.

Após essa passagem, uma nova amostra de horda com 50 hostis em Alta registrou 33 FPS, CPU 21,99 ms, GPU 9,75 ms e 183 draw calls (54 segundos de rodada, 76 efeitos ativos). A variação reforça que os valores anteriores não certificam 60 FPS nem um ganho sustentado das otimizações. Outra passagem pelo portal, com o material violeta final, confirmou estágio 2 e conversão dos 50 créditos em XP. O acesso ao celeiro recebeu 32 degraus e corrimãos de madeira texturizada no Blender; a superfície de colisão contínua preserva a circulação do jogador e da IA.

## Verificação automatizada e arte

60 testes aprovados em 11 arquivos; TypeScript strict e build aprovados. O Vite ainda avisa sobre o tamanho do bundle principal (aproximadamente 1,8 MB antes de gzip). Fontes Blender finais abertas e verificadas: `art-validation.json`. Materiais orgânicos corrigidos, atlas de brócolis aplicado e arco da fenda desobstruído. A comparação às referências ainda mostra diferenças de arquitetura, anatomia de algumas variantes, densidade e acabamento.

A escadaria foi inspecionada no build de produção após exportação, com degraus e corrimãos visíveis e transparência das copas preservada. Build e abertura das fontes Blender foram repetidos após essa edição de arte. Ao encerrar a validação, a janela de teste voltou ao tamanho original e a aba de desenvolvimento foi deixada no menu de entrada, sem invulnerabilidade de QA.


### Revisão no navegador e custo por etapa — 12 setembro
- Servidor D estava parado (conexão recusada). Iniciado npm run dev em 127.0.0.1:5173 com TEMP/TMP no D. Navegador in-app abriu seed trail-review; menu mostrou filme de mergulho, progresso 25/50/100 e botão jogar pronto. Qualidade artística ainda distante das referências; não foi capturada a sequência inteira de aproximação.
- Screenshot de gameplay após chegada confirma personagem visível, MP 100, munição 50, vegetação e cenário. Morte pela horda mostrou VOCÊ MORREU, resumo (horda 1, zero abates, 30 s) e estado sem itens; TENTAR NOVAMENTE · MAPA PRONTO voltou ao gameplay com contadores zerados sem barra do carregamento inicial. Não foi validado layout com 90 itens, nem pause/continue completo.
- Visita QA aos planaltos confirmou trilha texturizada visível e aderida ao relevo à frente do personagem, acesso ao celeiro na esquerda e plantas fora do corredor. Não houve travessia manual de todos os 11 caminhos; os testes físicos anteriores cobrem ida/volta. Capturas foram exibidas pela ferramenta nesta conversa, não arquivadas em PNG nesta etapa.
- Amostras não controladas na GTX 1650/WebGL2: 24–30 FPS na primeira passagem; após atualização do diagnóstico, 40 FPS / simulação 0,38 ms por quadro / apresentação 17,97 ms por quadro / GPU 8,67 ms, uma entidade inimiga. Compilação de shaders, recarga, chamadas da ferramenta e população variaram; não usar como comparação antes/depois nem prova de ganho.
- Application agora mede tempo de todos os passos fixos por quadro e render total (incluindo preparação visual), com média por janela de pelo menos 500 ms. Diagnóstico separa Simulação CPU / Apresentação CPU / Cena Babylon. O contador antigo Frame CPU era somente frameTimeCounter do Babylon e não cobria toda lógica. GPU é medida separada e não deve ser somada ingenuamente aos tempos CPU.
- 11 testes de fundamento/loop aprovados art/tests-workload-diagnostics.log; build aprovado art/build-workload-diagnostics.log. Instrumentação não altera passo fixo ou limites, não constitui otimização de FPS. Próximo perfil deve separar animação, atualização visual e renderização com população/posição constantes.
- Limitação da ferramenta: ação por índice dinâmico acabou acionando Receber item (QA), observada pelo Podador ×1/100 créditos; não considerar essa rodada uma baseline pura. Tentativa por locator seguida de screenshot retornou aba fora da sessão, e listTabs confirmou lista vazia. Revisão não continuou por outro canal e não há estado de aba a preservar. Nenhuma falha de jogo inferida da perda da aba.
- Área permanece 122.560,5037 m² / 14,561690×. Expansão 25×, biomas, densidade, perfil controlado, colisões específicas e restante da fila permanecem abertos.

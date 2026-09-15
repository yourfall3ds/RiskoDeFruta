# Continuidade no disco D:

Projeto ativo: D:\Riskodefruta2. Fila cumulativa: docs/OBJECTIVES_QUEUE.md. Estado atual: docs/CURRENT_IMPLEMENTATION.md.

203 testes / 22 arquivos, TypeScript e build aprovados em 07/09. A última correção entrega o item aleatório dos baús no mundo, após abrir a tampa; E recolhe. Conferido no navegador com Mira de precisão, cobrança única e inventário após coleta.

Iniciar-Jogo.ps1 inicia o servidor em 127.0.0.1:5173 e configura cache/temporários no D:. Ao rodar testes diretamente no PowerShell, definir TEMP e TMP para D:\Riskodefruta2\.temp. C: está com espaço volátil; a cópia antiga continua preservada.

Prioridades restantes: perfil de horda/FPS, revisão visual dos inimigos em todos os estados, resgate de queda, arma do milho aguardando usuário, balanceamento do catálogo e expansão dos mapas e terreno destrutível como pesquisa separada. Não declarar o jogo concluído nem equivalente às referências.

Preservar geometria, UVs e texturas dos cinco inimigos; apenas animações são editadas. Meshy API desativada. Os 90 ícones agora têm 90 definições sorteáveis: atributos cumulativos e hooks existentes, não 90 mecânicas únicas.

A entrada padrão agora é modo de hordas com recompensa por conclusão e chefe a cada cinco ondas. Pistolas com 50 balas, recarga no R, cartuchos gravados. Cinemáticas usam as três vozes originais, preparo heroico e duração completa do áudio. Clipes direcionais e nova fonte: art/blender/Gunslinger_Directional_And_Skills.blend. Consulte CURRENT_IMPLEMENTATION.md para detalhes e limites.

## Sessão de 07/09 — servidor cooperativo (Fase 1) e porte gráfico

Servidor Colyseus 0.18 em `server/` (docs em `server/README.md`, desenho em `docs/MULTIPLAYER.md`): `defineInput`/`setFixedTimestep`/`allowRewindState`, Schema Builder sem decorators, `@colyseus/sdk` no cliente, `@colyseus/testing` e `@colyseus/loadtest` instalados. `npm run server` usa `tsx --tsconfig server/tsconfig.json` (o tsconfig da raiz emitiria decorators TC39 e o `@type` legado quebra). Testes: `tests/net-simulation.test.ts` (7, Node sem DOM) e `tests/net-room.test.ts` (2 clientes reais). Suíte: 227 testes / 27 arquivos.

Porte gráfico vindo do backup C:: supersampling 1,5× com teto de pixels (`createEngine.ts`), MSAA 4× e filtro de sombra HIGH (`TrainingLighting.ts`), projetores de sombra 913 → 103 com `includeDescendants=false` e `SHADOW_EXEMPT` (`FarmWorld.ts`), `tests/render-budget.test.ts`. GPU medida ociosa (0 ms) com CPU em ~6–12 ms por frame: upscalers não ajudam; draw calls sim.

Correções: `PistolMagazine.update` com tolerância (1,35−1−0,35 ≈ 1e-16 nunca zerava). `InputFrame`/`EMPTY_INPUT` movidos para `src/input/InputFrame.ts` (re-exportados por `GameInput.ts`) para o servidor não arrastar a classe DOM.

Pendências fora desta sessão: erro de typecheck em `src/game/EnemySwarm.ts:168` (`readonly Mesh[]`) vindo de edição paralela; C: com ~20 MB livres derruba ferramentas que gravam temporários no C:. Não desenvolver duas versões em paralelo.

Fase 2 (07/09): cliente online em `src/net/` — `NetworkClient` (@colyseus/sdk, InputHandle, Predict), `Reconciliation` (pura, 5 testes), `RemotePlayers` (CharacterVisual por remoto, aiming=false), `NetworkSession` (fachada; `?online=1&server=`). Gancho mínimo no PlayerScene (import, campo, 1 linha no construtor, 3 em fixedUpdate, 1 em render, debug e dispose). 232 testes / 28 arquivos. Overlay F1 mostra RTT/correções. Erros de typecheck restantes são da edição paralela (EnemySwarm.ts:168, PlayerScene ready).

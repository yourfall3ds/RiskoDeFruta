# MP por acerto e custo da horda — prioridade atual

O usuário: “o Mp ta enchendo muito rapido, deveria encher por ataque acertado; quando fica muito monstro ta diminuindo muito o fps”. Implemente ambas as correções. Você é o Claude Code técnico; Codex faz revisão visual. Sem browser, Playwright, Puppeteer ou automação UI. Não commit/push/reset/stash. Preserve todas as alterações concorrentes.

## Propriedade
Pode editar MPCharge.ts, EnemySwarm.ts, módulos novos de orçamento/cache de horda e testes correspondentes. Pode editar PopulationBudget/AIScheduler se necessário e seguro. PlayerScene.ts somente integração mínima de diagnóstico ou MP, sem refatoração. NÃO editar CharacterVisual, AnimationStateMachine (combo Blender em curso), terrain/world/collision (outra tarefa), FruitFragments/FragmentShapes (outra tarefa), áudio/UI/CSS/WeatherPresentation. Nenhuma outra tarefa editará EnemySwarm enquanto esta executa. Leia AGENTS aplicável se houver.

## MP
- Remover regeneração passiva MP_REGEN. Ganhar somente depois de dano confirmado em inimigo vivo. Health.apply emite EnemyHit após aplicar dano; DamageDealt atualmente precede target.onHit em DualPistols, logo não é confirmação.
- Acertos normais de pistola e corpo a corpo devem ganhar MP. Errar, atirar na parede, dano recusado, acertar cadáver, sofrer dano, debug/qa, DOT e procs não devem gerar MP.
- Especiais não se realimentam. Equilibre ganho conservador: sugestão 2 MP por acerto básico confirmado, com limite de ganho para muitos alvos/rajadas no mesmo intervalo (p.ex. teto 6 MP em 1 s, documente decisão). Não confundir attackId (nome da habilidade) com ID único do golpe. Evitar dedupe permanente por nome/alvo.
- A barra pode manter o estado inicial atual; custos e seleção por segurar botão continuam; cargas extras de item continuam independentes da regeneração de MP.
- Testes comportamentais reais: 60s parado não ganha, misses não ganham, dano recusado não ganha, pistol/melee confirmados ganham, procs/skills/qa não, multi-alvo limitado, dois golpes legítimos no mesmo alvo ganham, custos e extras preservados.

## FPS de horda
- Leia docs/CLAUDE_ROOTWOOD_PERF_REVIEW.md para contexto, mas não mexa no terreno. Identifique custos de horda verificáveis antes de alterar: think filtra/ordena todos atores para cada ator; update faz alocações Color3 por mesh por frame; efeitos, skeleton/pose, colisão e visualLOD precisam ser analisados.
- Faça otimização direcionada, evitando filtros/sorts por ator, cacheando por tick relevante e reutilizando scratch arrays/cores quando seguro. Não esconda problema reduzindo brutalmente quantidade de inimigos ou desativando IA/dano/colisão. Boss e ataque próximos precisam continuar íntegros.
- LOD só visual não pode pular lasers/telegraphs/dano. Ocultação de corpo atrás da câmera não pode afetar alvo/colisão ou parar atacante. Preserve fragmentos, reward anchor e marcadores.
- Traga medição reproduzível antes/depois do custo CPU alvo, com populações comparáveis (24/48/80 se suportado). Pode usar fixture headless/NullEngine, rotule honestamente que não mede GPU/FPS real. Não criar benchmark que só testa loop inventado diferente da implementação.
- Testes de comportamento de horda/telegraph/MP, typecheck e relatório docs/CLAUDE_MP_HORDE_PERF_DELIVERY.md com causas, alterações, números medidos e limites. Informe claramente se há gargalo restante sem evidência.

Conclua integralmente esta tarefa delimitada. Não amplie para cálice/chuva/novas mecânicas. Ao terminar libere EnemySwarm/PlayerScene para tarefa cálice.

# Jogabilidade: exploração e passagem de estágio

- Tab abre e fecha o mapa do planeta junto dos atributos. Ilhas e pontes vêm do manifesto real; longitude conecta pelas bordas.
- Regiões não visitadas escuras. Região atual nomeada, jogador com seta e contador de descobertas.
- Cálice só aparece depois da descoberta. Exploração reinicia no próximo estágio e na nova tentativa.
- Terreno colorido com verdes e marrons amostrados do suporte real. Regiões desconhecidas continuam escuras.
- Descobertas atualizadas a 5 Hz; desenho apenas enquanto Tab está aberto, fora da introdução/embarque, sem criar malhas no cenário.

## Verificação manual (2026-09-16)

Na partida `d44232f6ee585d44`, o mapa mostrou Refúgio 18 (1/38). Ao visitar Campo do Retorno, mostrou 2/38 e revelou o cálice. Após usar o controle QA para concluir cálice/chefe, pressionei E no jogo: recolheu suco, embarcou e chegou ao estágio 2 em Horta Suspensa. O inventário preservou Podador de aço x1; nível 2, 55/115 XP. Baús e outro objetivo disponíveis. O mapa reiniciou em 1/38.

Esse teste verifica a transição, não uma vitória completa em combate sem QA. O estágio 2 ainda utiliza o mesmo arquipélago, com outra partida/cálice/baús; não existe bioma artístico novo nesta entrega.

## Inimigos e combate

- Inimigos comuns além de 72 m são desativados, removidos da navegação, colisão e escalonador. Avisos e projéteis associados são cancelados. Chefe e cadáveres não são reciclados.
- Reposição escalonada a cada 1,1 s, em piso válido perto do jogador. Falha de posição devolve orçamento ao diretor. A fila reserva população e não rende abates, XP, créditos ou suco; fim da fase e morte cancelam reposições.
- Alcance de compromisso depende da espécie e do próximo ataque, usando os mesmos limites de investidas e varredura dos avisos/impactos.
- Socos e chutes têm impulso direto reforçado, tangente ao chão. Navegação usa deslocamento comprometido durante o impulso; gigantes e chefe resistem mais. Procs secundários e tiros comuns não recebem a amplificação de corpo a corpo.

## Verificações finais (2026-09-17)

- Na partida d813aeb77e09304d, mudança QA de ilha sem limpar inimigos mostrou 3 distantes removidos e 1 reposto perto; nenhum crédito/XP de reciclagem. Novos inimigos continuaram surgindo. A falta de piso válido pode devolver orçamento em vez de repor imediatamente.
- Na partida 13ce042b07bac558, Tab mostrou terreno verde/marrom, região atual e regiões desconhecidas escuras; outro Tab ocultou mapa e atributos.
- 118 testes aprovados em 10 arquivos: reciclagem, engajamento, movimento real de inimigo após soco/chute, resistência, exploração, jornada, planejamento radial, HUD e áudio de combate.
- O teste de knockback cobre deslocamento físico sem navegação Detour; intensidade visual final em partida permanece para avaliação do jogador.

- Typecheck e build de produção aprovados.

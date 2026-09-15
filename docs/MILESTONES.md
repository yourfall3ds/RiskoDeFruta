# Progresso atual — 07/09/2026

Estado detalhado e evidências: [CURRENT_IMPLEMENTATION.md](CURRENT_IMPLEMENTATION.md). Fila acumulada: [OBJECTIVES_QUEUE.md](OBJECTIVES_QUEUE.md).

- [x] Cinco inimigos originais preservados, navegação Recast/Detour e FSM.
- [x] Mira vertical, grips, leque ricocheteante MP I, barragem MP II distribuída e pose cruzada MP III.
- [x] Ragdoll articulado com orçamento e escala corrigida; knockback e reação ao dano.
- [x] Hordas graduais, população adaptativa 12–32, elites, progressão e 90 itens configurados e cumulativos.
- [x] Dez volumes fechados sob as ilhas, ilha móvel com piso/transporte do jogador, ilhotas e discos voadores decorativos.
- [x] Nascimentos e ataques próprios por esqueleto; cachoeiras com fluxo, poças, vento e áudio gravado.
- [x] Baús com tampa articulada, sorteio único, ejeção, item girando e coleta com E. Validado no navegador.
- [x] 203 testes em 22 arquivos; TypeScript e build aprovados. Navmesh para celeiro/oeste/leste aprovado.
- [ ] 60 FPS sustentados em combate: ainda não certificado; amostra recente caiu a 17 FPS.
- [ ] Revisão visual completa das animações, resgate e comparação com referências.
- [ ] Arma do milho (aguardando asset), balanceamento dos itens e mapa seguinte distinto.
- [ ] Terreno destrutível com atualização real de geometria, colisão e navegação.

O visual ainda não equivale às referências. Os registros históricos não substituem o relatório atual.

- [x] Resposta de dano, colisão cápsula/malha, corrida pós-esquiva e recuo/strafe.
- [x] 50 balas, recarga acrobática, cartuchos com gravações reais.
- [x] Hordas progressivas com recompensa aleatória por onda e chefe a cada cinco.
- [x] Preparo heroico, aura/terra e atuações sincronizadas à duração original das três vozes.


### 07/09 — Ataques específicos, reserva de MP e loading independente
Na cópia D: berinjela atropela com trajetória comprometida no Detour, cenoura dispara laser da arma robótica com cobertura física, caminhada/corrida reduzidas. MP com custo/regeneração/acertos, sons de tiros em canal próprio, tolerância de skills com proteção de cobertura e runas distintas. Filme Blender de queda headfirst, cidade de três ilhas com quatro pontes e navmesh ampliado. 249 testes / 30 arquivos aprovados. Arte equivalente às referências, exploração completa dos novos distritos e 60 FPS sustentados ainda pendentes.


### Distrito das Estufas
Nova ilha conectada com estufas e cinco baús físicos. Área navegável 35.859,0588 m² (4,26×; meta 25×). 22 rotas completas, testes físicos/servidor e build aprovados; evidências detalhadas em WORLD_EXPANSION.md. Composição visual ainda esparsa e desempenho sustentado pendentes.

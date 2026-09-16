# Entrega do Cláudio — 15/09/2026

Relatório do que **está no código**, do que **não está**, e de como cada coisa foi verificada.
O detalhamento por etapa está em `docs/CLAUDE_PROGRESS_2026-09-15.md`.

Não usei navegador, Playwright, Puppeteer nem capturas. **Nenhuma avaliação visual ou auditiva
abaixo é minha** — todas dependem do QA do Codex via CUA.
Não houve stash, reset, commit, push, deploy nem remoção de asset. `src/style.css` e o CSS do painel
não foram tocados. Os arquivos do estúdio de áudio e o `StochasticGroundPlugin` são de outros
autores e eu só os **consumi**.

---

## Validação desta sessão

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | aprovado |
| `npm run server:typecheck` | aprovado |
| `npx vitest run` | **575 aprovados / 581** |
| `npm run build` | aprovado — `dist/index.html` e `dist/audio-lab.html` |

As 6 falhas são a **linha de base já documentada**: `tests/combat-assets.test.ts` (5) e
`tests/hordes-arsenal-catalog.test.ts` (1) leem os GLBs originais em `assets/`, que não está neste
repositório. Confirmei com `git stash` **antes** da primeira edição que já falhavam no checkout limpo.
O aviso de chunk > 500 kB no build também é anterior a esta sessão.

Suítes novas escritas por mim: `expedition-objectives` (15), `expedition-feel` (18),
`unarmed-combat` (14), `skill-charges` (6), `footstep-sync` (8), `reward-anchor` (8), `skill-aim` (6),
`weather-cycle` (16), `melee-poses` (13), `fruit-fragments` (11), `enemy-audio-integration` (10).

---

## Entregue e integrado

### Expedição com quatro marcos (item 1)
`ExpeditionObjectives` + `ExpeditionAnchors` + `ExpeditionSites`. Colocação só em piso largo,
contínuo e com rota (ponte estreita, ilhota e interior sólido recusados). `E` junto ao poste ativa;
permanecer vivo carrega 45/55/65/75 s; sair ou morrer **pausa** sem apagar. Conclusão **não** depende
de eliminar inimigos. Chefe no último evento, com recuperação quando perde rota por 6 s. Fenda avança
o estágio. `?mode=expedition` é a URL explícita; `?mode=horde` e `?mode=classic` mantêm os modos antigos.

### Diretor sempre ativo (item 2)
Anel 15–35 m com piso validado (nada no vazio, em interior sólido ou no corpo do jogador). Modo
`expedition` do `MonsterDirector`: reposição contínua, sem janela de silêncio e sem esperar a
população zerar; `pressure` sobe com o evento. Teto continua sendo o `PopulationBudget`; aposentar
inimigo distante devolve orçamento sem contar abate nem pagar recompensa.

### Física de relevo (parte do item 3)
`TriangleGround.sample` / `CollisionWorld.surfaceAt` expõem altura, normal e inclinação reais.
Acima de 50° o corpo **escorrega** em vez de ficar suspenso — e o `moveAirborne` passou a exigir
normal de piso de verdade para zerar a queda. Essa correção destravou `tests/highland-trails.test.ts`,
que o baseline mais lento tinha exposto: o jogador ficava colado na beira de um penhasco.

### Balanceamento (item 8)
Caminhada **4,4 m/s**, corrida **6,8 m/s**, tiro **3,3/s** — os valores corrigidos pela revisão, não
os 5,5/8 provisórios. Aplicados **também no servidor** (`sprintSpeed` e `setMaxCharges` faltavam lá e
causavam snap-back contínuo em coop). Itens novos `turbine` (corrida) e `reservoir` (carga de
especial) com efeito real; descrições corrigidas.

### Especiais (item 9)
MP I e MP II copiam a mira **do momento de cada disparo**. O lerp normalizado anterior nunca virava
em 180° (vetores antipodais degeneram) — corrigido e coberto por teste com `forward` oposto. MP III
sempre dispara: sem alvo válido, atira para a frente; o rodízio exige alcance, ângulo e linha de
visão. Continuação na janela final consome uma carga de verdade e exige novo pressionamento.

### Corpo a corpo (itens 10 e 7 do plano de continuação)
`V` guarda as pistolas de verdade. Combo de cinco etapas com dano **uma vez por alvo e por etapa**,
alcance/cone/altura e varredura contra cobertura. `MeleePoses` traz **poses autorais escritas nos
ossos reais do rig** (conferidos contra `gunslinger.glb` por teste), com antecipação, impacto e
recuperação, envolvendo quadril, tronco, ombros e pés. O substituto `Fire_R`/`Fire_L` foi removido.
Cadência encurta as três fases juntas. Dash por duplo toque detectado na captura e enviado como
intenção — o servidor valida e não perde mais a borda.

### Câmera e lentidão (item 12, parcial)
Amortecimento com antecipação de 0,55 m que não mexe na mira, FOV de corrida contínuo e lentidão
curta só em finalização forte, com intervalo. A lentidão é **apenas apresentação** — nunca toca o
passo fixo, o diretor ou o servidor.

### Passos pelo contato do pé (item 5)
`FootstepSync` lê a altura real dos ossos dos pés depois do clipe dominante. Funciona igual em
frente, trás, lateral e diagonal; não dispara no ar nem parado; sem duplo disparo na troca de clipe.

### Recompensa no lugar da morte
`RewardAnchor`: morte decisiva → objetivo → campo. Morte no ar desce para o piso; morte na beirada
escorrega para o anel seguro; sem piso em lugar nenhum, não entrega item inalcançável.

### Barras de inimigo (item 6)
Só a barra fica visível; nome e números foram para o rótulo acessível.

### Estúdio de sons ligado ao jogo
`WeaponAudio` consulta `EnemyAudioOverrides` por espécie/evento (mute, volume, arquivo do usuário),
prepara o contexto no `unlock` e descarta no `dispose`. `attack` toca **dois eventos independentes**
(voz e ruído). Os padrões saem do catálogo compartilhado, sem segunda tabela. Arquivo do usuário tem
prioridade e cadência isolada — silenciar o milho não silencia a pistola do jogador. Link no F1 e
`audio-lab.html` como entrada do Vite.
Áudio de dano recebido com timbre por origem e **primeiro acerto direto sempre audível**;
`skillImpact` dá impacto próprio a MP I/II/III e a cada etapa do corpo a corpo.

### Clima (item 14)
Ciclo sol → nublado → chuva → crepúsculo → noite, avançado por tempo e abates, com transições
contínuas provadas por teste ao longo de 6 horas simuladas. O **céu real** (ShaderMaterial do
`SeamlessSky`) recebe cobertura e noite por `applySkyWeather` — não chove mais sob azul fixo.
A **umidade tem consumidor**: materiais de chão por whitelist, molhados a partir dos valores
originais e restaurados no `dispose`. Contraste das fases escuras vem da luz de preenchimento, não
de escurecer o ambiente. Poeira ambiente implementada. Névoa nunca fecha abaixo de 150 m.
Seletor de fase no F1 com volta ao ciclo automático.

### Fragmentos de fruta (item 9 do plano de continuação)
`FruitFragments`: casca saturada, polpa clara e sementes escuras por espécie, com escala, quantidade,
ressalto e vida próprios. A geometria é **derivada do corpo real do inimigo** (clone reduzido em
runtime) — o asset original não é tocado e continua visível. Pool com teto de 54 pedaços, assentamento
no piso, recolhimento de quem cai no vazio e desaparecimento no fim da vida.

### Chão sem repetição (item 4)
O `StochasticGroundPlugin` é de outro autor. Eu fiz a **integração por whitelist**
(`src/world/materials/GroundMaterials.ts`), instalada dentro dos laços que já configuram materiais —
antes do `freeze` do primeiro render — em `RegionPresentation`, `FarmWorld` e `TrainingYard`.
Só `Sunlit farm track`, `Leaf litter soil` e `soil` entram; parede, silo, telhado, prop e LOD
distante ficam de fora. UV divergente é avisado no console em vez de entregar relevo descolado.

### Correções visuais pedidas no plano de continuação
1. **Feixe branco** — `StandardMaterial` soma `emissiveTexture.rgb` a `emissiveColor`; com SVG branco
   o resultado ia a branco puro. Agora o SVG é só `opacityTexture` e a cor vem de `emissiveColor`.
2. **Caixa invisível do totem** — removida por completo. O selo é energia sobre o chão e não registra
   colisor; ninguém mais pisa no vazio. Nenhum teste impunha o colisor.
3. **Clima sob céu azul** — resolvido acima.

---

## NÃO entregue — não considerar feito

| Item do plano | Situação |
| --- | --- |
| **4. Relevo e pedras** | Só a **física** saiu (deslizamento, superfície real, `surfaceAt`). Cristas, terraços, afloramentos distribuídos e a colisão/nav correspondente **não foram feitos**. Não cheguei a gerar geometria derivada de relevo. |
| **5. Vegetação (vento, LOD de copa)** | Não iniciado. |
| **6. Entrada da nave** | Não iniciado. `MeteorArrival` e `FreefallFlutter` continuam como estavam, preservados. |
| **8. Propulsores, rotas verticais, baús** | Não iniciado. Da exploração, só a Ressonância da Colheita existe. Os quatro marcos continuam agrupados. |
| **10. Terreno destrutível** | Não iniciado. Nada de decal fingindo buraco — simplesmente não existe. |
| **Áudio de chuva** | O laço está implementado e ligado ao clima, mas o grupo `rain` **não existe** no manifest: nenhuma gravação foi baixada e licenciada, e o arquivo proíbe ruído sintético. Enquanto faltar, nada toca. Não reaproveitei `water` (respingos de passo). Basta acrescentar `"rain": [...]`. |
| **Revisão visual e auditiva** | Zero. Feixe, limite no relevo, chuva, noite, poses de corpo a corpo, cacos de fruta, chão estocástico e timbre dos sons **precisam** do QA do Codex. |

Também sigo sem medição de desempenho: não há benchmark controlado de FPS nesta sessão, e os
orçamentos que declarei (54 fragmentos, 900 gotas, 180 partículas secas) são tetos de código, não
medições.

---

## Coordenação

- `EnemySwarm.lastKill` foi perdido quando o patch de telegraphs entrou; **restaurei** e está
  preservado junto com o patch.
- `vitest.config.ts` (novo) exclui `.temp/` e `.tools/` — a suíte estava coletando a cópia de
  trabalho de outro agente — e usa 30 s por teste, porque travessias reais estouravam os 5 s padrão
  sob carga paralela embora passassem sozinhas.
- Controles QA novos no F1: seis botões de clima e o link do estúdio de sons.

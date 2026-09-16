# Passos sincronizados com a pose real — entrega

Tarefa: `docs/CLAUDE_FOOTSTEP_REFERENCE_TASK.md`. Sem browser, sem Playwright, sem commit/push.
Arquivos tocados, todos dentro da propriedade combinada:

| Arquivo | O quê |
| --- | --- |
| `src/animation/FootstepSync.ts` | detector reescrito (subir → descer → apoio) |
| `src/world/FootingPresentation.ts` | silenciar sem perder estado, re-semear em teleporte |
| `tests/support/locomotion-rig.ts` | **novo** — rig real em `NullEngine` |
| `scripts/audit-footstep-clips.ts` | **novo** — auditoria numérica dos clipes |
| `tests/footstep-sync.test.ts` | reescrito com as curvas medidas |
| `tests/footstep-clips.test.ts` | **novo** — 23 testes sobre o GLB real |
| `tests/footstep-presentation.test.ts` | **novo** — integração com o áudio |
| `docs/footstep-clip-contacts.json` | **novo** — tabela de contatos medida |
| `docs/licenses/unity_footstep-LICENSE.md` | **novo** — atribuição + licença |

`CharacterVisual.ts`, `PlayerScene.ts`, HUD, MP, terreno, clima e assets de áudio **não** foram
tocados. A API `footHeights()` continua idêntica.

---

## 1. Referência

- https://github.com/dropecho/unity_footstep, commit `2e3620087499c86b45b83811739f9a7e0db5d7c0`
- MIT, Copyright 2023 Benjamin Van Treese — cópia em `docs/licenses/unity_footstep-LICENSE.md`
- Lido: `Runtime/FootStepDetector.cs` e `LICENSE.md`. Nenhum script foi executado, nenhum som ou
  amostra importado, nenhum trecho de código transcrito (é C#/Unity, preso a `Animator` e
  `HumanBodyBones`).

**Aproveitado:** a máquina de estados. O pé precisa ser marcado como *fora do chão* antes de um
contato valer, e o contato só conta quando o pé está **descendo**. É a ideia certa e é o que faltava
aqui.

**Deixado de fora de propósito** — três defeitos da referência:

1. o intervalo mínimo dela é **global** (`_timeSinceLastEvent`), então numa passada rápida o segundo
   pé some sem aviso. Aqui o intervalo é por pé, e um contato barrado por ele soma em `crowded` em
   vez de sumir calado;
2. `_previousLFHeight`/`_previousRFHeight` começam em zero, o que inventa uma descida no primeiro
   quadro. Aqui `previous` começa `NaN` e o primeiro quadro de cada pé só **semeia** o estado;
3. a velocidade do pé é a diferença bruta por quadro, então o limiar muda com o FPS. Aqui a descida
   é medida em m/s e o teste é "não está subindo", que sobrevive ao platô do apoio.

---

## 2. O que foi medido

`npx tsx scripts/audit-footstep-clips.ts` → `docs/footstep-clip-contacts.json`.

O script carrega `public/models/gunslinger.glb` num `NullEngine`, dirige o **`CharacterVisual` de
verdade** (mesma máquina de estados, mesmo blend direcional, mesma escala de relógio por velocidade)
e passa a altura do osso pelo **mesmo `FootstepSync` que o jogo usa**.

### Alturas do pivô do dedo (`RightToeBase`/`LeftToeBase`), acima da raiz

| Estado | Pico do balanço | Platô de apoio |
| --- | --- | --- |
| `Idle` | 7,3 – 7,7 cm | não encosta |
| `Walk` | 17,3 / 17,8 cm | 1,9 – 2,4 cm |
| `Run` | 70,8 / 79,3 cm | 0,0 – 0,1 cm |
| `WalkBackward` | 15,7 / 15,8 cm | 3,7 cm |
| `StrafeLeft` / `StrafeRight` | **15,7 cm** | 3,7 – 3,8 cm |
| `RunBackward` / `RunStrafe*` | 23,7 / 23,8 cm | 3,6 – 3,7 cm |
| `JumpRise` / `JumpFall` | estático a 7,7 / 15,5 e 4,8 / 5,5 cm | — |
| diagonal de **andar** (blend) | **6,9 – 7,6 cm** | 1,2 – 2,3 cm |

### Contatos detectados, 4 s por direção

| Direção | Andar | Correr |
| --- | --- | --- |
| frente | 2,75/s | 3,25/s |
| trás | 2,00/s | 2,25/s |
| esquerda | 2,00/s | 2,25/s |
| direita | 2,00/s | 2,25/s |
| diagonal trás | 2,00/s | 2,25/s |
| diagonal frente | **0,00/s** (ver §5) | 3,25 – 3,50/s |

Em todas as 14 combinações detectáveis: **alternância de pés 100 %**, **0 apoios barrados**,
**0 passos parado**, **0 passos no ar**. Primeiro passo depois de sair do `Idle`: **0,083 s**.

### Limiares escolhidos, e por quê

```
contactHeight = 4,8 cm   liftHeight = 9,5 cm   minIntervalSeconds = 0,09 s
minSpeed      = 0,5 m/s  descentTolerance = 3 cm/s  landingWindowSeconds = 0,26 s
```

- `contactHeight` vive numa janela estreita e medida: o platô de apoio mais **alto** é 3,8 cm
  (`StrafeRight`, pé esquerdo) e o mergulho **falso** mais baixo é 5,9 cm — o meio-balanço do pé
  esquerdo no `Walk`, que desce, volta a subir até 17,6 cm e só depois apoia. Margem real: 1,1 cm
  para baixo, 1,1 cm para cima.
- `liftHeight` fica 1,8 cm acima da respiração do `Idle` (7,7 cm) e 6,2 cm abaixo do pico do clipe
  de menor amplitude (15,7 cm).
- `minSpeed` é o mesmo corte que o `directionalLocomotion` usa para trocar para `Idle`.

---

## 3. Defeitos corrigidos, com a evidência

| Defeito | Causa medida | Correção |
| --- | --- | --- |
| **Mudo de ré e de lado** | `releaseThreshold` era 17 cm; `WalkBackward` e os strafes sobem só até **15,7 cm**. O pé nunca "soltava", então depois do primeiro apoio nada mais saía. | Rearme a 9,5 cm, com 6,2 cm de folga sobre o pior clipe. |
| **Passo falso ao arrancar** | No `Idle` os dois pés ficam a ~7,5 cm, abaixo do `contactThreshold` antigo de 8,5 cm. No quadro em que a velocidade passava de `minSpeed`, os **dois** pés disparavam de uma vez. | O pé precisa **subir** acima de 9,5 cm antes de qualquer contato valer. O `Idle` nunca chega lá. |
| **Passo falso no primeiro quadro** | Estado inicial assumia pé solto. | `previous` começa `NaN`; o primeiro quadro de cada pé só semeia e nunca emite. |
| **Som repetido no mesmo apoio** | O `Walk` mergulha a **5,9 cm** no meio do balanço. Com o limiar de 8,5 cm isso contava como apoio: o andar soava **3,75/s** com o mesmo pé repetindo (alternância de 71 %). | Apoio a 4,8 cm, abaixo do mergulho. Agora 2,75/s e alternância de 100 %. |
| **Aterrissagem duplicada** | No quadro em que `grounded` vira verdadeiro os pés ainda estão a **37 e 32 cm**. O clipe de pouso desce os dois quase juntos — o esquerdo cruza o apoio 8 quadros depois, o direito 14. Saíam dois sons a 0,1 s um do outro. | Janela de 0,26 s: o **primeiro** apoio soa (mesmo parado — pousar é audível), o segundo apoia calado. O som passou a cair no quadro em que o pé **chega ao chão**, não no do `grounded`. |
| **Passo ao voltar de esquiva/combate** | A esquiva **pulava** a atualização do detector; ao voltar, a altura guardada era velha e virava descida inventada. | `muted`: continua medindo, não emite. Esquiva, mortal-reverso e o gancho `suppressSteps` usam isso. |
| **Passo em teleporte** | Respawn/troca de região movem metros num quadro. | Deslocamento > 2 m num quadro re-semeia o detector. |
| **Segundo pé engolido** | — (defeito da referência, não chegou a existir aqui) | Intervalo por pé; contato barrado vira `crowded`, contado e testado. |

Nenhum relógio de passos foi criado. Não há contagem de distância no caminho principal — o gatilho
antigo por 1,65 m só sobrevive como reserva para quando os ossos não estão disponíveis.

**Custo por quadro inalterado:** o detector faz duas comparações e uma subtração por pé. Não há
alocação, varredura de cena, nem leitura extra de matriz — continua consumindo o `footHeights()` que
já era chamado. Superfície, volume e sons escolhidos não foram tocados: `footfall()` continua
chamando `audio.footstep(surface, speed)` exatamente como antes.

---

## 4. Testes

`npx vitest run tests/footstep-sync.test.ts tests/footstep-clips.test.ts tests/footstep-presentation.test.ts`
→ **44 testes, todos passando**.

- **`footstep-clips.test.ts` (23)** — carrega e aplica animação real. Cobre andar e correr × frente,
  trás, esquerda, direita e diagonais; mudança de ritmo andar→correr→andar sem reset; `Idle` mudo;
  no ar mudo; aterrissagem única; arrancada; 120/60/30 Hz com a mesma cadência; silenciar e voltar.
- **`footstep-sync.test.ts` (16)** — estado puro, mas com as **curvas medidas** em vez de senoides
  genéricas (o mergulho de 5,9 cm do `Walk` e a descida real do pouso estão lá como arrays).
- **`footstep-presentation.test.ts` (5)** — superfície e volume preservados, gancho de silêncio,
  esquiva, teleporte, e a reserva por distância.

Suíte completa: **785 passando, 6 falhando**. As 6 são anteriores a esta tarefa e não têm relação
com passos — `combat-assets.test.ts` e `hordes-arsenal-catalog.test.ts` leem `assets/` e
`art/processed/`, que não existem neste clone. `npx tsc --noEmit` não acusa nada nos arquivos desta
entrega.

### Fixture para o Codex

`tests/support/locomotion-rig.ts` é o ponto de entrada, sem browser:

```ts
const rig = await loadLocomotionRig();
const h = rig.step(1/60, {vx: 0, vz: 7.5});   // altura dos dois pés, hierarquia já reconstruída
rig.dispose();
```

`HEADINGS` e `GAITS` dão as direções e velocidades nomeadas. O contador opcional é
`FootstepSync.steps` (apoios que soaram) e `FootstepSync.crowded` (apoios reais barrados pelo
intervalo — deve ficar em 0).

---

## 5. Limitações e pendências

**Não prometo alinhamento perfeito.** Tudo aqui é contato de osso medido. Sincronia percebida,
mixagem, e se o som combina com a superfície continuam dependendo de QA visual e de áudio no jogo
rodando — que esta tarefa não podia fazer.

**Pendência de conteúdo, para o dono do `CharacterVisual`** (não editei o arquivo):

1. **Diagonal de andar quase não levanta o pé.** `CharacterVisual.update` mistura o clipe
   longitudinal e o lateral com o **mesmo `progress` normalizado**, mas `Walk` tem 50 quadros e
   `StrafeLeft`/`StrafeRight` têm 66. Na diagonal os dois ficam em contrafase e o blend 50/50
   cancela a subida: o pico cai de ~16 cm para **6,9 cm**, abaixo até da respiração do `Idle`. O
   personagem escorrega na tela e fica mudo. Patch pequeno sugerido, em
   `src/animation/CharacterVisual.ts:183`: alinhar a fase do clipe secundário ao primário antes de
   misturar (usar `progress * (primary.to - primary.from) / (secondary.to - secondary.from)` como
   progresso do secundário), ou simplesmente não misturar quando os dois clipes têm durações
   diferentes e o peso passa de ~0,35. Correndo o problema não aparece, porque o `Run` tem amplitude
   de sobra.
2. **O cross-fade corrida→andar deixa um pé pairando.** Medido: o pé esquerdo desce até 5,8 cm, é
   puxado de volta a 16,3 cm e só encosta na passada seguinte — então o direito pisa duas vezes
   seguidas na transição. É um apoio real perdido, não um passo inventado. O teste documenta isso em
   vez de mascarar.
3. **Gancho opcional de silêncio, uma linha no `PlayerScene`.** `FootingPresentation.suppressSteps`
   existe e está testado, mas ninguém liga ainda. Para calar corpo a corpo em movimento, prólogo da
   nave e morte, ao lado de `src/game/PlayerScene.ts:249`:

   ```ts
   this.footing.suppressSteps=()=>this.visual.meleePose!==undefined||this.visual.arrivalPose!==undefined||this.visual.deathProgress!==undefined;
   ```

   Sem ele o comportamento é o de hoje, e o corte por velocidade já silencia o caso comum (golpe
   parado, `ComboRightKick` com o corpo parado não soa). O que fica descoberto é só o golpe **em
   movimento** e o prólogo no deck.

**Armadilha registrada para quem escrever teste novo:** `Node.getWorldMatrix()` do Babylon só
recalcula quando o `renderId` da cena muda. Sem `scene.render()` as matrizes congelam depois do
primeiro quadro e a altura do osso vira constante — mediria zero e passaria. `locomotion-rig.ts`
reconstrói a hierarquia inteira dos pais para os filhos antes de cada leitura; no jogo o `renderId`
avança sozinho e o Babylon já faz esse trabalho.

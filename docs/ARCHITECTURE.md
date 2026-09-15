# Arquitetura

## Extensão M1 e protótipo MP

`PlayerScene` compõe `GameInput`, `PlayerMotor`, `CollisionWorld`, `ThirdPersonCamera`, `CharacterVisual`, `DualPistols`, `MPCharge` e HUD. Movimento e carga avançam em ticks fixos; animações/câmera interpolam no render. A malha não é o collider. Raios das armas partem dos muzzles e convergem para a mira, com nova checagem de obstáculos.

`MPCharge` emite thresholds/liberação; os ataques usam o mesmo pool limitado de VFX. `TrainingYard` oferece alvos de treino, ainda sem entidades de inimigos. Colisão é conservadora contra caixas expandidas, com superfícies de rampa; cápsula contra malhas arbitrárias continua pendente.

A câmera adota a orientação posterior do usuário: sobre o ombro e personagem no terço esquerdo. `TrainingLighting` carrega HDRI local e pós-processamento; `TrainingYard` usa mapas PBR locais. As notas M0 abaixo documentam a fundação original.

## Estrutura final planejada

```text
src/
  core/           contratos, eventos, entidades, RNG, loop, pool
  engine/         engine factory e lifecycle de cenas
  game/           composição da aplicação e contexto de run
  player/         movimento e estado do personagem
  camera/         câmera central, colisão e impulsos
  input/          captura de ações e buffers de entrada
  combat/         dano, hitscan, projéteis e morte
  skills/         charge e execução de habilidades
  items/          stacks, hooks e procs
  stats/          cálculo de stats e modificadores
  status/         efeitos temporários
  enemies/        componentes e sistemas de inimigos
  ai/             scheduler, estados e comportamentos
  navigation/     navegação terrestre e steering
  director/       orçamento e composições
  stages/         sequência dos estágios
  interactables/  containers, lojas e altares
  pickups/        recompensas e apresentação
  economy/        XP, níveis e créditos
  animation/      clips, blending e LOD
  physics/        colisões, consultas e corpos
  vfx/            pools e apresentação dos efeitos
  audio/          mix, vozes e emissores
  ui/             HUD DOM e interações
  world/          mapa autoral e diorama
  rendering/      iluminação e pós-processamento
  save/           persistência versionada
  debug/          diagnóstico e comandos de desenvolvimento
  content/        definições e registry
  utils/          utilidades compartilhadas quando necessárias
tests/ scripts/ docs/ assets/
```

Pastas de marcos futuros contêm apenas `.gitkeep`. Isso preserva a estrutura solicitada sem construir sistemas antes da necessidade.

## Dependências fixadas

| Pacote | Versão | Uso |
| --- | --- | --- |
| @babylonjs/core | 9.25.0 | Rendering modular WebGL2 |
| @babylonjs/loaders | 9.25.0 | Import GLB futuro, fora do bundle M0 |
| vite | 8.2.2 | Dev server e build |
| typescript | 5.9.3 | strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes |
| vitest | 5.0.0 | Testes de simulação e lifecycle real Babylon |
| @types/node | 22.18.0 | Tipagem de ferramentas |

`package-lock.json` fixa dependências transitivas. Havok, Recast e Babylon GUI serão avaliados nos marcos que exigirem essas capacidades.

## Interfaces e fronteiras

- `Entity`: ID crescente, ID de definição e transform com previous/current; não conhece meshes.
- `System`: ID, fixedUpdate e dispose; componentes específicos entram nos marcos respectivos.
- `SceneModule`: fixedUpdate, render(alpha), dispose. `SceneLifecycle` troca cenas e mantém a anterior caso a factory falhe.
- `GameEvents`: todos os eventos solicitados pelo master prompt. Dispatch síncrono com snapshot dos listeners, unsubscribe e limpeza por cena. Não é um barramento global.
- `DamageContext`: todos os campos exigidos, incluindo sourceProcId opcional. O pipeline de aplicação de dano e limites de proc entram em M2/M8.
- `ContentRegistry<T>`: valida IDs e duplicações; congela definições no primeiro nível. Conteúdo aninhado deve usar tipos readonly; validação profunda pode ser adicionada quando as definições crescerem.
- `Pool<T>`: alocação inicial, capacidade fixa, acquire com fallback explícito, reset ao liberar, releaseAll, pico e falhas. Não cresce silenciosamente.

## Game loop

Engine render loop → timestamp monotônico → delta limitado a 250 ms → acumulador → até cinco passos de 1/60 s → render com alpha. Tempo excessivo é descartado e exibido no painel. Essa limitação evita a espiral de recuperação após travamentos; não garante tempo real durante sobrecarga.

Cada tick: copiar transforms anteriores → simular → scheduler → flush de remoções. O render interpola previous/current, sem alterar o estado simulado. Pause mantém render e câmera técnica ativos; aba oculta suspende acumulador sem avançar gameplay.

## Entidades e recursos

Definição → entidade/componente → aquisição de recurso visual → sistemas → eventos → marcação de remoção → flush no final do tick → cancelamento de jobs/listeners → liberação do recurso. IDs não são reutilizados dentro do mesmo store. O M0 exercita a separação por probes técnicos; não há inimigos.

Uma cena possui entidades, eventos, scheduler e pools próprios. Ao reiniciar, encerra recursos da cena anterior. A aplicação apenas conecta motor, cena, loop e debug; não acumula regras de combate.

## Estratégias futuras apoiadas no M0

- **Pooling:** pools por efeito/espécie, reset de HP, status, AI, transform, animação e física. Efeito cosmético pode ser omitido quando esgotar; projétil que causa dano exige política explícita. Objetos Babylon são descartados no fim da cena, não a cada disparo.
- **IA:** perto 20 Hz (<25 m), médio 10 Hz (<60 m), longe 4 Hz; início escalonado, cursor rotativo e teto de 24 callbacks/tick. Distância é reavaliada para promover rapidamente quem se aproxima. Comandos que adicionam/removem jobs devem ocorrer fora dos callbacks de update.
- **Animação:** AnimationDefinition por espécie, resolução de clips sem regras baseadas na geometria, locomoção in-place guiada pelo gameplay, blending e recoil independente por pistola. Animação renderizada a cada frame perto do jogador; LOD e culling nos marcos M4/M11.
- **Performance:** medir draw calls, frame CPU, meshes, triângulos, entidades, jobs e pools. Instancing, compressão de texturas, limites de sombras/cadáveres/luzes, spatial queries e LOD serão implementados onde o profiler justificar. O teste de 300 jobs avalia somente scheduler, não 300 modelos ou inimigos.
- **Backend:** apenas createEngine instancia WebGL Engine. Cenas dependem de AbstractEngine; uma factory assíncrona para WebGPU poderá ser introduzida sem reescrever gameplay.

Referência de imports modulares: https://doc.babylonjs.com/setup/frameworkPackages/es6Support/

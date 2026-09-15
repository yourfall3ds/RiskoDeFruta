# Mutant Farm Roguelike

Jogo de ação 3D em terceira pessoa, Babylon.js + TypeScript. A cena padrão tem hordas progressivas, cinco espécies originais, chefe a cada cinco ondas e recompensa aleatória do catálogo de 90 itens ao concluir cada onda. O ambiente inclui ilhas conectadas, pontes, cachoeiras, agricultura e céu cósmico. A câmera segue a referência sobre o ombro. Detalhes, testes, fontes editáveis e limitações em [implementação da rodada](docs/CURRENT_IMPLEMENTATION.md).

**Atualização de 06/09/2026: não usar Meshy.** O pipeline de arte utilizará arquivos locais e Blender. Os assets existentes com “Meshy” no nome continuam válidos. Não há integração, chamadas ou chave desse serviço.

## Executar

Node 22.12+ (ambiente validado: 22.18.0), npm.

```sh
npm ci
npm run dev
```

Abra http://127.0.0.1:5173/ e clique em Entrar no campo. WASD move, mouse mira, espaço salta, Shift esquiva e botão esquerdo dispara. R recarrega o carregador compartilhado de 50 balas; Tab abre atributos e inventário. Segure o botão direito e solte após 0,6 / 1,4 / 2,6 segundos para MP I / II / III. Esc solta o cursor. Sem captura, arrastar permite testar a mira. F1 ajusta distância, FOV e shake e oferece pausa/reinício. O menu também oferece volume e qualidade Alta/Equilibrada, mantendo resolução nativa nas duas. A seed fica na URL. A bancada M0 continua em `?mode=foundation`.

```sh
npm run typecheck
npm test
npm run build
npm run preview
npm run assets:audit
```

O `.env` foi criado e está ignorado pelo Git, reservado para configurações locais futuras. Atualmente não exige nenhuma chave. Nunca coloque segredos em variáveis `VITE_*`.

## Conteúdo entregue

- WebGL2 explícito e fronteira de engine compatível com futura implementação WebGPU.
- Simulação de 60 Hz, interpolação de render, limite de catch-up e suspensão ao ocultar a aba.
- Ciclo de vida da cena, descarte e reinício reproduzível.
- Eventos tipados, contrato de dano, entidades leves, registro de conteúdo e RNG com nove streams independentes.
- Pool limitado com reset e métricas; scheduler de IA por distância com orçamento e distribuição justa.
- Movimento a 9 m/s, salto com coyote/buffer, duas esquivas, colisão e retorno após queda.
- Pistolas alternadas a 6,7 disparos/s, hitscan e impactos em alvos; leque ricocheteante, barragem com mortal e tempestade com duração sincronizada à voz com obstáculos respeitados.
- Personagem com mapas 2K e poses de mira, disparos por braço, carga e liberação criadas no Blender.
- Câmera próxima sobre o ombro, personagem no terço esquerdo, conforme a última orientação visual do usuário.
- Ambiente composto no Blender com arquitetura PBR e rochas/vegetação fotogramétricas CC0 locais; [licenças](docs/ASSET_LICENSES.md). Céu cósmico gerado e HDRI para iluminação.
- Auditoria e cópias de trabalho dos assets, preservando os originais.

O cenário editável está em `art/blender/Farm_World_Polished.blend`; personagem com armas e ações em `art/blender/Gunslinger_Directional_And_Skills.blend`. E abre baús, recolhe itens do chão e atravessa a fenda. Cada baú sorteia um item, abre a tampa e ejeta o PNG que fica girando até a coleta. Não há escolha de oferta. As três habilidades MP combinam leque ricocheteante, mortal com barragem e tempestade de tiros, precedidos por close heroico durante o grito. A atuação segue a duração original dos áudios. A expedição anterior está em `?mode=expedition`. A população começa em 24 e se adapta entre 12 e 32; F1 oferece testes de 50, 100 e 150 atores.

Documentação: [arquitetura](docs/ARCHITECTURE.md), [direção visual](docs/VISUAL_REFERENCE.md), [marcos e validação](docs/MILESTONES.md), [inventário de assets](docs/asset-inventory.json), [master prompt atualizado](docs/MASTER_PROMPT.md).



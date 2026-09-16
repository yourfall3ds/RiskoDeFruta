# Sorteio de chegada e busca do cálice

Uma abertura normal e o botão Renascer sorteiam uma nova semente para o plano de ilhas. O cache de planos não atravessa tentativas. `?replay=1&seed=...` e o modo online preservam a semente; F1 continua oferecendo Reiniciar mesma seed.

O par de ilhas exige chão seguro, arena válida e caminho completo no navmesh. A caminhada mínima é 180 m nos dois primeiros biomas e 150 m nos dois seguintes, além da separação direta existente. Não há fallback para um cálice mais próximo. A busca de chão respeita a extensão e a altura da ilha escolhida, evitando aceitar o campo inferior como pouso de outra ilha.

O feixe do cálice aparece depois da descoberta. Renascer aguarda o novo destino antes da entrada cinematográfica. Também foi corrigida a leitura de celeiros GLB com várias primitivas por nó, que impedia a configuração de iluminação e visibilidade.

## Verificação

- Claude: 77 testes focados de sementes, rotas, viagem, repetição e limites de ilha passaram; typecheck limpo.
- Integração: 51 testes de limites, celeiros e objetivos passaram; build passou.
- Auditoria com colisão e navmesh reais: 13 sementes em cada um dos quatro biomas, 52 planos válidos. Dados em `stage-route-audit.json`.
- Navegador: duas aberturas mudaram a semente; derrota e Renascer mudaram Posto oeste → Platô do celeiro, com o novo cálice a 189 m de caminhada e chegada apoiada no chão. HUD manteve o destino oculto antes da descoberta.

## Limites

O mapa ainda tem sua geometria e suas pontes anteriores. A esfera depende de definir se haverá curvatura e gravidade esférica ou apenas conexões globais. Nenhum desses mundos foi implementado nesta correção.

A geometria atual restringe a variedade: na auditoria final, o primeiro bioma teve dois pontos de partida válidos e dois destinos de cálice. Uma nova semente pode repetir a mesma ilha; não há promessa de alternância obrigatória ou de todas as ilhas serem viáveis. O sorteio de uma repetição altera o plano das ilhas; os geradores de loot e inimigos da cena mantida não foram reinicializados.

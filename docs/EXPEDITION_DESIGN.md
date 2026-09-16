# Direção de jogo: expedição e colheita

## Loop principal
Explorar sob pressão → ganhar créditos → escolher quais baús comprar → ativar um totem → sobreviver dentro da área → recolher recompensa → continuar. Quatro totens e chefe final abrem a passagem de estágio. A dificuldade continua aumentando durante a viagem: desviar para um baú custa tempo, mas pode render poder suficiente para compensar.

O objetivo é completar a rota; a quantidade de inimigos vivos é um orçamento de simulação. Um inimigo perdido nunca segura a conclusão de um totem. O chefe é uma ameaça identificável e recuperável, não uma contagem invisível de lacaios.

## Ritmo e leitura
- Primeira arma: disparos espaçados e impacto legível. O primeiro item de cadência precisa ser perceptível.
- Movimento inicial contido, ainda responsivo; aceleração/frenagem não devem parecer atraso de comando. Progressão aumenta alcance e fluidez, não desbloqueia a habilidade básica de controlar o personagem.
- Pulos extras são recursos contáveis, com impulso e efeito visual por uso. Trampolins tornam rotas verticais acessíveis antes de encontrar esses itens.
- Quatro marcos: ensinar ativação → combinar cobertura e altura → decidir desvio por recompensa → sobreviver ao chefe. Escolher local a partir de chão e conexão realmente válidos.
- Corpo a corpo precisa compensar risco de proximidade; tiro mantém opção segura. Cadência acelera animação e janela ativa juntas.

## Mecânica experimental a integrar: Ressonância da Colheita
Alternar tiro, golpe corpo a corpo e ação aérea aumenta uma ressonância temporária. Um padrão repetido não acrescenta níveis. Próximo de um totem ativo, a ressonância acelera sua carga moderadamente. Fora do totem, o indicador serve de treino e perde níveis com o tempo.

Intenção: recompensar variedade e ligar as ferramentas de mobilidade à missão. Não punir jogadores que prefiram pistolas: todos os totens continuam concluíveis sem o bônus. Teto e duração devem impedir farm de inputs sem acertar nada; a implementação precisa usar eventos de combate válidos, não só teclas pressionadas.

## Hipóteses para experimentar depois da base
Estas são propostas de design, não recursos entregues e não alegações de ineditismo mundial.

### Solo de memória
Crateras reais acumulam polpa após combate. Com chuva, viram pequenos canteiros que geram uma recompensa temporária, mas atraem uma praga escavadora. Destruir cobertura pode abrir passagem e deixar uma oportunidade para uma visita posterior. Depende de destruição, navegação e clima estáveis.

### Especial em contrapasso
Uma carga adicional pode encadear uma continuação diferente conforme a última ação válida: tiro prolonga a rajada; golpe lança um impacto curto; salto transforma a continuação em mergulho. O jogador vê antes de confirmar qual continuação está preparada. Primeiro implementar a continuação simples com duas cargas, depois testar ramificações.

### Colheita arriscada
Totem concluído deixa uma recompensa segura. O jogador pode voluntariamente deixá-la amadurecer enquanto explora; o valor cresce, mas elites passam a rondar o local. O objetivo principal não depende de recuperar essa recompensa. Exige marcador claro e nenhuma perda silenciosa de item.

## Referências verificadas
- [Notas oficiais de Dead Cells, atualização 21](https://dead-cells.com/patchnotes/21): progressão de pressão, alterações de combate e exploração. Referência para discutir ritmo; não copiar valores diretamente entre jogos.
- [three-hex-tiling](https://github.com/Ameobea/three-hex-tiling): referência técnica de texturização sem repetição; adaptar ao Babylon preservando licença.

## Limites de avaliação
Testes de código comprovam contratos; não comprovam diversão, sincronia audiovisual percebida ou fidelidade artística. Comparar partida sem itens e partida com melhorias, percorrer pontes/rochas/declives e assistir às três habilidades com e sem inimigos. Usar controles QA só para reproduzir estados, identificando quando usados.

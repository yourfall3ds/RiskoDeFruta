# Revisão do painel de áudio (Codex)

## QA funcional já aprovado no navegador
- Integração runtime acrescentada pelo principal. Verificação Codex: 32 testes passaram (`enemy-audio-overrides`, `enemy-audio-integration`, `recorded-audio`); typecheck cliente passou. Voz e attack-layer agora independentes. Página final revisada visualmente, textos técnicos removidos, controles legíveis. Link F1 recebeu CSS legível. Usuário avisado de atualizar painel e jogo inicialmente (reload do jogo reinicia run); depois mudanças por canal local.
- Página abre em `/audio-lab.html`, amostra padrão dispara ao clicar e botão Parar funciona (estado de reprodução conferido; isto não é avaliação auditiva do timbre).
- Silenciar Aparecer da berinjela persistiu após reload; Aparecer do milho permaneceu ativo. Restaurado depois do teste.
- Upload de `grass-0.ogg` como arquivo de teste foi decodificado, salvo e continuou disponível/reproduzível depois de reload.
- Upload de WAV inválido exibiu erro e manteve `grass-0.ogg` anterior. Configuração restaurada para padrão e prévia parada após QA. Console sem erros.
- CSS refinado no navegador para controles caberem no card. Não reintroduzir CSS inline de fallback conflitante (ele deixou grid/gaps/azul e outline verde onde não se esperava). Pode remover fallback de audio-lab.html agora que arquivo definitivo existe.
- `RecordedAudio` e entrada do build foram integrados. Falta apenas conferir build final; propagação entre abas está coberta pelos testes de cache/canal, sem afirmar audição humana do jogo.

## Achados corrigidos nesta revisão
- Camada secundária agora tem evento próprio `attack-layer`, com prévia, mute, volume, upload e restauração por espécie. Testes conferiram voz ativa com camada muda e o inverso, sem afetar pistola do jogador.

Os itens abaixo motivaram a revisão e foram corrigidos no catálogo/interface. Não refazer integração nem reverter escolhas do usuário.

- Catálogo inicial marcou windup como wired=false, mas `EnemySwarm.ts` já chama `this.audio?.enemy('windup',a.kind,d)` dentro da linha longa de ataque. Não truncar a linha antes de verificar. Corrigir metadado/teste e não apresentar evento útil como desligado.
- Textos voltados ao usuário devem ser simples: remover nomes de classes como EnemySwarm, WeaponAudio e termos gain/rate/gap de descrições do painel. Mostrar Aparecer, Preparar ataque, Atacar, Receber dano, Morrer e Esquivar; volume em porcentagem e nome do arquivo bastam. Detalhes de integração pertencem ao DELIVERY.
- Nota do tomate deve descrever projéteis incendiários/fogo no chão; ele não mergulha no jogador no comportamento atual. Chefe: 'Presença pesada e ataques de grande alcance', sem informação técnica de playbackRate no texto principal.
- Dar tratamento específico à camada de ataque: mute/gain/upload/restore por espécie e por camada; não silenciar tiros do jogador quando o milho usa o mesmo grupo.
- Conferir `audio-lab.html` no build final e link no F1 do jogo. A partida carregada ANTES da integração precisa de uma atualização inicial; não prometer que uma aba antiga sem o código novo recebe BroadcastChannel.
- Checar persistência após reload, arquivo inválido não troca seleção existente, parar cancela sequência, troca rápida de espécie não toca amostra antiga, e import inválido mantém configuração anterior.

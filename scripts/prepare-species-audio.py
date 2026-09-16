"""APOSENTADO — não use. Substituído por scripts/prepare-enemy-audio.py.

Este script montava a paleta de inimigos a partir do pacote "Monsters or Beasts" (rosnados de
bicho, chamados de demônio, voz de fada) e reescrevia os grupos `enemy-*` do manifest com ela.
O usuário auditou essa paleta no estúdio e recusou o material; rodar este script de novo traria
exatamente os arquivos recusados de volta para os grupos ativos.

Ele também aplicava um patch de texto em `src/audio/RecordedAudio.ts` que não corresponde mais ao
código atual — a resolução por espécie hoje mora em `src/audio/EnemyAudioCatalog.ts`.

O receituário antigo fica registrado no histórico do git. Para regerar o banco atual:

    python scripts/prepare-enemy-audio.py

Mantido como stub (em vez de apagado) para que qualquer nota ou runbook que ainda aponte para
este caminho encontre a explicação em vez de um comando que estraga o manifest.
"""

import sys

MESSAGE = __doc__


def main() -> int:
    print(MESSAGE, file=sys.stderr)
    return 2


if __name__ == '__main__':
    raise SystemExit(main())

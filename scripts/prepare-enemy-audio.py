"""Prepara o banco de sons de inimigos a partir de gravações licenciadas (CC0).

Substitui TODA a paleta de inimigos por impactos orgânicos de fruta (polpa, casca, fibra,
farelo) mais um feixe controlado para a cenoura e um sopro de fogo para o tomate. Nada aqui é
sintetizado do zero: cada peça é um recorte/resample/filtro/mixagem de amostras CC0 listadas em
`docs/enemy-audio-sources.json`.

Sobre procedência: as amostras são de dois tipos, e o JSON marca cada uma no campo `kind`.
`acústica` = a página da fonte descreve captação de material real (esguichos, quebras, fogo,
swishes de bambu, casquinhas). `autoral` = SFX produzido/desenhado, licenciado CC0 (os pacotes da
Kenney e o pacote do rubberduck). Usar SFX autoral licenciado é legítimo; o que não se pode é
chamá-lo de gravação de campo.

Uso (a partir da raiz do repositório):

    python scripts/prepare-enemy-audio.py [--sources .temp/enemy-audio-sources] [--check]

`--check` não escreve nada: só confere que os arquivos gerados batem com o relatório.

Saídas:
  public/audio/enemies/*.ogg          — as peças novas
  public/audio/foley-manifest.json    — grupos de inimigo reescritos (o resto fica intacto)
  docs/enemy-audio-assets.json        — duração/pico/sha256 medidos de cada peça
  docs/enemy-audio-sources.json       — procedência e licença das gravações de origem
  docs/enemy-audio-rejected.json      — sha256 do material recusado, para o teste barrar aliases

Dependências: numpy, scipy, soundfile (libsndfile com Vorbis).
"""

from __future__ import annotations

import argparse
import hashlib
import json
from fractions import Fraction
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, resample_poly, sosfiltfilt

SR = 44100
# Teto de pico do arquivo já codificado. Fica abaixo de 1.0 com folga porque o jogo ainda soma a
# camada de impacto por cima da voz e o usuário pode subir o volume no estúdio.
CEILING = 0.95
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / 'public' / 'audio' / 'enemies'
MANIFEST = ROOT / 'public' / 'audio' / 'foley-manifest.json'
PUBLIC_URL = '/audio/enemies/'

# --------------------------------------------------------------------------------------------
# Gravações de origem
# --------------------------------------------------------------------------------------------

# `repo:` = já versionado em public/ (continua onde está); `src:` = pacote baixado para --sources.
SOURCES: dict[str, str] = {
    # Independent.nu / qubodup — CC0 — 8 wet squish/slurp impacts
    **{f'wet{i}': f'src:extracted/wet-squish/impsplat/impactsplat0{i}.mp3.flac' for i in range(1, 9)},
    # Independent.nu / qubodup — CC0 — 5 break/crunch impacts
    **{f'dry{i}': f'src:extracted/crunch/impcrunch/impactcrunch0{i}.mp3.flac' for i in range(1, 6)},
    # Julien Matthey — CC0 — fireball
    'fire': 'src:fireball-julien-matthey.wav',
    # Kenney — CC0 — sci-fi sounds. SEM a família `laserRetro`/`laserSmall`: o usuário recusou
    # timbre retrô/8-bit, então a cenoura usa só `laserLarge` (mais encorpado) com as bordas
    # arredondadas por filtro e rampa, sustentado por `forceField` e por ar texturizado.
    'field0': 'src:extracted/kenney-sci-fi/Audio/forceField_000.ogg',
    'field2': 'src:extracted/kenney-sci-fi/Audio/forceField_002.ogg',
    'beamL': 'src:extracted/kenney-sci-fi/Audio/laserLarge_001.ogg',
    'beamL3': 'src:extracted/kenney-sci-fi/Audio/laserLarge_003.ogg',
    'sub': 'src:extracted/kenney-sci-fi/Audio/lowFrequency_explosion_001.ogg',
    # Kenney — CC0 — Impact Sounds e RPG Audio (espelho ETdoFresh/kenney.nl). São a família
    # `impactPunch`, diferente do `impactSoft_heavy` que foi recusado: corpo e soco, não esguicho.
    'punchH0': 'src:impactPunch_heavy_000.ogg',
    'punchH1': 'src:impactPunch_heavy_001.ogg',
    'punchM': 'src:impactPunch_medium_000.ogg',
    'knock': 'src:impactWood_medium_000.ogg',
    'chop': 'src:chop.ogg',
    # rubberduck — CC0 — 75 breaking/falling/hit SFX: batidas e quebras secas, para a paleta não
    # ficar só de esguicho molhado.
    'hitDry': 'src:extracted/rubberduck/bfh1_hit_11.ogg',
    'hitWood': 'src:extracted/rubberduck/bfh1_wood_hit_01.ogg',
    'hitRock': 'src:extracted/rubberduck/bfh1_rock_hit_01.ogg',
    'break1': 'src:extracted/rubberduck/bfh1_breaking_02.ogg',
    'break2': 'src:extracted/rubberduck/bfh1_wood_breaking_01.ogg',
    # Já no repositório: qubodup (swish, CC0) e GryffDavid (casquinhas, CC0)
    'air3': 'repo:public/audio/foley/swish-3.flac',
    'air5': 'repo:public/audio/foley/swish-5.flac',
    **{f'tick{i}': f'repo:public/audio/foley/casing-{i}.wav' for i in range(6)},
}

# `kind`: 'acústica' = a própria fonte descreve captação de material real; 'autoral' = SFX
# produzido/desenhado e licenciado CC0. A classificação segue o que cada página declara — não é
# uma auditoria do método de produção.
SOURCE_LICENSES = [
    {
        'author': 'Independent.nu (enviado por qubodup)', 'license': 'CC0', 'kind': 'acústica',
        'url': 'https://opengameart.org/content/8-wet-squish-slurp-impacts',
        'files': [f'wet{i}' for i in range(1, 9)],
        'use': 'Base de polpa molhada: nascer, apanhar, morrer e as camadas úmidas de ataque.',
    },
    {
        'author': 'Independent.nu (enviado por qubodup)', 'license': 'CC0', 'kind': 'acústica',
        'url': 'https://opengameart.org/content/5-break-crunch-impacts',
        'files': [f'dry{i}' for i in range(1, 6)],
        'use': 'Base de casca/fibra/farelo: estalos, rachaduras de casca e preparo de golpe.',
    },
    {
        'author': 'Julien Matthey', 'license': 'CC0', 'kind': 'acústica',
        'url': 'https://opengameart.org/content/fireball-1',
        'files': ['fire'],
        'use': 'Sopro do projétil incendiário do tomate (preparo, disparo e chiado final); também '
               'aquece a cauda do feixe da cenoura.',
    },
    {
        'author': 'qubodup', 'license': 'CC0', 'kind': 'acústica',
        'url': 'https://opengameart.org/content/swish-bamboo-stick-weapon-swhoshes',
        'files': ['air3', 'air5'],
        'use': 'Ar texturizado: deslocamento do projétil do tomate e corpo da carga da cenoura.',
    },
    {
        'author': 'GryffDavid', 'license': 'CC0', 'kind': 'acústica',
        'url': 'https://freesound.org/people/GryffDavid/sounds/318964/',
        'files': [f'tick{i}' for i in range(6)],
        'use': 'Estalos secos de grão do milho (já usado pelo jogo como casing).',
    },
    {
        'author': 'Kenney', 'license': 'CC0', 'kind': 'autoral',
        'url': 'https://kenney.nl/assets/sci-fi-sounds',
        'files': ['field0', 'field2', 'beamL', 'beamL3', 'sub'],
        'use': 'Carga e disparo do feixe da cenoura (só laserLarge, sem a família retrô) e '
               'reforço grave do chefe.',
    },
    {
        'author': 'Kenney (espelho: ETdoFresh/kenney.nl @45df48c4)', 'license': 'CC0', 'kind': 'autoral',
        'url': 'https://raw.githubusercontent.com/ETdoFresh/kenney.nl/45df48c4d45f8716216b1a9e22df0b69cd9f5932/',
        'files': ['punchH0', 'punchH1', 'punchM', 'knock', 'chop'],
        'use': 'Corpo e soco dos impactos pesados (grupo heavy, chefe, melancia) e o corte seco do '
               'golpe da berinjela. Família impactPunch/impactWood/chop — não é o impactSoft_heavy '
               'que o usuário recusou.',
    },
    {
        'author': 'rubberduck', 'license': 'CC0', 'kind': 'autoral',
        'url': 'https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx',
        'files': ['hitDry', 'hitWood', 'hitRock', 'break1', 'break2'],
        'use': 'Batidas e quebras secas, para variar a textura onde a paleta ficaria só de '
               'esguicho molhado.',
    },
]

# Famílias de timbre recusadas na auditoria: o usuário não quer bipe retrô/8-bit. Ficam listadas
# para o teste poder falhar se alguém reintroduzir uma delas em SOURCES.
RETIRED_SOURCE_IDS = ['beamR1', 'beamR3', 'beamS']

# Material recusado pelo usuário no estúdio. O teste barra estes sha256 em qualquer grupo ativo,
# então nem o arquivo original nem uma cópia renomeada (os "aliases") voltam a tocar.
REJECTED_GLOBS = [
    'public/audio/foley/enemy-voice-*.wav',  # paleta vocal inteira (bicho/demônio/pixie)
    'public/audio/foley/heavy-*.ogg',        # os quatro impactos pesados recusados
    'public/audio/foley/growl-*.wav',        # aliases genéricos das mesmas gravações vocais
    'public/audio/foley/attack-*.wav',
    'public/audio/foley/hurt-*.wav',
    'public/audio/foley/death-*.wav',
    'public/audio/foley/spawn-*.wav',
]

# --------------------------------------------------------------------------------------------
# Edição
# --------------------------------------------------------------------------------------------

_cache: dict[str, np.ndarray] = {}


def _path(key: str, sources: Path) -> Path:
    spec = SOURCES[key]
    kind, _, rest = spec.partition(':')
    return (ROOT / rest) if kind == 'repo' else (sources / rest)


def load(key: str, sources: Path) -> np.ndarray:
    """Gravação em mono, 44.1 kHz, float64."""
    if key in _cache:
        return _cache[key]
    data, rate = sf.read(_path(key, sources), always_2d=True, dtype='float64')
    mono = data.mean(axis=1)
    if rate != SR:
        mono = resample_poly(mono, SR, rate)
    _cache[key] = mono
    return mono


def onset(x: np.ndarray, frac: float = 0.06, floor: float = 0.012) -> int:
    """Primeira amostra audível — os pacotes vêm com silêncio de até 0,6 s na frente."""
    level = max(floor, frac * float(np.max(np.abs(x))))
    loud = np.flatnonzero(np.abs(x) > level)
    return int(loud[0]) if loud.size else 0


def repitch(x: np.ndarray, rate: float) -> np.ndarray:
    """Mesma matemática do `playbackRate`: rate>1 sobe e encurta, rate<1 abaixa e alonga."""
    if abs(rate - 1.0) < 1e-6:
        return x
    ratio = Fraction(1.0 / rate).limit_denominator(64)
    return resample_poly(x, ratio.numerator, ratio.denominator)


def band(x: np.ndarray, hp: float | None, lp: float | None) -> np.ndarray:
    for cut, kind in ((hp, 'highpass'), (lp, 'lowpass')):
        if not cut:
            continue
        sos = butter(2, min(cut, SR * 0.45) / (SR / 2), btype=kind, output='sos')
        x = sosfiltfilt(sos, x)
    return np.asarray(x, dtype='float64')


def shape(x: np.ndarray, fade_in: float, fade_out: float) -> np.ndarray:
    """Rampas curtas nas duas pontas: sem clique de corte, sem virar um fade audível."""
    n = len(x)
    a = min(int(fade_in * SR), n // 2)
    b = min(int(fade_out * SR), n - a)
    if a > 1:
        x[:a] *= np.linspace(0.0, 1.0, a) ** 1.5
    if b > 1:
        x[n - b:] *= np.linspace(1.0, 0.0, b) ** 1.6
    return x


def piece(layer: dict, sources: Path) -> tuple[np.ndarray, int]:
    """Uma camada já recortada, reafinada, filtrada e com rampas. Devolve (áudio, offset)."""
    x = load(layer['src'], sources)
    rate = layer.get('rate', 1.0)
    start = layer.get('start')
    head = onset(x) if start is None else int(start * SR)
    head = max(0, head - int(layer.get('pre', 0.004) * SR))
    want = int(layer['dur'] * rate * SR) + 64
    chunk = np.array(x[head:head + want], dtype='float64')
    if layer.get('reverse'):
        chunk = chunk[::-1].copy()
    chunk = repitch(chunk, rate)
    chunk = band(chunk, layer.get('hp'), layer.get('lp'))
    chunk = chunk[:int(layer['dur'] * SR)]
    peak = float(np.max(np.abs(chunk))) if chunk.size else 0.0
    if peak > 0:  # cada camada entra normalizada, para o `gain` do recipe valer o mesmo em todas
        chunk /= peak
    tail = min(layer.get('fout', 0.035), layer['dur'] * 0.45)
    chunk = shape(chunk, layer.get('fin', 0.002), tail)
    return chunk * layer.get('gain', 1.0), int(layer.get('at', 0.0) * SR)


def render(layers: list[dict], peak: float, sources: Path) -> np.ndarray:
    parts = [piece(layer, sources) for layer in layers]
    total = max(offset + len(audio) for audio, offset in parts)
    mix = np.zeros(total, dtype='float64')
    for audio, offset in parts:
        mix[offset:offset + len(audio)] += audio
    top = float(np.max(np.abs(mix)))
    if top > 0:
        mix *= peak / top
    # Garantia final contra clique: 1,5 ms na entrada e 12 ms na saída, sempre.
    return shape(mix, 0.0015, min(0.012, len(mix) / SR * 0.25))


# --------------------------------------------------------------------------------------------
# Receitas
# --------------------------------------------------------------------------------------------

def L(src: str, dur: float, **kw) -> dict:
    return {'src': src, 'dur': dur, **kw}


# grupo do manifest -> [(nome do arquivo, pico alvo, camadas)]
RECIPES: dict[str, list[tuple[str, float, list[dict]]]] = {

    # -------- Berinjela: fibra leve que estala e molha ----------------------------------------
    'enemy-eggplant-spawn': [
        ('eggplant-spawn-0', 0.84, [L('wet4', 0.52, rate=0.95, lp=3000, fin=0.02)]),
        ('eggplant-spawn-1', 0.84, [L('wet3', 0.46, rate=1.02, lp=3200, fin=0.015),
                                    L('dry2', 0.26, rate=1.1, hp=600, gain=0.34, at=0.18)]),
    ],
    'enemy-eggplant-growl': [
        ('eggplant-strain-0', 0.80, [L('dry2', 0.38, rate=0.82, hp=320, lp=5200, fin=0.06)]),
        ('eggplant-strain-1', 0.80, [L('dry5', 0.34, rate=0.90, hp=380, lp=5600, fin=0.05)]),
    ],
    'enemy-eggplant-attack': [  # o corte seco do `chop` dá a fibra que o esguicho sozinho não dá
        ('eggplant-attack-0', 0.90, [L('chop', 0.17, rate=1.15, hp=520),
                                     L('dry4', 0.17, rate=1.12, hp=420, gain=0.66, at=0.008),
                                     L('wet7', 0.15, rate=1.10, gain=0.40, at=0.012)]),
        ('eggplant-attack-1', 0.90, [L('chop', 0.16, rate=1.22, hp=560),
                                     L('dry3', 0.16, rate=1.18, hp=460, gain=0.62, at=0.008),
                                     L('wet8', 0.14, rate=1.05, gain=0.36, at=0.010)]),
    ],
    'enemy-eggplant-hurt': [
        ('eggplant-hurt-0', 0.74, [L('wet7', 0.17, rate=1.15, hp=260)]),
        ('eggplant-hurt-1', 0.74, [L('wet6', 0.15, rate=1.22, hp=300)]),
    ],
    'enemy-eggplant-death': [
        ('eggplant-death-0', 0.88, [L('wet1', 0.50, rate=0.96),
                                    L('dry1', 0.34, rate=0.9, hp=350, gain=0.42, at=0.22)]),
        ('eggplant-death-1', 0.88, [L('wet3', 0.46, rate=0.90),
                                    L('dry5', 0.30, rate=0.95, hp=400, gain=0.38, at=0.24)]),
    ],
    'enemy-eggplant-heavy': [  # camada do golpe: batida leve com corpo de madeira, não só esguicho
        ('eggplant-impact-0', 0.82, [L('hitWood', 0.21, rate=1.10, lp=3200),
                                     L('wet3', 0.20, rate=0.92, gain=0.50, lp=1900, at=0.006)]),
        ('eggplant-impact-1', 0.82, [L('hitDry', 0.19, rate=1.00, lp=3600),
                                     L('wet4', 0.18, rate=0.98, gain=0.46, lp=2100, at=0.006)]),
    ],

    # -------- Milho: casca seca e grão ---------------------------------------------------------
    'enemy-corn-spawn': [
        ('corn-spawn-0', 0.82, [L('dry5', 0.46, rate=1.30, hp=820, fin=0.03),
                                L('tick1', 0.22, rate=1.15, hp=900, gain=0.38, at=0.14)]),
        ('corn-spawn-1', 0.82, [L('dry2', 0.44, rate=1.35, hp=760, fin=0.025),
                                L('tick3', 0.20, rate=1.25, hp=950, gain=0.34, at=0.18)]),
    ],
    'enemy-corn-growl': [
        ('corn-rattle-0', 0.80, [L('tick0', 0.34, rate=1.10, hp=900),
                                 L('tick4', 0.20, rate=1.30, hp=1100, gain=0.55, at=0.13),
                                 L('dry4', 0.18, rate=1.45, hp=1200, gain=0.30, at=0.06)]),
        ('corn-rattle-1', 0.80, [L('tick2', 0.32, rate=1.18, hp=950),
                                 L('tick5', 0.18, rate=1.35, hp=1150, gain=0.50, at=0.12),
                                 L('dry3', 0.16, rate=1.50, hp=1250, gain=0.28, at=0.05)]),
    ],
    'enemy-corn-attack': [
        ('corn-attack-0', 0.90, [L('dry4', 0.22, rate=1.40, hp=640),
                                 L('tick5', 0.16, rate=1.20, hp=1000, gain=0.48, at=0.015)]),
        ('corn-attack-1', 0.90, [L('dry3', 0.20, rate=1.48, hp=700),
                                 L('tick0', 0.15, rate=1.30, hp=1050, gain=0.44, at=0.012)]),
    ],
    'enemy-corn-hurt': [
        ('corn-hurt-0', 0.74, [L('dry3', 0.15, rate=1.50, hp=820)]),
        ('corn-hurt-1', 0.74, [L('dry4', 0.14, rate=1.60, hp=880)]),
    ],
    'enemy-corn-death': [
        ('corn-death-0', 0.86, [L('dry5', 0.62, rate=1.12, hp=520),
                                L('break1', 0.32, rate=1.15, hp=900, gain=0.42, at=0.10),
                                L('tick2', 0.26, rate=1.05, hp=800, gain=0.34, at=0.30)]),
        ('corn-death-1', 0.86, [L('dry2', 0.58, rate=1.16, hp=560),
                                L('break2', 0.28, rate=1.20, hp=950, gain=0.38, at=0.09),
                                L('tick4', 0.24, rate=1.12, hp=850, gain=0.32, at=0.28)]),
    ],
    'enemy-corn-pistol': [  # camada do tiro: estalo de grão seco, no lugar da pistola do jogador
        ('corn-shot-0', 0.84, [L('tick2', 0.16, rate=1.25, hp=1000),
                               L('dry4', 0.13, rate=1.55, hp=1300, gain=0.42)]),
        ('corn-shot-1', 0.84, [L('tick5', 0.15, rate=1.32, hp=1050),
                               L('dry3', 0.12, rate=1.62, hp=1350, gain=0.38)]),
    ],

    # -------- Melancia: casca grossa e polpa pesada ---------------------------------------------
    'enemy-watermelon-spawn': [
        ('watermelon-spawn-0', 0.86, [L('wet5', 0.74, rate=0.62, lp=1300, fin=0.03)]),
        ('watermelon-spawn-1', 0.86, [L('wet2', 0.70, rate=0.66, lp=1400, fin=0.03)]),
    ],
    'enemy-watermelon-growl': [
        ('watermelon-strain-0', 0.82, [L('dry1', 0.54, rate=0.55, lp=2400, fin=0.10)]),
        ('watermelon-strain-1', 0.82, [L('dry2', 0.50, rate=0.58, lp=2600, fin=0.09)]),
    ],
    'enemy-watermelon-attack': [  # o tanque precisa de soco por baixo da rachadura de casca
        ('watermelon-attack-0', 0.92, [L('punchM', 0.34, rate=0.82, lp=2200),
                                       L('dry4', 0.38, rate=0.60, lp=4200, gain=0.72, at=0.010),
                                       L('wet2', 0.30, rate=0.64, gain=0.42, at=0.03, lp=2200)]),
        ('watermelon-attack-1', 0.92, [L('punchH1', 0.32, rate=0.88, lp=2400),
                                       L('dry3', 0.36, rate=0.63, lp=4400, gain=0.68, at=0.010),
                                       L('wet4', 0.28, rate=0.60, gain=0.40, at=0.03, lp=2300)]),
    ],
    'enemy-watermelon-hurt': [
        ('watermelon-hurt-0', 0.76, [L('punchM', 0.22, rate=0.95, lp=1900),
                                     L('wet4', 0.20, rate=0.72, gain=0.50, lp=1600, at=0.006)]),
        ('watermelon-hurt-1', 0.76, [L('punchH1', 0.20, rate=1.02, lp=2000),
                                     L('wet3', 0.18, rate=0.76, gain=0.46, lp=1700, at=0.006)]),
    ],
    'enemy-watermelon-death': [
        ('watermelon-death-0', 0.90, [L('dry3', 0.62, rate=0.55, lp=3600),
                                      L('wet1', 0.56, rate=0.60, gain=0.66, at=0.03)]),
        ('watermelon-death-1', 0.90, [L('dry1', 0.58, rate=0.58, lp=3800),
                                      L('wet5', 0.52, rate=0.62, gain=0.62, at=0.03)]),
    ],
    'enemy-watermelon-heavy': [  # camada do golpe: soco, casca rachando e um estilhaço seco
        ('watermelon-impact-0', 0.88, [L('punchH0', 0.30, rate=0.85, lp=1800),
                                       L('dry4', 0.28, rate=0.50, lp=2100, gain=0.60, at=0.008),
                                       L('break1', 0.22, rate=0.80, gain=0.30, at=0.05, hp=900)]),
        ('watermelon-impact-1', 0.88, [L('punchH1', 0.28, rate=0.90, lp=1900),
                                       L('dry3', 0.26, rate=0.53, lp=2200, gain=0.56, at=0.008),
                                       L('break2', 0.20, rate=0.85, gain=0.28, at=0.04, hp=950)]),
    ],

    # -------- Tomate: fogo curto com cuspe --------------------------------------------------
    'enemy-tomato-spawn': [
        ('tomato-spawn-0', 0.82, [L('wet6', 0.28, rate=1.25, hp=480),
                                  L('air3', 0.24, rate=1.10, gain=0.36, at=0.05)]),
        ('tomato-spawn-1', 0.82, [L('wet8', 0.26, rate=1.30, hp=520),
                                  L('air5', 0.22, rate=1.15, gain=0.32, at=0.05)]),
    ],
    'enemy-tomato-growl': [  # preparo: a chama pegando
        ('tomato-ignite-0', 0.80, [L('fire', 0.42, start=0.20, rate=1.0, lp=4200, fin=0.09)]),
        ('tomato-ignite-1', 0.80, [L('fire', 0.38, start=0.26, rate=1.08, lp=4600, fin=0.08)]),
    ],
    'enemy-tomato-attack': [  # o pedido explícito: sopro de bola de fogo + cuspe molhado curto
        ('tomato-attack-0', 0.92, [L('fire', 0.58, start=0.50, rate=1.05),
                                   L('wet7', 0.14, rate=1.30, hp=600, gain=0.38, at=0.015)]),
        ('tomato-attack-1', 0.92, [L('fire', 0.54, start=0.56, rate=1.12),
                                   L('wet6', 0.13, rate=1.35, hp=640, gain=0.34, at=0.012)]),
    ],
    'enemy-tomato-hurt': [
        ('tomato-hurt-0', 0.74, [L('wet8', 0.18, rate=1.25, hp=420)]),
        ('tomato-hurt-1', 0.74, [L('wet7', 0.16, rate=1.32, hp=460)]),
    ],
    'enemy-tomato-death': [
        ('tomato-death-0', 0.88, [L('wet1', 0.36, rate=1.10),
                                  L('fire', 0.44, start=1.10, gain=0.52, at=0.14, lp=5000)]),
        ('tomato-death-1', 0.88, [L('wet3', 0.34, rate=1.15),
                                  L('fire', 0.42, start=1.24, gain=0.48, at=0.13, lp=5200)]),
    ],
    'enemy-tomato-swish': [  # camada do golpe: o ar do projétil
        ('tomato-whoosh-0', 0.84, [L('air3', 0.30, rate=0.92),
                                   L('fire', 0.28, start=0.58, gain=0.44, lp=900)]),
        ('tomato-whoosh-1', 0.84, [L('air5', 0.28, rate=0.96),
                                   L('fire', 0.26, start=0.66, gain=0.40, lp=950)]),
    ],

    # -------- Cenoura: raiz fibrosa e feixe -----------------------------------------------------
    'enemy-carrot-spawn': [
        ('carrot-spawn-0', 0.82, [L('dry2', 0.44, rate=0.80, lp=2900, fin=0.03),
                                  L('wet4', 0.30, rate=0.82, gain=0.32, at=0.16, lp=2000)]),
        ('carrot-spawn-1', 0.82, [L('dry5', 0.42, rate=0.86, lp=3100, fin=0.03),
                                  L('wet3', 0.28, rate=0.86, gain=0.30, at=0.15, lp=2100)]),
    ],
    # Carga curta e controlada, depois a soltura — sem voz de fada e sem bipe retrô. O corpo é o
    # `forceField` invertido (vira um crescendo) somado a ar texturizado; a soltura é o
    # `laserLarge` com corte de agudos e rampa de 10 ms, para a borda não ficar em ponta.
    'enemy-carrot-growl': [
        ('carrot-charge-0', 0.82, [L('field2', 0.42, start=0.16, reverse=True, fin=0.16, fout=0.01),
                                   L('air3', 0.30, rate=0.85, hp=400, gain=0.30, at=0.06),
                                   L('beamL', 0.26, rate=0.95, lp=6000, fin=0.010, gain=0.52, at=0.36)]),
        ('carrot-charge-1', 0.82, [L('field0', 0.38, start=0.20, reverse=True, fin=0.14, fout=0.01),
                                   L('air5', 0.28, rate=0.90, hp=440, gain=0.28, at=0.05),
                                   L('beamL3', 0.24, rate=1.00, lp=5600, fin=0.010, gain=0.48, at=0.33)]),
    ],
    'enemy-carrot-attack': [  # descarga: feixe encorpado, ar por baixo e um calor de fogo real
        ('carrot-beam-0', 0.90, [L('beamL', 0.46, rate=0.95, lp=6500, fin=0.008),
                                 L('fire', 0.30, start=0.62, lp=2400, gain=0.32, at=0.01),
                                 L('air3', 0.24, rate=1.05, hp=500, gain=0.24, at=0.005)]),
        ('carrot-beam-1', 0.90, [L('beamL3', 0.44, rate=1.00, lp=6000, fin=0.008),
                                 L('fire', 0.28, start=0.70, lp=2200, gain=0.30, at=0.01),
                                 L('air5', 0.22, rate=1.10, hp=520, gain=0.22, at=0.005)]),
    ],
    'enemy-carrot-hurt': [
        ('carrot-hurt-0', 0.74, [L('dry3', 0.16, rate=1.35, hp=720)]),
        ('carrot-hurt-1', 0.74, [L('dry5', 0.15, rate=1.42, hp=760)]),
    ],
    'enemy-carrot-death': [  # a raiz partindo: corte seco primeiro, fibra e polpa depois
        ('carrot-death-0', 0.88, [L('chop', 0.22, rate=0.85, hp=300),
                                  L('dry1', 0.38, rate=1.05, hp=380, gain=0.62, at=0.06),
                                  L('wet3', 0.32, rate=0.98, gain=0.44, at=0.22)]),
        ('carrot-death-1', 0.88, [L('chop', 0.20, rate=0.92, hp=320),
                                  L('dry2', 0.36, rate=1.10, hp=400, gain=0.58, at=0.05),
                                  L('wet4', 0.30, rate=1.02, gain=0.42, at=0.20)]),
    ],
    'enemy-carrot-charge': [  # camada do golpe: a mesma carga e soltura, bem mais curtas
        ('carrot-coil-0', 0.82, [L('field2', 0.30, start=0.26, reverse=True, fin=0.12, fout=0.01),
                                 L('beamL', 0.20, rate=1.05, lp=6200, fin=0.008, gain=0.56, at=0.24)]),
        ('carrot-coil-1', 0.82, [L('field0', 0.28, start=0.30, reverse=True, fin=0.11, fout=0.01),
                                 L('beamL3', 0.19, rate=1.10, lp=5800, fin=0.008, gain=0.52, at=0.22)]),
    ],

    # -------- Chefe: impacto orgânico em camadas, sem rugido ------------------------------------
    # O soco entra como corpo em todos os eventos pesados do chefe, para o peso vir do impacto e
    # não de mais uma camada de esguicho.
    'enemy-boss-spawn': [
        ('boss-spawn-0', 0.90, [L('punchH0', 0.62, rate=0.55, lp=1200),
                                L('dry3', 0.78, rate=0.45, lp=1700, gain=0.68, at=0.02),
                                L('wet5', 0.60, rate=0.50, gain=0.42, at=0.05, lp=1500),
                                L('sub', 0.46, rate=0.90, gain=0.50, at=0.02, lp=190)]),
        ('boss-spawn-1', 0.90, [L('punchH1', 0.58, rate=0.58, lp=1300),
                                L('dry1', 0.74, rate=0.48, lp=1800, gain=0.64, at=0.02),
                                L('wet2', 0.56, rate=0.52, gain=0.40, at=0.05, lp=1600),
                                L('sub', 0.42, rate=0.95, gain=0.46, at=0.02, lp=200)]),
    ],
    'enemy-boss-growl': [
        ('boss-strain-0', 0.84, [L('dry1', 0.66, rate=0.42, lp=1900, fin=0.14)]),
        ('boss-strain-1', 0.84, [L('dry5', 0.62, rate=0.45, lp=2000, fin=0.12)]),
    ],
    'enemy-boss-attack': [
        ('boss-attack-0', 0.94, [L('punchH0', 0.52, rate=0.60, lp=1400),
                                 L('dry4', 0.60, rate=0.45, lp=3000, gain=0.74, at=0.012),
                                 L('wet2', 0.46, rate=0.50, gain=0.42, at=0.04),
                                 L('sub', 0.40, rate=0.85, gain=0.52, at=0.015, lp=210)]),
        ('boss-attack-1', 0.94, [L('punchH1', 0.48, rate=0.64, lp=1500),
                                 L('dry3', 0.56, rate=0.48, lp=3200, gain=0.70, at=0.012),
                                 L('wet5', 0.44, rate=0.54, gain=0.40, at=0.04),
                                 L('sub', 0.38, rate=0.90, gain=0.48, at=0.015, lp=220)]),
    ],
    'enemy-boss-hurt': [
        ('boss-hurt-0', 0.78, [L('punchM', 0.28, rate=0.70, lp=1200),
                               L('wet4', 0.26, rate=0.55, gain=0.48, lp=1400, at=0.008)]),
        ('boss-hurt-1', 0.78, [L('punchH1', 0.26, rate=0.75, lp=1300),
                               L('wet3', 0.24, rate=0.58, gain=0.44, lp=1500, at=0.008)]),
    ],
    'enemy-boss-death': [
        ('boss-death-0', 0.92, [L('punchH0', 0.66, rate=0.52, lp=1300),
                                L('dry5', 0.84, rate=0.42, lp=2800, gain=0.70, at=0.03),
                                L('wet1', 0.66, rate=0.48, gain=0.46, at=0.06),
                                L('sub', 0.48, rate=0.80, gain=0.50, at=0.03, lp=200)]),
        ('boss-death-1', 0.92, [L('punchH1', 0.62, rate=0.55, lp=1400),
                                L('dry3', 0.80, rate=0.44, lp=2900, gain=0.66, at=0.03),
                                L('wet5', 0.62, rate=0.50, gain=0.44, at=0.06),
                                L('sub', 0.44, rate=0.85, gain=0.46, at=0.03, lp=210)]),
    ],
    'enemy-boss-heavy': [  # camada do golpe: soco grave com cauda de sub
        ('boss-impact-0', 0.90, [L('punchH0', 0.42, rate=0.62, lp=1100),
                                 L('sub', 0.34, rate=0.88, gain=0.50, lp=190, at=0.006),
                                 L('wet2', 0.30, rate=0.45, gain=0.30, lp=1200, at=0.02)]),
        ('boss-impact-1', 0.90, [L('punchH1', 0.40, rate=0.66, lp=1200),
                                 L('sub', 0.32, rate=0.92, gain=0.46, lp=200, at=0.006),
                                 L('wet5', 0.28, rate=0.48, gain=0.28, lp=1300, at=0.02)]),
    ],

    # -------- Grupos genéricos: a rede de segurança quando falta a chave da espécie -------------
    # Precisam ser orgânicos também, senão uma espécie sem chave cai de volta no material recusado.
    'growl': [
        ('common-strain-0', 0.80, [L('dry2', 0.40, rate=0.88, hp=280, lp=4800, fin=0.06)]),
        ('common-strain-1', 0.80, [L('dry5', 0.36, rate=0.95, hp=320, lp=5000, fin=0.05)]),
        ('common-strain-2', 0.80, [L('dry1', 0.34, rate=0.92, hp=300, lp=4600, fin=0.05)]),
    ],
    # Três texturas diferentes em cada grupo genérico (corte, fibra, batida seca) — não três
    # variações do mesmo esguicho.
    'attack': [
        ('common-attack-0', 0.90, [L('chop', 0.20, rate=1.00, hp=400),
                                   L('dry4', 0.22, rate=1.00, hp=360, gain=0.60, at=0.008)]),
        ('common-attack-1', 0.90, [L('dry3', 0.22, rate=1.05, hp=380),
                                   L('wet8', 0.17, rate=0.98, gain=0.46, at=0.014)]),
        ('common-attack-2', 0.90, [L('hitDry', 0.20, rate=0.92, lp=6000),
                                   L('wet6', 0.16, rate=1.04, gain=0.40, at=0.012)]),
    ],
    'hurt': [
        ('common-hurt-0', 0.74, [L('wet7', 0.17, rate=1.00, hp=260)]),
        ('common-hurt-1', 0.74, [L('hitDry', 0.16, rate=0.95, lp=5000)]),
        ('common-hurt-2', 0.74, [L('hitWood', 0.15, rate=1.05, lp=4000)]),
    ],
    'death': [
        ('common-death-0', 0.88, [L('wet1', 0.52, rate=0.85),
                                  L('dry1', 0.34, rate=0.82, hp=320, gain=0.44, at=0.22)]),
        ('common-death-1', 0.88, [L('wet5', 0.48, rate=0.88),
                                  L('dry3', 0.32, rate=0.86, hp=340, gain=0.40, at=0.20)]),
    ],
    'spawn': [
        ('common-spawn-0', 0.84, [L('wet4', 0.50, rate=0.90, lp=2800, fin=0.025)]),
        ('common-spawn-1', 0.84, [L('wet2', 0.46, rate=0.94, lp=3000, fin=0.025)]),
    ],
    # `heavy` também é a pancada que o jogador leva (player-hit/fatalImpact/golpes de skill), e é
    # o grupo que toca mais vezes seguidas. Os quatro são conduzidos pela família `impactPunch`
    # (corpo e soco) — a que foi recusada era a `impactSoft_heavy`, outra coisa — e cada um leva um
    # peso físico diferente: soco grave + fibra, soco + madeira, soco médio + polpa, batida de
    # madeira + pedra. Quatro pesos, não quatro esguichos.
    'heavy': [
        ('common-heavy-0', 0.88, [L('punchH0', 0.34, rate=0.92, lp=2600),
                                  L('dry4', 0.26, rate=0.70, lp=3000, gain=0.42, at=0.008)]),
        ('common-heavy-1', 0.88, [L('punchH1', 0.30, rate=1.00, lp=2800),
                                  L('hitWood', 0.20, rate=0.85, lp=3400, gain=0.40, at=0.006)]),
        ('common-heavy-2', 0.88, [L('punchM', 0.28, rate=0.88, lp=2400),
                                  L('wet2', 0.24, rate=0.64, lp=1700, gain=0.38, at=0.012)]),
        ('common-heavy-3', 0.88, [L('knock', 0.26, rate=0.80, lp=2200),
                                  L('hitRock', 0.10, rate=0.90, hp=600, gain=0.44, at=0.004)]),
    ],
}

# Limites de duração por tipo de evento, conferidos aqui e no teste.
BOUNDS = {
    'hurt': (0.12, 0.65), 'heavy': (0.12, 0.65), 'pistol': (0.12, 0.65),
    'swish': (0.12, 0.65), 'charge': (0.12, 0.65),
    'growl': (0.15, 0.75), 'attack': (0.12, 0.98),
    'spawn': (0.15, 1.05), 'death': (0.15, 1.05),
}


def bound_for(group: str) -> tuple[float, float]:
    return BOUNDS[group.split('-')[-1]]


# --------------------------------------------------------------------------------------------

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def measure(path: Path) -> dict:
    data, rate = sf.read(path, always_2d=True, dtype='float64')
    mono = data.mean(axis=1)
    return {
        'seconds': round(len(mono) / rate, 4),
        'peak': round(float(np.max(np.abs(mono))), 4),
        'rate': rate,
        'channels': data.shape[1],
        'bytes': path.stat().st_size,
        'sha256': sha256(path),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--sources', default='.temp/enemy-audio-sources')
    parser.add_argument('--check', action='store_true', help='não escreve; só confere o relatório')
    args = parser.parse_args()
    sources = (ROOT / args.sources).resolve()

    report_path = ROOT / 'docs' / 'enemy-audio-assets.json'

    if args.check:
        report = json.loads(report_path.read_text(encoding='utf-8'))
        bad = [name for name, row in report['assets'].items()
               if not (OUT_DIR / name).exists() or sha256(OUT_DIR / name) != row['sha256']]
        print('check:', 'OK' if not bad else f'DIVERGEM: {bad}')
        return 1 if bad else 0

    missing = [key for key in SOURCES if not _path(key, sources).exists()]
    if missing:
        print(f'Faltam gravações de origem em {sources}: {missing}')
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bank = json.loads(MANIFEST.read_text(encoding='utf-8-sig'))
    assets: dict[str, dict] = {}

    for group, clips in RECIPES.items():
        urls = []
        low, high = bound_for(group)
        for name, peak, layers in clips:
            audio = render(layers, peak, sources)
            path = OUT_DIR / f'{name}.ogg'
            # O Vorbis pode devolver um pico maior que o do buffer original (overshoot do
            # codec): escrevemos, medimos o arquivo decodificado e recuamos até caber no teto.
            target, row = peak, None
            for _ in range(6):
                sf.write(path, audio * (target / peak), SR, format='OGG', subtype='VORBIS')
                row = measure(path)
                if row['peak'] < CEILING:
                    break
                target *= (CEILING - 0.03) / row['peak']
            assert row is not None
            row['group'] = group
            row['sources'] = sorted({layer['src'] for layer in layers})
            assets[path.name] = row
            if not (low - 1e-3 <= row['seconds'] <= high + 1e-3):
                print(f'  ! {name}: {row["seconds"]}s fora de [{low}, {high}] ({group})')
            if row['peak'] >= CEILING:
                print(f'  ! {name}: pico {row["peak"]} acima do teto {CEILING}')
            urls.append(PUBLIC_URL + path.name)
        bank[group] = urls
        print(f'{group:28s} {len(urls)} peça(s)')

    MANIFEST.write_text(json.dumps(bank, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    rejected = {}
    for pattern in REJECTED_GLOBS:
        for path in sorted(ROOT.glob(pattern)):
            rejected.setdefault(sha256(path), []).append(path.name)
    (ROOT / 'docs' / 'enemy-audio-rejected.json').write_text(
        json.dumps({'note': 'sha256 do material recusado pelo usuário; nenhum grupo ativo do '
                            'manifest pode apontar para um arquivo com estes hashes.',
                    'hashes': rejected}, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    report_path.write_text(json.dumps({
        'note': 'Gerado por scripts/prepare-enemy-audio.py. Medidas tiradas do .ogg já codificado.',
        'sampleRate': SR, 'assets': assets,
    }, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    (ROOT / 'docs' / 'enemy-audio-sources.json').write_text(json.dumps([
        {**entry, 'sha256': {key: sha256(_path(key, sources)) for key in entry['files']}}
        for entry in SOURCE_LICENSES
    ], indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    print(f'\n{len(assets)} peças em {OUT_DIR.relative_to(ROOT)}; '
          f'{len(rejected)} hashes recusados registrados.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

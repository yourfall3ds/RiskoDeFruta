/**
 * Atlas autorais da chuva.
 *
 * **Procedência:** gerados offline por `scripts/build-rain-atlas.py` (numpy dentro do Blender), que é
 * a fonte editável. **Não são fotografia nem gravação** — e não fingem ser. O que os separa do
 * ícone geométrico anterior é a variedade: dezesseis rastros distintos, com comprimento, espessura,
 * ondulação e encordoamento próprios, em vez de um único SVG repetido.
 *
 * O RGB é branco de propósito: a cor vem do material, como no feixe dos marcos. A forma inteira
 * está no alfa.
 */

export const RAIN_STREAK_TEXTURE='/textures/weather/rain-streaks.png';
export const RAIN_SPLASH_TEXTURE='/textures/weather/rain-splash.png';
export const RAIN_HAZE_TEXTURE='/textures/weather/rain-haze.png';

/** Lado do atlas em pixels. */
export const ATLAS_SIZE=512;
/** Células por linha/coluna. */
export const ATLAS_GRID=4;
/** Lado de uma célula em pixels. */
export const ATLAS_CELL=ATLAS_SIZE/ATLAS_GRID;
/** Última célula válida (`startSpriteCellID`..`endSpriteCellID`). */
export const ATLAS_LAST_CELL=ATLAS_GRID*ATLAS_GRID-1;

/**
 * O atlas de rastros é um BANCO de variações, não uma animação: cada gota sorteia uma célula e a
 * mantém pela vida inteira. O de respingo é o contrário — um flipbook que abre e some.
 */
export const SPLASH_FLIPBOOK_FPS=ATLAS_GRID*ATLAS_GRID;

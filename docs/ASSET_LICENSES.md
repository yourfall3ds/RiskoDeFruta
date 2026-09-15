# Third-party art

## Brown Mud Leaves 01

Source: https://polyhaven.com/a/brown_mud_leaves_01

License: CC0, https://polyhaven.com/license

Downloaded through the official Poly Haven API on 2026-09-06. Local files in `public/textures/brown_mud_leaves_01/` are the 2K JPG diffuse, OpenGL normal and AO/roughness/metallic maps. MD5 checksums were verified against the API response before use. Runtime uses local files without third-party requests.

## Kloofendal 48d Partly Cloudy (Pure Sky)

Source: https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky

License: CC0. Official 2K HDR download, verified against its API MD5 checksum. Stored at `public/environment/field-sky.hdr` and used for PBR lighting. The visible sky is now the generated cosmic panorama.

The character and reference images were supplied by the user; their originals remain in `assets/`.

## Floating farm environment

Architecture textures and vegetation/rock scans: Poly Haven CC0. Individual source pages, local pipeline and generated sky prompt are recorded in [WORLD_PRESENTATION.md](WORLD_PRESENTATION.md). The sky was generated with the integrated image generation tool and saved as `public/environment/cosmic-sky.png`; it is not a Poly Haven download. No Meshy service was used.

## Farm props and fruit crest

Additional Poly Haven CC0 assets downloaded through its official API on 2026-09-06:

- Bananas: https://polyhaven.com/a/bananas
- Wooden Crate 01: https://polyhaven.com/a/wooden_crate_01
- Wooden Barrels 01: https://polyhaven.com/a/wooden_barrels_01
- Watering Can Metal 01: https://polyhaven.com/a/watering_can_metal_01

Local runtime derivatives: `supply-crate.glb`, `farm-barrels.glb`, `watering-can.glb`, banana crests and objects embedded in `farm-world.glb`. License: https://polyhaven.com/license. The current generated sky, waterfall, red paint and botanical surface are documented in [GENERATED_ART.md](GENERATED_ART.md).

## Áudio gravado e acessórios — 07/09/2026

Amostras locais CC0; fontes e autores detalhados em [foley-sources.json](foley-sources.json): Kenney (impactos/passos), pauliuw (criaturas), qubodup (swishes), ezwa/qubodup (água) e TabascoCZ (tiros). Não há síntese por osciladores no áudio atual.

Baú articulado, volumes geológicos, ilha móvel e discos voadores foram modelados localmente no Blender e usam texturas PBR já existentes do acervo Poly Haven CC0. Os cinco inimigos originais fornecidos pelo usuário preservam malhas, materiais, imagens e skins; ver original-enemy-integrity.json.

- **Grito do personagem na morte**: HaelDB, [Male Grunt/Yelling sounds](https://opengameart.org/content/male-gruntyelling-sounds), CC0. Original `yelling sounds/1yell11.wav`, copiado sem alteração para `public/audio/foley/player-death-scream.wav`; velocidade de reprodução 0,95 em runtime.

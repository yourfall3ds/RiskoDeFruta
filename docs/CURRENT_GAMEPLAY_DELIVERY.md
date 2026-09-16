# Current gameplay delivery — 2026-09-15

## Update — 2026-09-16 (supersedes previous flow and combo notes below)

- Each expedition stage chooses a seeded random starting island and a different island for its only chalice. Actual points must be at least 100 m apart (150 m in larger biomes), have safe floor and a navigation route. No nearby fallback. New seeds vary the start; restarting the same seed is reproducible.
- Full cup plus defeated boss now unlock E collection at the cup itself. Juice drains, the real dropship arrives, the character boards and travels through the existing biomes: city → solar frontier → highlands → rootwood. Inventory, level and XP persist; credits convert to XP. Load failures retry without advancing. Fall recovery uses the new biome's safe origin.
- Exploration remains capped at eight hostiles after the gentle opening; final-event pressure scales with level. Boss base HP is 1500 and grows with stage and level. Normal-play balance acceptance remains pending.
- Six recorded Transformice motions replace the previous combo approximation. Blender retargeting preserves proportions, plants skinned boots and tempers shoulders/neck. Zero-based animation timing removes the extra playback hold. A separate CombatFists morph closes gloves during melee and restores pistol grip afterward. Grounded strikes slow movement during windup/contact; dodge/dash cancels them. Unlimited sprint remains.
- Five existing walk-in barns gain distinct authored CC0 prop layouts, signage and lighting, with eight interior chest positions. Source Transformice assets remain untouched. Interiors are distance culled.

### New verification

- Actual collision/sculpted terrain and navigation audit: 52 seed/biome plans passed (`docs/stage-route-audit.json`).
- Browser confirmed stage 1: barn plateau → seed district, 100 m; stage 2: grain port → orchard, 109 m; stage 3: seed valley → windmills, 228 m. Actual E collection traveled twice with the same inventory item preserved. QA invulnerability stayed off. Completion was prepared with an explicitly labeled QA control, so this is flow validation, not a normal boss-fight balance test.
- Browser showed the character aboard the ship, new punch contact and the decorated seed-district barn entrance. Combat HUD is hidden during travel.
- Six-clip audit passes reach, contact timing, rotation and skinned-boot sliding thresholds. Reviewed high-kick and roundhouse renders. Uneven-terrain foot placement may still need refinement.
- Journey, route, inventory, safe-recovery, fist-morph and melee-movement tests pass. Full suite retains six pre-existing missing-source-fixture failures; none were weakened.
- Highlands still showed heavy render load in review. No blanket FPS, sound, rain or balance approval is claimed. Co-op stage synchronization is not implemented; legacy modes retain their portal.

### Current animation pipeline

`prepare-recorded-combos.mjs` → Blender `bake-recorded-combos.py` → `merge-combo-clips.mjs` → `shape-combat-fists.mjs --apply` → `compact-gunslinger.mjs` → `audit-combo-clips.mjs`.

Do not run the older synthetic combo authoring script over these recorded clips. Recheck routes with `npx tsx scripts/audit-stage-routes.ts`. Blender review outputs stay local; runtime assets, manifests and scripts are versioned.

Claude Code handled stage logic/balance and barn assets/collision. Codex handled recorded animation retargeting, fist mesh, boarding presentation, integration and visual QA. Prior delivery notes follow as history; references to a final portal, open fists and the older combo authoring pipeline are superseded above.

## Previous delivery

- One reachable chalice per stage, selected with a deterministic stage-specific seed away from arrival. Explore and loot before activating it. Discovery reveals the destination within 35 m; the amber beam remains a visual clue.
- Activation starts the final boss event immediately. Nearby combat deaths provide juice; opening the rift requires both a full cup and a dead boss, in either order. No population-clear requirement. One reward drops at the decisive death location.
- Placement rejects thin walls and roofs as well as narrow/steep floors. The reviewed seed now places the cup outside the district barn. Existing gentle opening and time-based director scaling remain.
- Removed all 204 problematic open coastal dressing instances (125 with collision, 79 visual only). Their source ground scan was being stretched into tall cliffs. The ten existing closed island bodies and their collision remain; every unrelated collision triangle and box is preserved. No claim of new mountains or terrain holes.
- Fall/interior recovery searches a broad uppermost floor with capsule clearance. It validates saved checkpoints and clears residual movement. Browser reproduction of a buried checkpoint returned to x45.5/y2/z8, grounded, with one recovery and no repeated loop.
- V holsters/draws weapons. Six real Blender clips drive the combo: right punch, left punch, right kick, uppercut, left kick, spinning kick. Attack-speed items accelerate the whole attack and animation together. Removed the additive melee pose implementation that twisted the rig.
- Ten explicitly selected recordings from the user's `transformice` game now serve punches, kicks, heavy strikes, swing, received hit, lethal heavy-melee flight and body contact. Flight is distance attenuated, rate limited and fades after 1.1 seconds. Impact only follows actual contact. Original project files remain untouched.
- Inventoried all 126 GLB animation files under `transformice/assets/animations`. All expose matching 24-joint names; this alone does not prove full compatibility. Imported only `falling` and `hit_face` after offline visual review: rotation channels by bone name, no source meshes, scales, bone-length translations or root travel.
- Imported fall plays on prolonged descent (>1.15 seconds airborne and >8 m/s downward), yielding to shooting/specials/wall sliding/dodging. Imported hit is a restrained upper-body reaction without interrupting movement. Normal jump remains. No stamina or exhaustion mechanic was added; sprint remains unlimited.

## Validation

- Blender contact renders and numeric six-combo audit: no foot-air frames, finite normalized rotations, contact timing aligned to damage windows, no skin or bone-length changes. Review exports are local under `art/combo-review` and `art/motion-review`.
- Browser checks: clean east bridge/cliff, safe-return reproduction, punch/hook/spin poses, weapon HUD switch, search/discovery/activation prompts. The final event displayed a live Praga Alfa and 28/60 juice from actual combat.
- Tests cover single-cup selection/discovery, either boss/cup completion order, one reward at decisive death, wall/roof rejection, buried/ledge checkpoints, real-rig melee/fall playback, separate audio routing and bounded flight impulse.
- Production build and client/server typechecks pass. Full suite: 801 passed, six pre-existing ENOENT source-fixture failures (five original fruit GLBs and the pre-directional gunslinger backup). Runtime assets are present.

## Remaining visual/gameplay work

- Additional `transformice` combos, knockdown/get-up, parkour and alternative movement are catalogued, not bulk-imported or enabled. Each needs pose/contact/root-motion review. `catch_breath` is deliberately excluded because the player has no stamina.
- The current gloves have no finger bones: hand shapes still need mesh work for closed fists. Moving while a full-body strike plays can still slide the feet; locomotion/strike blending needs further review.
- Pronounced mountains, physical pits and terrain destruction remain separate work.
- Subjective sound/rain approval and sustained dense-horde performance acceptance remain open.
- Claude Code was unavailable due to its quota reset during this delivery; these changes and checks were done locally by Codex.

## Reproduction

- `npx tsx scripts/plan-initial-rocks.mjs`
- Blender: `scripts/author-combo-actions.py`, then `node scripts/merge-combo-clips.mjs` and `node scripts/audit-combo-clips.mjs`.
- `python scripts/import-transformice-combat.py`
- `node scripts/import-transformice-motion.mjs` creates the visual-review candidate; `--apply` writes the selected clips. The source project must be present at the documented path. The ignored pre-import backup preserves the original runtime clips.
- `npm run build`, `npm run server:typecheck`, `npm test`.

Vite review HMR is disabled; reload/start a new run to see the updated content. Reloading an active run resets it.

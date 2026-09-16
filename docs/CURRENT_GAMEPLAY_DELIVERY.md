# Current gameplay delivery — 2026-09-15

## Implemented

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

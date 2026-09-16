# Initial bridge rocks and directional footsteps

> Historical delivery: the rock layer and multi-chalice flow described below were superseded by [the current delivery](CURRENT_GAMEPLAY_DELIVERY.md).

## Rocks

Integrated 39 replacements using geometry derived from the existing scanned rock asset.
Original GLBs remain unchanged. Client and server use the same replacement collision triangles.
Removal uses exact named triangle ranges from `docs/collision-bake.json`, guarded by a fingerprint
of the source mesh. The earlier spatial/component heuristic was discarded: a rock volume also
contains bridge rails and must not be used as evidence that they should be removed.

Validation:
- Exact preservation of every non-rock collision triangle and all authored boxes.
- Equal client/server base geometry, stale-plan rejection, bridge clearance sampling.
- Real PlayerMotor walk from x18 to the east outpost at z8, without falling or solid recovery.
- Ran the navigation bake; all route cases passed. Its current surface/box/patch inputs do not
  include the base collision triangle soup, so this did not change the exported navmesh binary.
  Exact navigation around the new rock silhouettes is still a separate limitation.
- Browser review at x28/z8: unobstructed bridge deck and rails, rocks below the passage.
  No console errors. Separate QA tab closed; user game was not reloaded.
- 30 terrain/network checks and five initial-rock checks passed (four of those overlap).

## Footsteps

The real GLB contact detector now covers all eight walking/running headings. Diagonal movement
keeps the dominant leg cycle when clips have different lengths, blending only the upper body.
This prevents incompatible foot phases from cancelling lift; it does not invent timer footsteps.
The suppression hook is connected for melee, arrival and death. 59 focused tests passed and the
real-clip audit was regenerated successfully.

Remaining: author phase-aligned diagonal clips for fuller leg blending, and inspect the existing
run-to-walk cross-fade foot lift. Perceived audio synchronization still needs in-game listening.
These changes do not finish baked melee combos or establish crowded-scene FPS improvement.

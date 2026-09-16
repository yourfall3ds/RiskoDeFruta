# Chalice objectives and gentle expedition opening

> Historical delivery: the rock layer and multi-chalice flow described below were superseded by [the current delivery](CURRENT_GAMEPLAY_DELIVERY.md).

## Behavior

- The first ambient enemy arrives after six seconds of active gameplay. Spawns are individual.
- Exploration caps are three living enemies before 30 seconds, five before 60 seconds, and
  eight before two minutes. Later pressure grows gradually. Active chalices increase pressure;
  the actual performance budget remains an upper bound.
- The main HUD points toward the nearest pending chalice and shows its distance. The route
  panel explains the amber beam and encourages opening chests while moving between objectives.
- Each chalice requires 40/60/80/100 juice units. Actual nearby combat deaths fill it according
  to fruit type, with the existing varied-combat multiplier. Waiting contributes nothing.
- Every combat death has a sequence independent of reused actor IDs. Duplicate deaths, debug
  kills, distant kills, and kills made while the player is outside the active area do not fill it.
- The decisive death position is queued with the reward, so subsequent kills cannot move it.
- Four independent authored GLB cups display fill morphs and bounded juice droplets. Collision
  uses the actual static bowl/frame geometry; animated juice and droplets have no solid collider.
- Imported materials are limited to four simultaneous lights before first compilation to avoid
  exceeding the WebGL uniform-buffer limit when morph targets and scene lights are combined.

## Validation

- Client and server TypeScript checks and production build pass.
- Real-browser review: cup renders, E activates it, and it remains at 0/40 through 44 seconds
  without kills. This does not establish subjective approval of the liquid material/animation.
- Fresh run without enemy-spawn QA commands: zero enemies on entry, three navigation agents
  (four total entities including player) at 22 seconds. The new direction/distance prompt renders.
- Director tests cover three seeds, delayed first arrival, one spawn per update, early live cap,
  nonzero-population replenishment, event pressure and performance limits.
- Objective and EnemySwarm tests cover actual deaths, duplicate suppression, reused actors,
  pause/resume, completion, boss transition and decisive-kill reward position.

## Remaining work

- Pronounced island mountains and actual pits/holes are not delivered by these changes. The
  current additive relief cannot make a real hole while the original floor/collision survives.
- The chalice integration is for the existing local expedition mode; networked expedition
  objectives and matching server chalice props are not claimed here.
- Blender melee combos, final rain/audio approval and crowded-scene FPS acceptance remain open.
- Six existing source-asset preservation tests cannot run because their original imported
  files under assets/ and art/processed/ are missing locally. Runtime GLBs are present.

# Extrat — Architecture

The shared decisions for every Soncrant Arcade game are recorded once, in
[`soncsec/star-destroyer` ARCHITECTURE.md](https://github.com/soncsec/star-destroyer/blob/main/ARCHITECTURE.md):

| ADR | Decision |
|---|---|
| 002 | Phaser 4 game engine |
| 003 | TypeScript |
| 004 | Vite build, relative base, no runtime CDN |
| 005 | GitHub Pages staging, Apache production |
| 006 | Rules in engine-free `src/logic/` with unit tests; Playwright e2e with a test-only hook; seeded RNG |
| 007 | Security tooling: CodeQL, ESLint, npm audit, gitleaks, ZAP |
| 009 | Releases: `/srv/games-releases/<slug>/<id>/`, atomic symlink switch, rollback |
| 010 | HTTP on port 80 |
| 011 | Parallel games: one repo, folder, port and portal file per game |

Record **this game's own** decisions below as ADRs, after the owner approves them.

## Code structure

```
src/
├── main.ts            Phaser config, whole-number zoom, loads the test hook in the e2e build only
├── config/tuning.ts   every gameplay number (hit chances, damage, ranges, XP)
├── logic/             game rules: plain TypeScript, no Phaser imports (ESLint enforces), unit tested
│   ├── state.ts       battle and campaign state types; actions; apply(state, action) → state
│   ├── grid.ts        tiles, pathfinding, line of sight, cover
│   ├── combat.ts      hit chance, damage, overwatch, grenades
│   ├── ai.ts          alien turn: scores candidate moves and picks the best
│   ├── mapgen/        seeded map generator: chunks, scatter, validators
│   ├── campaign.ts    missions, ranks, XP, shame
│   └── save.ts        versioned save, validation on load
├── scenes/            Phaser scenes: thin, draw the state and turn input into actions
└── debug/testHook.ts  window.__game for Playwright (e2e build only)
tests/
├── unit/              Vitest, 80% coverage floor on src/logic
├── e2e/               Playwright in Chromium and Firefox, incl. the production CSP
└── release/           release scripts against a fake server
scripts/               release.sh, release-remote.sh, smoke_test.py, zap_check.py, check_repo.py
```

## Game decisions

All approved by the owner on 2026-10-17.

### ADR-E1: Camera — top-down grid with side-view characters — *Accepted*

A flat top-down grid of 16 px tiles. Characters are the art pack's side-view sprites, about two tiles tall, facing left or right toward their target. Units are drawn in row order so lower rows overlap upper ones, and a unit hidden behind a tall object gets an outline.

- **Alternative: isometric (diamond) tiles.** Rejected: the pack has no isometric art, and isometric line of sight, depth sorting and mouse picking are much harder.
- **Alternative: Claude-drawn 4-direction sprites (mockup options B and C).** Rejected by the owner in favor of the pack's higher-quality animated art.
- **Trade-off:** tall sprites can hide what is behind them, and characters face only left or right. Checked during the M1 play-test.

### ADR-E2: Rules engine separate from rendering — *Accepted*

All game rules live in `src/logic/` as plain data and pure functions: `apply(state, action) → state`, with all randomness drawn from a seeded RNG stored in the state. Phaser scenes only draw the state, animate the changes, and turn clicks into actions.

- **Alternative: rules inside Phaser game objects.** Faster to start, but hard to test, hard to save, and the AI couldn't try out moves.
- **Benefits:** unit tests without a browser; saving is serializing the state; the AI simulates actions on copies; a fixed seed replays a bug exactly.

### ADR-E3: Map generation — chunks plus scatter plus validators — *Accepted*

Each map is stitched from small hand-made chunks (clearings, ruins, tree clumps, crash sites) on a landscape base, with random scatter of cover, all from a seed. Validators reject a map and try the next seed if any floor tile is unreachable, the spawn areas are too close, there is too little cover near the squad, or an alien group is unreachable.

- **Alternative: pure noise or cellular automata.** Simpler code, but little control over fairness and cover layout.
- **Alternative: wave function collapse.** Good-looking results, but more complex and harder to make guarantees with.
- **Testing:** the validators run over 1,000 seeds per landscape in the unit tests.

### ADR-E4: Enemy AI — utility scoring — *Accepted*

On its turn, each alien scores every reachable tile and action (cover gained, flanking a marine, hit chance, distance to its group, alien type preferences) and takes the best, with a small seeded random factor. Hidden alien groups stay dormant until they see the squad, then "scamper" to cover: the ambush.

- **Alternative: behavior trees.** More structure than this game needs.
- **Alternative: search several turns ahead (minimax).** Expensive and makes aliens feel unfair.

### ADR-E5: Pathfinding and line of sight written in-house — *Accepted*

Breadth-first search on the grid for movement ranges and paths (uniform tile costs), and grid ray casts for line of sight and cover direction. About 200 lines, fully unit tested, with no new dependency.

- **Alternative: a library such as easystar.js.** Saves little code, adds a dependency to review and pin.

### ADR-E6: Campaign save in localStorage — *Accepted (security decision)*

The campaign state is saved as JSON in `localStorage` under one key, at the start of every turn and after every mission. The save carries a version number. On load it is parsed and checked against the expected shape; a corrupt or unknown save is discarded with a message offering a new campaign, never trusted. No personal data is stored. This replaces the template rule "localStorage holds only the high score" for this game.

- **Alternative: IndexedDB.** More capacity than needed and a more complex API.
- **Alternative: a server and accounts.** Breaks ADR-001 (static sites, no backend) and would add personal data.

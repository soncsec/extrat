# Extrat — Roadmap

> **Status:** APPROVED by owner 2026-10-17. Every milestone ends with something playable on staging (https://soncsec.github.io/extrat/).

The order follows the risks: first prove the core fight is fun and readable with the real art (M1, M2), then the aliens (M3), then random maps (M4), then the campaign (M5), then polish and release (M6).

| Milestone | Status |
|---|---|
| M0 Setup | Waiting for the portal claim (M0.4) |
| M1 Walking skeleton | In progress |
| M2 Tactical core | Not started |
| M3 Aliens and ambush | Not started |
| M4 Maps and landscapes | Not started |
| M5 Campaign | Not started |
| M6 Polish and release | Not started |

## Main risks

| # | Risk | Mitigation | Milestone |
|---|---|---|---|
| 1 | The core fight isn't fun | Playable skirmish first; owner play-tests every milestone | M1, M2 |
| 2 | Tall side-view sprites make the grid hard to read | Tested with the real art in M1; outlines for hidden units; row-ordered drawing | M1 |
| 3 | Random maps are broken or unfair | Validators plus a 1,000-seed test per landscape | M4 |
| 4 | AI too weak or unfair; ambushes feel cheap | Utility AI with tuning numbers; play-tests | M3 |
| 5 | Saves corrupt or break between versions | Versioned, validated saves; start-fresh fallback | M5 |
| 6 | XCOM-sized scope creep | Scope fixed in PROJECT.md; changes need owner approval | All |

## M0 — Setup

- [x] M0.1 Repo created from `soncsec/game-template`, `scripts/init-game.sh` run
- [x] M0.2 Branch protection on `main` with the four required checks, secret scanning and Dependabot alerts on
- [x] M0.3 GitHub Pages turned on (Actions mode, `main` only); first staging deploy and ZAP scan pass
- [ ] M0.4 Portal entry `games/extrat.json` (status `in-development`, dev port 5175) merged in `soncsec/games-portal`
- [x] M0.5 PROJECT.md, ARCHITECTURE.md (ADR-E1 to E6), ROADMAP.md and CLAUDE.md approved by the owner

**Acceptance criteria:** CI green on `main`; the staging URL loads; the portal claim is merged.

## M1 — Walking skeleton

A small skirmish on a generated forest map: 4 marines against 2 aliens, from the title screen to a win or loss screen.

- [x] M1.1 Copy the forest art into `public/assets/` and list it in CREDITS.md; draw a simple generated forest grid (grass, trees, rocks) from a seed
- [ ] M1.2 Copy the marine and alien walker art; battle state in `src/logic/` (ADR-E2); place 4 marines and 2 aliens; click to select a marine, with a selection marker
- [ ] M1.3 Movement: reachable tiles shown (BFS, ADR-E5); click a tile to move along the path with the run animation
- [ ] M1.4 Shooting: click an alien to see the hit chance, confirm to fire; seeded hit roll, damage, health bars, death animation
- [ ] M1.5 Alien turn: each alien moves toward the nearest marine and shoots when in range; End Turn button and key
- [ ] M1.6 Title, win and loss screens; Playwright plays a fixed-seed turn through the test hook

**Acceptance criteria:** the owner plays a full skirmish on staging and can both win and lose; rules have unit tests (80% floor); e2e passes in Chromium and Firefox; CI green. The owner judges whether the side-view sprites read well on the grid (risk 2).

## M2 — Tactical core

- [ ] M2.1 Two actions per turn (move, move again or act); moving far ends the turn ("dash")
- [ ] M2.2 Line of sight; half and full cover by direction, with shield icons on hover
- [ ] M2.3 Hit chance from aim, cover, distance and flanking, with a breakdown panel
- [ ] M2.4 Ammo and reload
- [ ] M2.5 Overwatch: shoot the first enemy that moves in sight
- [ ] M2.6 Grenades: area damage, removes cover bonus for one turn
- [ ] M2.7 Camera pan and zoom levels; keyboard shortcuts (next marine, end turn, actions 1–4, Esc to cancel)

**Acceptance criteria:** the owner sees cover and flanking change the hit chance in play; each mechanic has unit tests with fixed seeds; CI green.

## M3 — Aliens and ambush

- [ ] M3.1 Fog of war from the squad's sight; hidden tiles darkened, aliens there not drawn
- [ ] M3.2 Alien groups dormant until spotted, then scamper to cover (the ambush)
- [ ] M3.3 Utility AI: scores tiles for cover, flanking and hit chance (ADR-E4)
- [ ] M3.4 Alien types with their own stats and one ability each: walker (melee), flyer (ignores cover from below), lizard (tongue pull), snake (poison)
- [ ] M3.5 Hurt, death and hit effects from the pack

**Acceptance criteria:** ambushes happen in play-tests; AI decisions have unit tests on fixed boards; the owner finds the fights fair but threatening.

## M4 — Maps and landscapes

- [ ] M4.1 Chunk-based generator with seeded scatter (ADR-E3)
- [ ] M4.2 Validators: reachability, spawn distance, cover density; 1,000-seed test
- [ ] M4.3 Landscapes: forest, town, coast, rocky hills, crash site, alien ship; missing tiles drawn by Claude to match
- [ ] M4.4 Map seed shown in the debrief so a map can be replayed for bug reports

**Acceptance criteria:** every landscape passes the 1,000-seed test; the owner plays one map per landscape on staging.

## M5 — Campaign

- [ ] M5.1 Campaign of 6 missions, one per landscape; briefing and debrief screens
- [ ] M5.2 XP, ranks and stat increases
- [ ] M5.3 Fallen marines return next mission; Wall of Shame (nicknames, death counts, debrief jokes)
- [ ] M5.4 Squad wiped out: retry the mission on a new map
- [ ] M5.5 Autosave every turn; resume from the title screen; versioned save with validation (ADR-E6)
- [ ] M5.6 Final mission on the alien ship with the mech boss

**Acceptance criteria:** the owner plays the campaign from start to finish on staging; closing the browser mid-mission resumes the same turn; save loading rejects corrupt data in tests.

## M6 — Polish and release

- [ ] M6.1 CC0 sound effects (owner approves the assets)
- [ ] M6.2 Squad portraits from the pack; tooltips and first-mission hints
- [ ] M6.3 Balance pass from play-tests
- [ ] M6.4 Portal card image and status `coming-soon`, then `live`
- [ ] M6.5 Static and dynamic security checks; production release with owner approval

**Acceptance criteria:** the definition of success in PROJECT.md section 6 is met on production.

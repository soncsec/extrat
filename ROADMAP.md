# Extrat — Roadmap

> **Status:** APPROVED by owner 2026-10-17. Every milestone ends with something playable on staging (https://soncsec.github.io/extrat/).

The order follows the risks: first prove the core fight is fun and readable with the real art (M1, M2), then the aliens (M3), then random maps (M4), then the campaign (M5), then polish and release (M6).

| Milestone | Status |
|---|---|
| M0 Setup | Done |
| M1 Walking skeleton | Built; owner: "looks great so far" (2026-10-17), full play-test notes pending |
| M2 Tactical core | Built; waiting for the owner's play-test |
| M3 Aliens and ambush | Built; waiting for the owner's play-test |
| M4 Maps and landscapes | In progress |
| M5 Campaign | In progress (PM review 2026-10-18 added M5.8–M5.11) |
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
- [x] M0.4 Portal entry `games/extrat.json` (status `in-development`, dev port 5175) merged in `soncsec/games-portal`
- [x] M0.5 PROJECT.md, ARCHITECTURE.md (ADR-E1 to E6), ROADMAP.md and CLAUDE.md approved by the owner

**Acceptance criteria:** CI green on `main`; the staging URL loads; the portal claim is merged.

## M1 — Walking skeleton

A small skirmish on a generated forest map: 4 marines against 2 aliens, from the title screen to a win or loss screen.

- [x] M1.1 Copy the forest art into `public/assets/` and list it in CREDITS.md; draw a simple generated forest grid (grass, trees, rocks) from a seed
- [x] M1.2 Copy the marine and alien walker art; battle state in `src/logic/` (ADR-E2); place 4 marines and 2 aliens; click to select a marine, with a selection marker
- [x] M1.3 Movement: reachable tiles shown (BFS, ADR-E5); click a tile to move along the path with the run animation
- [x] M1.4 Shooting: click an alien to see the hit chance, confirm to fire; seeded hit roll, damage, health bars, death animation
- [x] M1.5 Alien turn: each alien moves toward the nearest marine and shoots when in range; End Turn button and key
- [x] M1.6 Title, win and loss screens; Playwright plays a fixed-seed turn through the test hook

**Acceptance criteria:** the owner plays a full skirmish on staging and can both win and lose; rules have unit tests (80% floor); e2e passes in Chromium and Firefox; CI green. The owner judges whether the side-view sprites read well on the grid (risk 2).

## M2 — Tactical core

Order agreed with the owner on 2026-10-17: M2.2, M2.3, M2.1, M2.4, M2.5, M2.6, M2.7 (line of sight first, since shots passed through trees).

- [x] M2.1 Two actions per turn (move, move again or act); moving far ends the turn ("dash")
- [x] M2.2 Line of sight; half and full cover by direction, with shield icons on hover
- [x] M2.3 Hit chance from aim, cover, distance and flanking, with a breakdown panel
- [x] M2.4 Ammo and reload
- [x] M2.5 Overwatch: shoot the first enemy that moves in sight
- [x] M2.6 Grenades: area damage, removes cover bonus for one turn
- [x] M2.7 Keyboard shortcuts: Tab / Shift+Tab and 1–4 pick marines, F cycles targets, Enter fires, plus R, O, G, E, Esc; the next ready marine is selected automatically. Camera pan and zoom left out: the whole map fits on screen (proposed to the owner 2026-10-17, no objection; to confirm at the M2 review). Revisit if M4 maps grow

**Acceptance criteria:** the owner sees cover and flanking change the hit chance in play; each mechanic has unit tests with fixed seeds; CI green.

## M3 — Aliens and ambush

- [x] M3.1 Fog of war from the squad's sight; hidden tiles darkened, aliens there not drawn
- [x] M3.2 Alien groups dormant until spotted, then scamper to cover (the ambush)
- [x] M3.3 Utility AI: scores tiles for cover, flanking and hit chance (ADR-E4)
- [x] M3.4 Alien types with their own stats and one ability each: walker (melee), flyer (ignores cover from below), lizard (tongue pull), snake (poison)
- [x] M3.5 Hurt, death and hit effects from the pack

**Acceptance criteria:** ambushes happen in play-tests; AI decisions have unit tests on fixed boards; the owner finds the fights fair but threatening.

## M4 — Maps and landscapes

- [x] M4.1 Chunk-based generator with seeded scatter (ADR-E3)
- [x] M4.2 Validators: reachability, spawn distance, cover density; 1,000-seed test
- [x] M4.3 Landscapes: forest, town, coast, rocky hills, crash site, alien ship; missing tiles drawn by Claude to match. *Order (PM review, owner 2026-10-18): alien ship first (the boss needs it), then crash site, coast, rocky hills. None dropped. All built: forest (mission 1), town (2), coast (3), rocky hills (4), crash site (5), alien ship (6). The owner's play of one map per landscape is still to come.*
- [x] M4.4 Map seed shown in the debrief so a map can be replayed for bug reports

**Acceptance criteria:** every landscape passes the 1,000-seed test; the owner plays one map per landscape on staging.

## M5 — Campaign

*Order changed (owner, 2026-10-18): a playable campaign skeleton on forest maps comes before the other landscapes (M4.3), then one landscape per PR. Mission ramp (owner decision): missions 1-2 two groups of 2 aliens, 3-4 three of 2, 5 three of 3, 6 the boss (three of 3 until M5.6). The debrief keeps REPLAY (same map) in the campaign.*

- [ ] M5.1 Campaign of 6 missions, one per landscape; briefing and debrief screens. *Loop, briefing, debrief and mission ramp built; each mission has its own landscape (M4.3).*
- [x] M5.2 XP, ranks and stat increases. *Kills and wins earn XP; five ranks add aim and health; a replayed battle earns no XP (owner, 2026-10-18).*
- [x] M5.3 Fallen marines return next mission; Wall of Shame (nicknames, death counts, debrief jokes). *Starter nicknames and jokes approved by the owner (2026-10-19).*
- [x] M5.4 Squad wiped out: retry the mission on a new map
- [x] M5.5 Autosave every turn; resume from the title screen; versioned save with validation (ADR-E6)
- [x] M5.6 Final mission on the alien ship with the mech boss. *Design approved by merging #46 (`docs/boss-design.md`), with its proposed defaults: the fight ends on the boss's death, 12 health, a 3-damage blast. Built after the alien ship landscape. Rules and AI built (1 of 3); scene built (2 of 3: mech sprite, armour in the odds, red charge squares and warning, blast; `?boss=1` skirmish); mission 6 fields the boss with two escort groups and its own briefing (3 of 3). The owner's play-test will tune its numbers.*
- [x] M5.8 Alien ramp and balance pass (owner lost on mission 3, 2026-10-18): mission 1 walkers only, one new kind per mission, snakes no earlier than mission 4; the briefing names the kinds and warns about the new one; walker aim 80 to 70. *More tuning after the owner's next play-test.*
- [x] M5.9 XP per hit as well as per kill; one tangible perk per promotion (for example a second grenade, more ammo) alongside the aim and health bonuses
- [x] M5.10 Resupply between missions: the owner ran out of grenades mid-mission. *Owner, 2026-10-19: after each won mission, pick one supply for the next mission: +1 grenade, +1 health or +10 aim for every marine.*
- [x] M5.7b Phones, from the owner's iPhone test (2026-10-19: small screen, some taps did nothing): fill the screen on touch devices; the page can't scroll or bounce; refit when Safari's bars change; a second tap just off the previewed tile still confirms
- [x] M5.7c Phones: the info panel beside the map (owner, 2026-10-19), so the map gets the screen's full height (an iPhone in Safari: about 1.33x to 1.53x); menus keep 1x and a shorter layout
- [x] M5.13 Grenades wreck cover (owner, 2026-10-19, a friend's idea): small cover in the blast is blown away, trees are blown down to a trunk (half cover), big props and the map edge stand; scorch marks show where; saved with the battle
- [x] M5.12 Safe start (owner, 2026-10-19: a mission began with marines near aliens): every alien starts out of the squad's sight and at least 8 steps away; tested on 500 maps per mission
- [x] M5.11 Alien turn fast-forward (tap or key) so late missions with nine aliens don't drag
- [x] M5.7 Phones and tablets: touch controls (tap to preview, tap again to act), crisp scaling on high-density screens, landscape notice, fullscreen, ? help button *(owner, 2026-10-18; zoom-and-drag on phones only if play-testing needs it)*

**Acceptance criteria:** the owner plays the campaign from start to finish on staging; closing the browser mid-mission resumes the same turn; save loading rejects corrupt data in tests.

## M6 — Polish and release

- [x] M6.1 Sound effects, made in code with Web Audio (owner, 2026-10-19: the pack has no audio): shots, hits, deaths, grenades, reloads, overwatch, alarms, poison, the boss, win and lose; SND/OFF button and M to mute, remembered between visits (owner, 2026-10-19)
- [ ] M6.2 Squad portraits (owner, 2026-10-19: the pack has none, so drawn in code: a helmet per marine, each told apart); tooltips and first-mission hints *(owner 2026-10-18: the help screen is enough for now, so hints stay here)* *Portraits done: a helmet per marine in the info bar and on the squad page; tooltips and hints wait.*
- [ ] M6.3 Balance pass from play-tests
- [x] M6.4 Portal card image and status `coming-soon`, then `live` *(the card is live with its image; owner, 2026-10-19: ok)*
- [x] M6.5 Static and dynamic security checks; production release with owner approval *(every release runs gitleaks, npm audit, CodeQL and ZAP; owner signed off 2026-10-19)*

**Acceptance criteria:** the definition of success in PROJECT.md section 6 is met on production.

## Engineering (from the PM review, owner 2026-10-18)

- [x] T1 Browser tests that play a whole alien turn get a 60 s limit (the other tests keep 30 s); the machine is shared with other games' test runs
- [x] T2 `scripts/release.sh deploy` refuses unless a dry run passed for the same commit within the last hour
- [x] T3 Battle prompt says TAP, not CLICK, on touch devices

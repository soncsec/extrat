# Game Template — Roadmap

> **Status:** DRAFT. Agree the milestones with the owner. Every milestone ends with something playable on staging.

| Milestone | Status |
|---|---|
| M0 Setup | In progress |
| M1 Walking skeleton | Not started |

## M0 — Setup

- [x] M0.1 Repo created from `soncsec/game-template`, `scripts/init-game.sh` run
- [ ] M0.2 Branch protection on `main` with the four required checks (owner or Claude with `gh`)
- [ ] M0.3 GitHub Pages turned on (Actions mode, `main` only); first staging deploy and ZAP scan pass
- [ ] M0.4 Portal entry `games/game-template.json` (status `in-development`) merged in `soncsec/games-portal`
- [ ] M0.5 PROJECT.md scope agreed and approved by the owner

## M1 — Walking skeleton

- [ ] M1.1 Copy the art this game uses from `legacy/` into `public/assets/`, list it in CREDITS.md
- [ ] M1.2 Player movement and the core action
- [ ] M1.3 One enemy or obstacle
- [ ] M1.4 Playwright: boots clean, core action works through the test hook

**Acceptance criteria:** the owner plays it on staging; CI is green.

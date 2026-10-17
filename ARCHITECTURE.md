# Game Template — Architecture

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
├── config/tuning.ts   every gameplay number
├── logic/             game rules: plain TypeScript, no Phaser imports (ESLint enforces), unit tested
├── scenes/            Phaser scenes: thin, call into logic/
└── debug/testHook.ts  window.__game for Playwright (e2e build only)
tests/
├── unit/              Vitest, 80% coverage floor on src/logic
├── e2e/               Playwright in Chromium and Firefox, incl. the production CSP
└── release/           release scripts against a fake server
scripts/               release.sh, release-remote.sh, smoke_test.py, zap_check.py, check_repo.py
```

## Game decisions

_None yet._

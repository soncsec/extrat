# Game Template — Project

> **Status:** DRAFT. Fill this in with the owner, then get it approved before building gameplay.

## 1. Summary

One or two sentences: what the game is and why it's fun.

## 2. Scope (version 1.0)

| Area | Decision |
|---|---|
| Genre and camera | e.g. side-scrolling platformer |
| Controls | Keyboard: arrows or WASD to move, … |
| Player | health, lives, … |
| Enemies and bosses | … |
| Levels | how many, what makes each different |
| Power-ups | … |
| Scoring | score, high score in localStorage only |
| Art | which folders of the shared art pack (`legacy/`, CC0) |
| Audio | none in v1, or which CC0 sounds (new assets need the owner's approval) |

Out of scope: …

## 3. Constraints (shared by every Soncrant Arcade game)

- Browser only, single player, desktop browsers (current Chrome, Firefox, Safari, Edge).
- No accounts, payments, analytics, cookies or third-party requests. localStorage holds only the high score.
- Art keeps its native pixel style; whole-number scaling only.
- Served at `games.soncrant.com/game-template/` over HTTP (ADR-010), behind the security headers in the portal's Apache config.

## 4. Decisions confirmed by the owner

| Date | Decision |
|---|---|

## 5. Open questions

1. …

# Extrat

A Soncrant Arcade game: Phaser 4, TypeScript and Vite, with the CC0 Ansimuz art pack. It will be playable at `games.soncrant.com/extrat/`.

**Staging:** https://soncsec.github.io/extrat/ (after GitHub Pages is turned on; updated on every merge to `main`).

| Doc | Contents |
|---|---|
| [PROJECT.md](PROJECT.md) | Scope |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Decisions (shared ones live in star-destroyer) |
| [ROADMAP.md](ROADMAP.md) | Milestones and tasks |
| [CLAUDE.md](CLAUDE.md) | Development rules |

## Starting a new game from this template

Follow `NEW-GAME.md` in [soncsec/games-portal](https://github.com/soncsec/games-portal/blob/main/NEW-GAME.md). In short: create the repo from soncsec/game-template, then run `scripts/init-game.sh <slug> "<Title>" <dev-port>`.

## Development

```sh
npm ci
npm run dev          # http://localhost:5175
npm run check        # everything CI runs
```

## Releasing to production

Only with the owner's approval for each release.

```sh
cp deploy/server.env.example deploy/server.env   # once; fill in the real values (git-ignored)
git checkout main && git pull
scripts/release.sh deploy --dry-run   # checks and build only
scripts/release.sh deploy             # upload, switch, smoke test (rolls back on failure)
scripts/release.sh rollback           # back to the previous release
scripts/release.sh activate <id>      # switch to a specific release
scripts/release.sh status             # list releases on the server
```

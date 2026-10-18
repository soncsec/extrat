# CLAUDE.md — Development Rules for Extrat

> From `soncsec/game-template`. The workflow, quality and security rules were approved by the owner on 2026-10-17 for Star Destroyer and apply to every Soncrant Arcade game.

Read `PROJECT.md` (scope), `ARCHITECTURE.md` (decisions), and `ROADMAP.md` (current task) before starting work.

## Roles

- **Owner (GitHub `soncsec`):** approves scope, architecture, merges, and production deployments.
- **Claude:** implements approved tasks, writes tests, runs checks, prepares PRs, and keeps the docs current.

## Scope boundary (other Claude sessions may be building other games)

- Change files only inside this repo. Never edit another game's folder, the portal repo, or shared assets.
- `legacy/` (the art pack) is read-only. It is a link to the shared `~/dev/games/_assets/legacy/`. Copy what you need into `public/assets/`.
- Changes another repo needs (for example, this game's portal card) go through a PR or issue on that repo.
- On the production server, this game may only write to its own release folder and link: `/srv/games-releases/extrat/` and `/var/www/html/soncrant.com/pub/games/extrat` (enforced by `scripts/release-remote.sh`).
- Local dev server port: **5175**. Playwright's test server uses **6176**. Other games use other ports.
- This game's portal card is its own file in the portal repo, `games/extrat.json`. Change it only by PR to `soncsec/games-portal`.

## Always ask the owner before

- Changing the architecture or any ADR, or adding a dependency not listed in ARCHITECTURE.md
- Changing scope (adding or dropping features)
- Destructive operations: deleting files or branches, force-pushing, rewriting history, deleting repos
- Any change on the production server or its Apache configuration, and any production deployment other than the standing release approval below
- Security decisions: CSP and header policy, HTTP vs HTTPS, SSH keys, secrets handling, permissions, CI tokens
- Adding new third-party assets (art, audio, fonts)

## Git workflow

- Never commit or push directly to `main`, and never merge PRs. The owner merges.
- One task per branch, named `feature/<roadmap-id>-<short-name>` (e.g. `feature/M1.5-player-movement`).
- Small PRs, one roadmap task each. The PR description includes:
  - a summary of the change (what and why)
  - test evidence: commands run and results, plus screenshots or GIFs for visual changes
  - the roadmap task ID and its acceptance criteria, each marked met or not met
- Commit messages are short and in the imperative mood.
- Never commit `legacy/`, `node_modules/`, `dist/`, secrets, or `.env` files.

## Quality rules

- A task is **not done** until its acceptance criteria are verified against the running game, not just because code exists.
- Never weaken, skip, or delete a test to make it pass. If a test seems wrong, explain why in the PR and ask.
- Every PR must pass: `npm run check` (format, lint, types, unit tests, release-script tests, build, e2e) and `npm audit --audit-level=high`.
- Game rules go in `src/logic/` as plain TypeScript (no Phaser imports) with unit tests.
- Gameplay numbers go in `src/config/tuning.ts`. No magic numbers in scenes.
- Use the seeded RNG for anything random in gameplay.
- Reuse pooled objects for bullets, enemies and effects.
- Scenes never change game state directly; they send actions to `src/logic/` (ADR-E2).
- Map generator changes must keep the many-seed validator tests passing (ADR-E3).

## Security rules

- No runtime requests to third-party hosts. Everything is bundled and served from our own origin.
- Pin exact dependency versions, at least two weeks old, and commit the lockfile.
- Run static checks (CodeQL, ESLint, `npm audit`, Gitleaks) and a dynamic check (OWASP ZAP baseline) before any deployment or configuration change, and report the results.
- No personal data is collected. localStorage holds only the campaign save and settings (ADR-E6). Validate saves on load; never trust them.
- Never put credentials in code, the chat, or CI logs; use GitHub Actions secrets.

## Environment

- Node.js comes from nvm. Run `export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh` before using `node` or `npm` in a fresh shell.
- The GitHub CLI is at `~/.local/bin/gh`.
- Stop only processes you started, by PID or port, never by name (no `pkill`, `killall` or `pkill -f` patterns). Other sessions on this machine run the same kinds of processes (Vite, Playwright) for other games. For example, find the PID listening on this game's port with `ss -ltnp | grep ':6175 '` and `kill` that PID. (Owner rule, 2026-10-17.)

## Docs

- Shared decisions (ADR-001 to ADR-011: engine, language, build, hosting, testing, security tooling, portal, releases, HTTP, parallel games) live in `soncsec/star-destroyer` ARCHITECTURE.md. Record only this game's own decisions here.

- Update `ROADMAP.md` checkboxes and status as tasks complete.
- Record new or changed decisions as ADRs in `ARCHITECTURE.md`, after approval.
- Update `PROJECT.md` when the owner approves scope changes.

## Assets

- Source pack: `legacy/` (Ansimuz Legacy Collection, CC0). Copy only the files used into `public/assets/` and list them in `CREDITS.md`.
- Keep native pixel resolution. Render with `pixelArt: true` and integer scaling.

## Releasing

**Standing approval (owner, 2026-10-18):** release to games.soncrant.com after each merge to `main`, without asking each time. For each release:

1. Wait for CI on the new `main` commit to pass, including the ZAP scan of staging.
2. Report the security checks: gitleaks, `npm audit`, CodeQL, ZAP.
3. `scripts/release.sh deploy --dry-run`, then `scripts/release.sh deploy` (see README). It refuses unless HEAD is `origin/main`, the tree is clean and CI passed on that commit.
4. Check the game on the live site, and tell the owner what was released (`scripts/release.sh rollback` undoes it).

The standing approval covers this game's releases only: not portal releases, server or Apache changes, or anything else on the server.

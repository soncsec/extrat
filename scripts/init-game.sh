#!/usr/bin/env bash
# Turn a fresh copy of soncsec/game-template into a new game. Run once:
#
#   scripts/init-game.sh <slug> "<Title>" <dev-port>
#   scripts/init-game.sh rocket-race "Rocket Race" 5174
#
# <slug>     URL folder and repo name: lowercase words joined by "-"
#            (served at games.soncrant.com/<slug>/)
# <Title>    the game's name as players see it
# <dev-port> Vite dev server port, unique per game (Star Destroyer 5173,
#            then 5174, 5175, ...). Preview uses port+1000, e2e port+1001.
#
# Replaces the template's name, title and ports everywhere (except lines that
# refer to the template repo itself, soncsec/game-template), then removes
# itself and its own test, which only make sense in the template.
set -euo pipefail

die() {
  echo "init-game: $*" >&2
  exit 1
}

slug="${1:-}"
title="${2:-}"
port="${3:-}"
[[ -n "$slug" && -n "$title" && -n "$port" ]] || { sed -n '2,13p' "$0"; exit 2; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

grep -q '"name": "game-template"' package.json || die "this copy has already been set up"
[[ "$slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "slug must be lowercase words joined by '-'"
((${#slug} <= 40)) || die "slug must be 40 characters or fewer"
case "$slug" in
  assets | images | game-template) die "slug '$slug' is reserved" ;;
esac
[[ ${#title} -ge 1 && ${#title} -le 40 && "$title" != *[\"\\\`\$\|\&\;\<\>/]* ]] ||
  die "title must be 1-40 characters without quotes, slashes or shell symbols"
if ! [[ "$port" =~ ^5[0-9]{3}$ ]] || ((port < 5171 || port > 5899)); then
  die "dev port must be between 5171 and 5899"
fi
((port != 5173)) || die "port 5173 belongs to Star Destroyer"

preview=$((port + 1000))
e2e=$((port + 1001))

# Text files that mention the template's identity (git-tracked, not the lockfile).
mapfile -t files < <(git ls-files | grep -v -e '^package-lock.json$' -e '^scripts/init-game.sh$' -e '^tests/template/')
for f in "${files[@]}"; do
  if [[ ! -f "$f" ]] || ! grep -Iq . "$f"; then continue; fi
  sed -i \
    -e "/soncsec\/game-template/!s/game-template/$slug/g" \
    -e "s/Game Template/$title/g" \
    -e "s/port: 5190, strictPort/port: $port, strictPort/" \
    -e "s/port: 6190, strictPort/port: $preview, strictPort/" \
    -e "s/const PORT = 6191;/const PORT = $e2e;/" \
    -e "s/__DEV_PORT__/$port/g" \
    -e "s/__E2E_PORT__/$e2e/g" \
    "$f"
done
python3 - "$slug" <<'PY'
import json, pathlib, sys
slug = sys.argv[1]
p = pathlib.Path("package-lock.json"); d = json.loads(p.read_text())
d["name"] = slug; d["packages"][""]["name"] = slug
p.write_text(json.dumps(d, indent=2) + "\n")
PY

git rm -q -r --cached scripts/init-game.sh tests/template 2>/dev/null || true
rm -rf scripts/init-game.sh tests/template

echo "Set up '$title' as $slug (dev port $port, preview $preview, e2e $e2e)."
echo "Next: see NEW-GAME.md, step 4 (commit, push, open the first PR)."

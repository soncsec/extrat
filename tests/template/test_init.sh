#!/usr/bin/env bash
# Tests for scripts/init-game.sh, run on a throwaway copy of the template.
# (init-game.sh deletes this folder when a game is set up.)
set -uo pipefail

SRC="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL $1"; }

fresh() { # a clean copy of the committed/staged template in a temp git repo
  local d
  d="$(mktemp -d /tmp/init-test.XXXXXX)"
  (cd "$SRC" && git ls-files -z | xargs -0 tar -cf - 2>/dev/null) | tar -xf - -C "$d"
  (cd "$d" && git init -q -b main && git add -A)
  echo "$d"
}

# --- rejections -------------------------------------------------------------------
D="$(fresh)"
for args in "Bad_Slug|Title|5174" "assets|Title|5174" "game-template|Title|5174" "ok-slug|Title|5173" \
  "ok-slug|Title|80" "ok-slug|Title|5900" 'ok-slug|Evil"Title|5174' "ok-slug|AC/DC|5174" "ok-slug||5174"; do
  IFS='|' read -r s t p <<<"$args"
  if out="$(cd "$D" && bash scripts/init-game.sh "$s" "$t" "$p" 2>&1)"; then bad "accepted '$args': $out"; else ok "rejects $args"; fi
done
if grep -q '"name": "game-template"' "$D/package.json"; then ok "a rejected run changes nothing"; else bad "package.json changed"; fi
rm -rf "$D"

# --- a real setup -------------------------------------------------------------------
D="$(fresh)"
if out="$(cd "$D" && bash scripts/init-game.sh rocket-race "Rocket Race" 5174 2>&1)"; then
  ok "sets up rocket-race"
else
  bad "setup failed: $out"
fi
left="$( (cd "$D" && grep -rIn -e game-template -e "Game Template" --exclude-dir=.git .) | grep -v "soncsec/game-template" || true)"
if [[ -z "$left" ]]; then ok "no template name or title left anywhere"; else bad "still mentions the template: $left"; fi
if grep -q '"name": "rocket-race"' "$D/package.json" && grep -q '"name": "rocket-race"' "$D/package-lock.json"; then ok "package and lockfile renamed"; else bad "package name"; fi
if grep -q "port: 5174, strictPort" "$D/vite.config.ts" && grep -q "port: 6174, strictPort" "$D/vite.config.ts" &&
  grep -q "const PORT = 6175;" "$D/playwright.config.ts"; then ok "ports set: dev 5174, preview 6174, e2e 6175"; else bad "ports not set"; fi
if grep -q "^SLUG=rocket-race$" "$D/scripts/release.sh" && grep -q '^TITLE="Rocket Race"$' "$D/scripts/release.sh"; then ok "release script targets rocket-race"; else bad "release.sh not updated"; fi
if grep -q "<title>Rocket Race</title>" "$D/index.html"; then ok "page title set"; else bad "index.html title"; fi
if [[ ! -e "$D/scripts/init-game.sh" && ! -e "$D/tests/template" ]]; then ok "setup removes itself and its test"; else bad "template machinery left behind"; fi
if grep -q "soncsec/game-template" "$D/CLAUDE.md"; then ok "links to the template repo are kept"; else bad "template repo link was renamed"; fi
if (cd "$D" && bash -n scripts/release.sh && bash -n scripts/release-remote.sh); then ok "scripts still parse"; else bad "scripts broken"; fi
# The set-up game's own release tests must pass (they check its name, repo and package.json).
if out="$(cd "$D" && bash tests/release/test_release_flow.sh 2>&1)"; then
  ok "the new game's release tests pass"
else
  bad "release tests fail in the new game: $(grep FAIL <<<"$out" | head -3)"
fi
rm -rf "$D"

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

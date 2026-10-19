#!/usr/bin/env bash
# End-to-end test of scripts/release.sh against a fake server. A temporary
# folder stands in for the server, and stand-ins for ssh, rsync, gh and npm run
# everything locally. No network access, nothing leaves this machine.
# Run: bash tests/release/test_release_flow.sh
set -uo pipefail

SRC="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d /tmp/release-flow.XXXXXX)"
PASS=0
FAIL=0
SERVER_PID=""
cleanup() { [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

ok() { PASS=$((PASS + 1)); echo "ok   $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL $1"; }

# --- fake server: release folders + a web server for the smoke test ----------------
mkdir -p "$T/server/web" "$T/server/releases" "$T/bin"
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$T/server/web" >/dev/null 2>&1 &
SERVER_PID=$!

# --- stand-ins ---------------------------------------------------------------------
cat >"$T/bin/ssh" <<SH
#!/usr/bin/env bash
# Skip options and the host; run the remote command locally against the fake server.
while [[ \$# -gt 0 && "\$1" != bash ]]; do shift; done
RELEASE_TEST_ROOT="$T/server" exec "\$@"
SH
cat >"$T/bin/rsync" <<'SH'
#!/usr/bin/env bash
# Copy src/ to the local path after "host:" (the fake server shares this disk).
src="${@: -2:1}"; dest="${@: -1}"; dest="${dest##*:}"
cp -a "$src." "$dest"
SH
cat >"$T/bin/gh" <<'SH'
#!/usr/bin/env bash
c="${FAKE_CI:-success}"
printf 'Repo checks\tcompleted\t%s\nBuild and test\tcompleted\tsuccess\nCodeQL analysis\tcompleted\tsuccess\nZAP baseline scan\tcompleted\tsuccess\n' "$c"
SH
cat >"$T/bin/npm" <<'SH'
#!/usr/bin/env bash
# "npm run check" builds a tiny site; FAKE_BROKEN=1 builds one missing its script.
if [[ "$*" == "run check" ]]; then
  rm -rf dist && mkdir -p dist/assets
  printf '<!doctype html><title>Extrat</title><script type="module" src="./assets/index-AbCd1234.js"></script>\n' >dist/index.html
  [[ "${FAKE_BROKEN:-}" == 1 ]] || echo "// game" >dist/assets/index-AbCd1234.js
fi
SH
chmod +x "$T/bin/"*

# --- a throwaway repo whose HEAD is origin/main ---------------------------------------
# The fake GitHub remote is named after this game (init-game.sh renames GAME_REPO).
GAME_REPO=extrat
mkdir -p "$T/remote/soncsec" && git init -q --bare "$T/remote/soncsec/$GAME_REPO.git"
mkdir "$T/repo" && cd "$T/repo" || exit 1
git init -q -b main
# CI runners have no git identity; give this throwaway repo its own.
git config user.name test && git config user.email test@example.invalid
mkdir -p scripts deploy
cp "$SRC/scripts/release.sh" "$SRC/scripts/release-remote.sh" "$SRC/scripts/smoke_test.py" scripts/
printf 'dist/\ndeploy/server.env\ndeploy/dry-run.*\n' >.gitignore
printf '{"name": "extrat"}\n' >package.json
git add -A && git commit -q -m init
git remote add origin "$T/remote/soncsec/$GAME_REPO.git" && git push -q origin main
touch "$T/fake_key"
printf 'SERVER=127.0.0.1:%s\nSSH_USER=deploy\nSSH_KEY=%s\n' "$PORT" "$T/fake_key" >deploy/server.env

release() { PATH="$T/bin:$PATH" bash scripts/release.sh "$@" 2>&1; }
live() { basename "$(readlink "$T/server/web/extrat" 2>/dev/null)" 2>/dev/null; }
count() { find "$T/server/releases/extrat" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l; }

# --- the tests -------------------------------------------------------------------
# T1.3: a game can only release into its own slot.
with_change() { # file, sed expression, command... : run with a temporary edit, then undo it
  local file="$1" expr="$2"; shift 2
  sed -i "$expr" "$file"
  git diff --quiet && { echo "with_change: '$expr' changed nothing in $file"; return 99; }
  if ! git commit -qam tmp; then git checkout -q -- "$file"; echo "with_change: commit failed"; return 98; fi
  "$@"; local rc=$?
  git reset -q --hard HEAD~1
  return $rc
}
out="$(with_change scripts/release.sh 's/^SLUG=.*/SLUG=other-game/' release deploy)"
if [[ "$out" == *"refusing to release into another game's slot"* && "$(count)" == 0 && ! -e "$T/server/web/other-game" ]]; then
  ok "refuses another game's slug (package.json mismatch) and touches nothing"
else bad "other slug: $out"; fi
out="$(with_change scripts/release.sh 's/^SLUG=.*/SLUG=_portal/' release rollback)"
if [[ "$out" == *"reserved for the portal"* ]]; then ok "refuses the portal's slot"; else bad "_portal slug: $out"; fi
out="$(with_change package.json 's/extrat/other-game/' release status)"
if [[ "$out" == *"package.json says 'other-game'"* ]]; then ok "refuses when package.json names another game"; else bad "pkg mismatch: $out"; fi
git remote set-url origin "$T/remote/soncsec/other-game.git"
out="$(release activate 20990101T000000Z-deadbeef)"
if [[ "$out" == *"this repo's origin is"* ]]; then ok "refuses when the repo is another game's"; else bad "origin mismatch: $out"; fi
git remote set-url origin "$T/remote/soncsec/$GAME_REPO.git"

out="$(FAKE_CI=failure release deploy)"
if [[ $? -ne 0 && "$out" == *"has not passed"* && "$(count)" == 0 ]]; then ok "refuses to release when CI failed"; else bad "CI gate: $out"; fi

echo dirty >untracked.txt
out="$(release deploy)"
if [[ $? -ne 0 && "$out" == *"working tree has changes"* ]]; then ok "refuses uncommitted changes"; else bad "dirty tree: $out"; fi
rm untracked.txt

rm -f deploy/dry-run.extrat
out="$(release deploy)"
if [[ $? -ne 0 && "$out" == *"no dry run recorded"* && "$(count)" == 0 ]]; then ok "refuses to deploy without a dry run"; else bad "no dry run: $out"; fi

out="$(release deploy --dry-run)"
if [[ $? -eq 0 && "$out" == *"Dry run passed"* && "$(count)" == 0 && "$(cat deploy/dry-run.extrat)" == "$(git rev-parse HEAD)" ]]; then ok "dry run uploads nothing and records its commit"; else bad "dry run: $out"; fi

touch -d '2 hours ago' deploy/dry-run.extrat
out="$(release deploy)"
if [[ $? -ne 0 && "$out" == *"minutes old"* && "$(count)" == 0 ]]; then ok "refuses to deploy on a dry run older than an hour"; else bad "stale dry run: $out"; fi

echo 0000000000000000000000000000000000000000 >deploy/dry-run.extrat
out="$(release deploy)"
if [[ $? -ne 0 && "$out" == *"another commit"* && "$(count)" == 0 ]]; then ok "refuses to deploy on a dry run of another commit"; else bad "other commit: $out"; fi

release deploy --dry-run >/dev/null
out="$(release deploy)"; first="$(live)"
if [[ $? -eq 0 && -n "$first" && "$out" == *"smoke test: passed"* ]]; then ok "first release goes live and passes the smoke test"; else bad "first release: $out"; fi

sleep 1 # release ids have one-second resolution
out="$(release deploy)"; second="$(live)"
if [[ $? -eq 0 && "$second" != "$first" && "$(count)" == 2 ]]; then ok "second release replaces the first"; else bad "second release: $out"; fi
a="$T/server/releases/extrat/$first/assets/index-AbCd1234.js"
b="$T/server/releases/extrat/$second/assets/index-AbCd1234.js"
if [[ -f "$a" && -f "$b" ]]; then ok "both releases keep their files"; else bad "release files missing"; fi

sleep 1
out="$(FAKE_BROKEN=1 release deploy)"
if [[ $? -ne 0 && "$out" == *"rolling back"* && "$(live)" == "$second" ]]; then ok "a broken release fails the smoke test and is rolled back automatically"; else bad "broken release: $out (live=$(live))"; fi

out="$(release rollback)"
if [[ $? -eq 0 && "$(live)" == "$first" ]]; then ok "rollback command returns to the earlier release"; else bad "rollback: $out"; fi

out="$(release activate "$second")"
if [[ $? -eq 0 && "$(live)" == "$second" && "$out" == *"smoke test: passed"* ]]; then ok "activate switches forward to a chosen release"; else bad "activate: $out"; fi
out="$(release activate 20990101T000000Z-deadbeef)"
if [[ $? -ne 0 && "$out" == *"no such release"* && "$(live)" == "$second" ]]; then ok "activate refuses an unknown release and changes nothing"; else bad "activate unknown: $out"; fi
release rollback >/dev/null

out="$(release status)"
if [[ "$out" == *"* $first (live)"* ]]; then ok "status shows the live release"; else bad "status: $out"; fi

for _ in 1 2 3 4 5; do sleep 1; release deploy >/dev/null; done
if [[ "$(count)" -eq 5 && -d "$T/server/releases/extrat/$(live)" ]]; then ok "old releases are pruned to the newest 5, including the live one"; else bad "count is $(count)"; fi

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

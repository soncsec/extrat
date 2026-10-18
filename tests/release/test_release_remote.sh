#!/usr/bin/env bash
# Tests for scripts/release-remote.sh, run against a temporary folder that
# stands in for the server (RELEASE_TEST_ROOT). Run: bash tests/release/test_release_remote.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/release-remote.sh"
PASS=0
FAIL=0
T=""

setup() {
  T="$(mktemp -d /tmp/release-test.XXXXXX)"
  mkdir -p "$T/web" "$T/releases"
}
teardown() { rm -rf "$T"; }

run() { RELEASE_TEST_ROOT="$T" bash "$SCRIPT" "$@"; }

ok() { PASS=$((PASS + 1)); echo "ok   $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL $1"; }
expect_ok() { # name, command...
  local name="$1"; shift
  if out="$("$@" 2>&1)"; then ok "$name"; else bad "$name: $out"; fi
}
expect_fail() { # name, pattern, command...
  local name="$1" pattern="$2"; shift 2
  if out="$("$@" 2>&1)"; then bad "$name: expected failure, got: $out"
  elif grep -q -- "$pattern" <<<"$out"; then ok "$name"
  else bad "$name: wrong error: $out"; fi
}

# A release with an index.html, the way release.sh uploads one.
make_release() { # id
  run prepare extrat "$1" >/dev/null && echo "<title>$1</title>" >"$T/releases/extrat/$1/index.html"
}
live() { basename "$(readlink "$T/web/extrat")"; }

A=20261017T100000Z-aaaaaaa1
B=20261017T110000Z-bbbbbbb2
C=20261017T120000Z-ccccccc3
D=20261017T130000Z-ddddddd4

# --- input checks -----------------------------------------------------------
setup
expect_fail "rejects a slug with ../" "invalid slug" run status "../etc"
expect_fail "rejects an uppercase slug" "invalid slug" run status "Star"
expect_fail "rejects an empty slug" "invalid slug" run status ""
expect_fail "rejects a bad release id" "invalid release id" run prepare extrat "latest"
expect_fail "rejects an id with a path" "invalid release id" run prepare extrat "../$A"
expect_fail "rejects an unknown op" "unknown op" run explode extrat
expect_fail "test root must be under /tmp" "under /tmp" env RELEASE_TEST_ROOT=/var/tmp bash "$SCRIPT" status extrat
expect_ok "accepts the portal slug" run status _portal
teardown

# --- first release ----------------------------------------------------------
setup
expect_ok "status with no releases" run status extrat
out="$(run prepare extrat "$A")"
if [[ "$out" == *"upload_to=$T/releases/extrat/$A"* && "$out" == *"live_dir="* ]]; then ok "prepare returns the upload folder and no live folder"; else bad "prepare output: $out"; fi
expect_fail "prepare refuses an existing id" "already exists" run prepare extrat "$A"
expect_fail "activate refuses a release without index.html" "no index.html" run activate extrat "$A"
echo "<title>A</title>" >"$T/releases/extrat/$A/index.html"
expect_ok "activate the first release" run activate extrat "$A"
if [[ "$(live)" == "$A" && -f "$T/web/extrat/index.html" ]]; then ok "the live link serves release A"; else bad "live is $(live)"; fi
expect_fail "activate refuses an unknown id" "no such release" run activate extrat "$B"
expect_fail "rollback with only one release" "no release older" run rollback extrat
teardown

# --- switching and rollback ---------------------------------------------------
setup
make_release "$A" && run activate extrat "$A" >/dev/null
out="$(run prepare extrat "$B")"
if [[ "$out" == *"live_dir=$T/releases/extrat/$A"* ]]; then ok "prepare reports the live folder for --link-dest"; else bad "$out"; fi
echo "<title>B</title>" >"$T/releases/extrat/$B/index.html"
run activate extrat "$B" >/dev/null
if [[ "$(live)" == "$B" ]]; then ok "switch to release B"; else bad "live is $(live)"; fi
expect_ok "rollback" run rollback extrat
if [[ "$(live)" == "$A" ]]; then ok "rollback returns to release A"; else bad "live is $(live)"; fi
# Capture first: with pipefail, `| grep -q` can fail when grep exits before status finishes
# writing (status then gets SIGPIPE), even though the line matched.
status_out="$(run status extrat)"
if grep -q "^\* $A (live)" <<<"$status_out"; then ok "status marks the live release"; else bad "status: $status_out"; fi
if compgen -G "$T/web/.*switch*" >/dev/null; then bad "leftover temporary link"; else ok "no temporary links left behind"; fi
teardown

# --- refusals that protect the server ---------------------------------------------
setup
make_release "$A"
mkdir -p "$T/web/extrat" && echo keep >"$T/web/extrat/precious.txt"
expect_fail "refuses to replace a real folder" "not a symlink" run activate extrat "$A"
if [[ -f "$T/web/extrat/precious.txt" ]]; then ok "the real folder is untouched"; else bad "real folder was changed"; fi
rm -rf "$T/web/extrat" && ln -s /etc "$T/web/extrat"
expect_fail "refuses a link pointing outside the releases folder" "points outside" run activate extrat "$A"
teardown

# --- pruning ------------------------------------------------------------------
setup
for id in "$A" "$B" "$C" "$D"; do make_release "$id"; done
run activate extrat "$A" >/dev/null # the oldest is live
expect_ok "prune keeps 2" run prune extrat 2
left="$(find "$T/releases/extrat" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort | tr '\n' ' ')"
if [[ "$left" == "$A $C $D " ]]; then ok "prune kept the 2 newest plus the live one"; else bad "left: $left"; fi
expect_fail "prune needs a positive number" "positive number" run prune extrat 0
teardown

# --- atomic switch: the live link never disappears --------------------------------
setup
make_release "$A" && make_release "$B"
run activate extrat "$A" >/dev/null
missing="$T/missing"
( for _ in $(seq 1 4000); do [[ -f "$T/web/extrat/index.html" ]] || echo x >>"$missing"; done ) &
reader=$!
for i in $(seq 1 100); do run activate extrat "$([[ $((i % 2)) == 0 ]] && echo "$A" || echo "$B")" >/dev/null; done
wait "$reader"
if [[ ! -s "$missing" ]]; then ok "index.html stayed reachable through 100 switches"; else bad "missing $(wc -l <"$missing") times"; fi
teardown

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

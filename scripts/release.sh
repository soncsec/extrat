#!/usr/bin/env bash
# Release Extrat to production (ADR-009). Run by the owner, or by
# Claude only with the owner's approval for that release.
#
#   scripts/release.sh deploy --dry-run     check and build only; records that it passed
#   scripts/release.sh deploy               the same, then upload, switch, smoke test
#                                           (refuses without a dry run of this commit
#                                           in the last hour)
#   scripts/release.sh rollback             switch back to the previous release
#   scripts/release.sh activate <id>        switch to a specific release (e.g. forward after a rollback)
#   scripts/release.sh status               list releases on the server
#
# Settings come from deploy/server.env (git-ignored; see deploy/server.env.example).
set -euo pipefail

SLUG=extrat
SITE_HOST=games.soncrant.com
TITLE="Extrat"
KEEP=5
REQUIRED_CHECKS=("Repo checks" "Build and test" "CodeQL analysis" "ZAP baseline scan")
# A passed dry run leaves its commit here (git-ignored); a deploy needs one this recent.
DRY_RUN_MARKER="deploy/dry-run.$SLUG"
DRY_RUN_MAX_AGE_MINUTES=60

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

die() {
  echo "release: $*" >&2
  exit 1
}
step() { printf '\n== %s\n' "$*"; }

# Read KEY=value lines without executing the file.
load_env() {
  local file="deploy/server.env" key value
  [[ -f "$file" ]] || die "$file is missing (copy deploy/server.env.example)"
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Z_]+$ ]] || continue
    value="${value%%#*}"
    value="${value%"${value##*[![:space:]]}"}"
    case "$key" in
      SERVER) SERVER="$value" ;;
      SSH_USER) SSH_USER="$value" ;;
      SSH_KEY) SSH_KEY="${value/#\~/$HOME}" ;;
    esac
  done <"$file"
  [[ -n "${SERVER:-}" && -n "${SSH_USER:-}" && -n "${SSH_KEY:-}" ]] ||
    die "$file must set SERVER, SSH_USER and SSH_KEY"
  [[ -f "$SSH_KEY" ]] || die "SSH key not found: $SSH_KEY"
  [[ "$SSH_KEY" != *[[:space:]]* ]] || die "SSH_KEY path must not contain spaces"
  SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10)
}

SSH_OPTS=()

# Runs scripts/release-remote.sh on the server with the given op and arguments.
remote() {
  ssh "${SSH_OPTS[@]}" "$SSH_USER@$SERVER" bash -s -- "$@" <scripts/release-remote.sh
}

smoke() {
  python3 scripts/smoke_test.py "http://$SERVER/$SLUG/" --host "$SITE_HOST" --title "$TITLE" "$@"
}

# This game may only ever release into its own slot on the server (T1.3):
# SLUG must be this repo's name and its package.json name, and never a name
# the portal uses. A copied script with another game's SLUG stops here.
check_identity() {
  case "$SLUG" in
    _portal | assets | images) die "SLUG '$SLUG' is reserved for the portal" ;;
  esac
  [[ "$SLUG" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "SLUG '$SLUG' is not a valid game slug"
  local pkg origin
  pkg="$(python3 -c 'import json; print(json.load(open("package.json"))["name"])')"
  [[ "$pkg" == "$SLUG" ]] || die "SLUG is '$SLUG' but package.json says '$pkg'; refusing to release into another game's slot"
  origin="$(git remote get-url origin)"
  [[ "$origin" =~ [:/]soncsec/${SLUG}(\.git)?$ ]] ||
    die "SLUG is '$SLUG' but this repo's origin is $origin; refusing to release into another game's slot"
}

preflight() {
  step "Preflight"
  check_identity
  [[ -z "$(git status --porcelain)" ]] || die "working tree has changes; release only committed code"
  git fetch -q origin main
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] ||
    die "HEAD is not origin/main; check out and pull main first"
  local sha
  sha="$(git rev-parse HEAD)"
  echo "commit $sha"

  # Static checks (CodeQL, gitleaks, audit, tests) and the dynamic ZAP scan of
  # staging all ran in CI on this exact commit; require every one to have passed.
  local runs
  runs="$(gh api "repos/soncsec/$SLUG/commits/$sha/check-runs" \
    --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion)"')"
  local name
  for name in "${REQUIRED_CHECKS[@]}"; do
    grep -qP "^\Q$name\E\tcompleted\tsuccess$" <<<"$runs" ||
      die "CI check '$name' has not passed on $sha"
    echo "ok   CI: $name"
  done
  if grep -P "\tcompleted\t(failure|cancelled|timed_out|action_required)$" <<<"$runs"; then
    die "a CI check failed on $sha"
  fi
}

build() {
  step "Install, check and build"
  npm ci --silent
  npm audit --audit-level=high
  npm run check
  if grep -rq __game dist; then die "test hook found in dist/"; fi
}

# A real deploy needs a dry run of this exact commit, passed within the last hour, so
# a failed dry run can't be skipped or chained past (owner review, 2026-10-18).
require_dry_run() {
  local sha
  sha="$(git rev-parse HEAD)"
  [[ -f "$DRY_RUN_MARKER" ]] ||
    die "no dry run recorded; run 'scripts/release.sh deploy --dry-run' first"
  [[ "$(cat "$DRY_RUN_MARKER")" == "$sha" ]] ||
    die "the last dry run was of another commit; run 'scripts/release.sh deploy --dry-run' on $sha"
  local age
  age=$(( ($(date +%s) - $(stat -c %Y "$DRY_RUN_MARKER")) / 60 ))
  [[ "$age" -le "$DRY_RUN_MAX_AGE_MINUTES" ]] ||
    die "the last dry run is $age minutes old (limit $DRY_RUN_MAX_AGE_MINUTES); run it again"
  echo "ok   dry run of $sha passed $age minutes ago"
}

cmd_deploy() {
  local dry_run=false
  [[ "${1:-}" == "--dry-run" ]] && dry_run=true
  load_env
  preflight
  $dry_run || require_dry_run
  build

  local id
  id="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short=8 HEAD)"
  printf '{"id":"%s","commit":"%s"}\n' "$id" "$(git rev-parse HEAD)" >dist/release.json
  echo "release id: $id"

  if $dry_run; then
    git rev-parse HEAD >"$DRY_RUN_MARKER"
    step "Dry run passed and recorded: nothing uploaded. Current server state:"
    remote status "$SLUG"
    return
  fi

  step "Upload"
  local plan upload_to live_dir
  plan="$(remote prepare "$SLUG" "$id")"
  upload_to="$(sed -n 's/^upload_to=//p' <<<"$plan")"
  live_dir="$(sed -n 's/^live_dir=//p' <<<"$plan")"
  [[ -n "$upload_to" ]] || die "server did not return an upload folder"
  # --link-dest shares unchanged files with the live release (hard links), so
  # each release only stores what changed.
  rsync -a --delete --chmod=D2755,F644 ${live_dir:+--link-dest="$live_dir"} \
    -e "ssh ${SSH_OPTS[*]}" dist/ "$SSH_USER@$SERVER:$upload_to/"

  step "Switch"
  remote activate "$SLUG" "$id"

  step "Smoke test"
  if ! smoke --release-id "$id"; then
    if [[ -n "$live_dir" ]]; then
      echo "Smoke test failed: rolling back to $(basename "$live_dir")"
      remote rollback "$SLUG"
    else
      echo "Smoke test failed and there is no earlier release to roll back to."
    fi
    die "release $id failed its smoke test"
  fi

  step "Tidy up (keep $KEEP releases)"
  remote prune "$SLUG" "$KEEP"
  echo
  echo "Released $id: http://$SITE_HOST/$SLUG/"
}

cmd_rollback() {
  check_identity
  load_env
  remote rollback "$SLUG"
  smoke
}

cmd_activate() {
  local id="${1:-}"
  [[ -n "$id" ]] || die "usage: release.sh activate <release id> (see: release.sh status)"
  check_identity
  load_env
  remote activate "$SLUG" "$id"
  smoke --release-id "$id"
}

cmd_status() {
  check_identity
  load_env
  remote status "$SLUG"
}

case "${1:-}" in
  deploy) shift && cmd_deploy "$@" ;;
  rollback) cmd_rollback ;;
  activate) shift && cmd_activate "$@" ;;
  status) cmd_status ;;
  *)
    sed -n '2,10p' "$0"
    exit 2
    ;;
esac

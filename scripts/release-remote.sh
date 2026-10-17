#!/usr/bin/env bash
# Server side of a release (ADR-009). Runs on the production server as the
# `deploy` user, sent over SSH by scripts/release.sh:
#
#   ssh deploy@server bash -s -- <op> <slug> [args] < scripts/release-remote.sh
#
# Layout:
#   $RELEASES/<slug>/<id>/   one folder per release (not web-served)
#   $WEB_ROOT/<slug>         symlink to the live release
#
# Ops:
#   prepare  <slug> <id>   print the folder to upload into (and the live one, for rsync --link-dest)
#   activate <slug> <id>   point the live symlink at release <id> (atomic)
#   rollback <slug>        point it at the release before the live one
#   status   <slug>        list releases, marking the live one
#   prune    <slug> <keep> delete all but the newest <keep> releases (never the live one)
#
# Safety: only the production paths below are accepted. Tests set
# RELEASE_TEST_ROOT to a temporary folder, which replaces both paths.
set -euo pipefail

PROD_WEB_ROOT=/var/www/html/soncrant.com/pub/games
PROD_RELEASES=/srv/games-releases

die() {
  echo "release-remote: $*" >&2
  exit 1
}

if [[ -n "${RELEASE_TEST_ROOT:-}" ]]; then
  [[ "$RELEASE_TEST_ROOT" == /tmp/* && -d "$RELEASE_TEST_ROOT" ]] ||
    die "RELEASE_TEST_ROOT must be an existing folder under /tmp"
  WEB_ROOT="$RELEASE_TEST_ROOT/web"
  RELEASES="$RELEASE_TEST_ROOT/releases"
else
  WEB_ROOT="$PROD_WEB_ROOT"
  RELEASES="$PROD_RELEASES"
fi

op="${1:-}"
slug="${2:-}"
# Lowercase words joined by "-" (the portal's slug rule), or the portal itself.
[[ "$slug" =~ ^([a-z0-9]+(-[a-z0-9]+)*|_portal)$ ]] || die "invalid slug: '$slug'"

dir="$RELEASES/$slug"
link="$WEB_ROOT/$slug"

valid_id() {
  # 20261017T120000Z-0123abcd: UTC time, then the short commit hash.
  [[ "$1" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$ ]] || die "invalid release id: '$1'"
}

# The release folder the live symlink points at, or nothing.
live_id() {
  if [[ -L "$link" ]]; then
    local target
    target="$(readlink "$link")"
    [[ "$target" == "$dir/"* ]] || die "$link points outside $dir: $target"
    basename "$target"
  elif [[ -e "$link" ]]; then
    die "$link exists and is not a symlink; refusing to touch it"
  fi
}

# Release ids, oldest first. Ids start with a UTC timestamp, so name order is time order.
list_ids() {
  [[ -d "$dir" ]] || return 0
  find "$dir" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
    grep -E '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$' | sort || true
}

switch_to() {
  local id="$1" tmp
  [[ -d "$dir/$id" ]] || die "no such release: $id"
  [[ -f "$dir/$id/index.html" ]] || die "release $id has no index.html; refusing to make it live"
  live_id >/dev/null # refuses if $link is a real folder
  tmp="$WEB_ROOT/.$slug.switch.$$"
  ln -sfn "$dir/$id" "$tmp"
  mv -T "$tmp" "$link" # rename() is atomic: visitors see the old or the new release, never neither
  echo "live: $slug -> $id"
}

case "$op" in
  prepare)
    id="${3:-}"
    valid_id "$id"
    [[ ! -e "$dir/$id" ]] || die "release $id already exists"
    current="$(live_id)"
    mkdir -p "$dir/$id"
    echo "upload_to=$dir/$id"
    if [[ -n "$current" ]]; then echo "live_dir=$dir/$current"; else echo "live_dir="; fi
    ;;
  activate)
    id="${3:-}"
    valid_id "$id"
    switch_to "$id"
    ;;
  rollback)
    current="$(live_id)"
    [[ -n "$current" ]] || die "$slug has no live release to roll back from"
    previous="$(list_ids | grep -B1 -Fx "$current" | head -n -1 | tail -n 1)"
    [[ -n "$previous" ]] || die "no release older than $current to roll back to"
    switch_to "$previous"
    ;;
  status)
    current="$(live_id)"
    ids="$(list_ids)"
    [[ -n "$ids" ]] || echo "(no releases)"
    while read -r id; do
      [[ -z "$id" ]] && continue
      if [[ "$id" == "$current" ]]; then echo "* $id (live)"; else echo "  $id"; fi
    done <<<"$ids"
    ;;
  prune)
    keep="${3:-}"
    [[ "$keep" =~ ^[1-9][0-9]*$ ]] || die "keep must be a positive number"
    current="$(live_id)"
    mapfile -t ids < <(list_ids)
    remove=$((${#ids[@]} - keep))
    for ((i = 0; i < remove; i++)); do
      id="${ids[$i]}"
      [[ "$id" == "$current" ]] && continue
      rm -rf -- "${dir:?}/$id"
      echo "pruned: $id"
    done
    ;;
  *)
    die "unknown op '$op' (prepare | activate | rollback | status | prune)"
    ;;
esac

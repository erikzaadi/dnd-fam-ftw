#!/usr/bin/env bash
# Server-side backend release management. Runs ON the instance, piped over SSH:
#
#   ssh "$SSH_USER@$LIGHTSAIL_HOST" "bash -s -- <command> [args]" < scripts/deploy/remote-release.sh
#
# Layout:
#   /opt/dnd-fam-ftw/releases/<release-id>/   immutable backend releases (dist, public, node_modules)
#   /opt/dnd-fam-ftw/current -> releases/<id>  symlink the systemd unit runs from
#
# Commands:
#   prepare <id>         create the release dir; prints the currently active release path (may be empty)
#   activate <id>        atomically point current at the release and restart the service
#   verify <version>     poll local /health until it reports <version>; non-zero exit if it never does
#   rollback [<id>]      re-activate <id>, or the release that was active before the current one
#   list                 list releases, marking the active one
#   prune                keep the newest KEEP_RELEASES releases (never removes the active or previous one)
#
# The database lives outside the release directories; rollbacks never touch it.
# Schema migrations are additive, so an older release keeps working on a newer schema.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dnd-fam-ftw}"
RELEASES_DIR="$APP_DIR/releases"
CURRENT="$APP_DIR/current"
SERVICE_NAME="${SERVICE_NAME:-dnd-fam-ftw}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3001/health}"

log() {
  echo "[release] $*" >&2
}

fail() {
  log "ERROR: $*"
  exit 1
}

valid_id() {
  [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]] || fail "invalid release id: $1"
}

# One-time migration from the old layout, where current/ was a plain directory.
migrate_layout() {
  mkdir -p "$RELEASES_DIR"
  if [[ -d "$CURRENT" && ! -L "$CURRENT" ]]; then
    local legacy
    legacy="$RELEASES_DIR/legacy-$(date -u +%Y%m%dT%H%M%SZ)"
    log "Migrating plain $CURRENT directory to $legacy"
    mv "$CURRENT" "$legacy"
    ln -sfn "$legacy" "$CURRENT"
  fi
}

active_release() {
  readlink -f "$CURRENT" 2>/dev/null || true
}

# Release directories, newest first.
releases_newest_first() {
  # shellcheck disable=SC2012  # release ids are [A-Za-z0-9._-] only
  ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | sed 's:/*$::' || true
}

switch_to() {
  local target="$1"
  [[ -f "$target/dist/index.js" ]] || fail "release $target has no dist/index.js"
  ln -sfn "$target" "$APP_DIR/current.next"
  mv -Tf "$APP_DIR/current.next" "$CURRENT"
  sudo systemctl restart "$SERVICE_NAME"
  log "Active release: $target"
}

cmd="${1:-}"
shift || true

case "$cmd" in
  prepare)
    id="${1:-}"
    valid_id "$id"
    migrate_layout
    mkdir -p "$RELEASES_DIR/$id"
    active_release
    ;;
  activate)
    id="${1:-}"
    valid_id "$id"
    target="$RELEASES_DIR/$id"
    previous="$(active_release)"
    if [[ -n "$previous" && "$previous" != "$target" ]]; then
      echo "$previous" > "$target/.previous-release"
    fi
    switch_to "$target"
    ;;
  verify)
    expected="${1:-}"
    [[ -n "$expected" ]] || fail "verify needs the expected version"
    for attempt in $(seq 1 20); do
      if systemctl is-active --quiet "$SERVICE_NAME"; then
        actual="$(curl -s --max-time 5 "$HEALTH_URL" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)"
        if [[ "$actual" == "$expected" ]]; then
          log "Health OK, version $actual"
          exit 0
        fi
        log "attempt $attempt/20: version '${actual:-none}', expected '$expected'"
      else
        log "attempt $attempt/20: service not active yet"
      fi
      sleep 3
    done
    fail "backend never reported version $expected"
    ;;
  rollback)
    id="${1:-}"
    if [[ -n "$id" ]]; then
      valid_id "$id"
      target="$RELEASES_DIR/$id"
    else
      active="$(active_release)"
      [[ -f "$active/.previous-release" ]] || fail "active release has no recorded previous release; pass a release id (see: list)"
      target="$(cat "$active/.previous-release")"
    fi
    [[ -d "$target" ]] || fail "release not found: $target"
    switch_to "$target"
    ;;
  list)
    active="$(active_release)"
    mapfile -t dirs < <(releases_newest_first)
    for dir in "${dirs[@]}"; do
      if [[ "$dir" == "$active" ]]; then
        echo "* $(basename "$dir")"
      else
        echo "  $(basename "$dir")"
      fi
    done
    ;;
  prune)
    active="$(active_release)"
    previous=""
    if [[ -f "$active/.previous-release" ]]; then
      previous="$(cat "$active/.previous-release")"
    fi
    count=0
    mapfile -t dirs < <(releases_newest_first)
    for dir in "${dirs[@]}"; do
      count=$((count + 1))
      if [[ $count -le $KEEP_RELEASES || "$dir" == "$active" || "$dir" == "$previous" ]]; then
        continue
      fi
      log "Removing old release $(basename "$dir")"
      rm -rf "$dir"
    done
    ;;
  *)
    fail "unknown command '${cmd}'. Use: prepare|activate|verify|rollback|list|prune"
    ;;
esac

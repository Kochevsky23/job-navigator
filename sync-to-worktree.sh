#!/bin/bash
# Watches main project src/ and syncs changes to the active worktree dev server.
# Usage: ./sync-to-worktree.sh [--once]
#   --once   Run a single rsync and exit (no watching)

MAIN="/Users/dorkochevsky/job-navigator"
WT="/Users/dorkochevsky/job-navigator/.claude/worktrees/busy-hertz-e7fffb"

sync_once() {
  rsync -a --delete \
    "$MAIN/src/" "$WT/src/" \
    "$MAIN/public/" "$WT/public/" 2>/dev/null
  rsync -a \
    "$MAIN/index.html" \
    "$MAIN/tailwind.config.ts" \
    "$MAIN/vite.config.ts" \
    "$WT/" 2>/dev/null
  echo "[sync] $(date '+%H:%M:%S') — synced src/ to worktree"
}

if [[ "$1" == "--once" ]]; then
  sync_once
  exit 0
fi

echo "[sync] Watching $MAIN/src for changes... (Ctrl+C to stop)"
sync_once

LAST=""
while true; do
  # Find the newest modification time in src/
  CURRENT=$(find "$MAIN/src" -newer "$WT/src/main.tsx" -name "*.tsx" -o -name "*.ts" -o -name "*.css" 2>/dev/null | head -1)
  if [[ -n "$CURRENT" && "$CURRENT" != "$LAST" ]]; then
    LAST="$CURRENT"
    sync_once
  fi
  sleep 2
done

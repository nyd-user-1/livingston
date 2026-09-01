#!/usr/bin/env bash
# scripts/lake/run.sh — start a lake export shard detached on the worker box.
#
#   ~/livingston/scripts/lake/run.sh <name> <args to export.mjs...>
#   ~/livingston/scripts/lake/run.sh billtexts --table BillTexts
#
# tmux, NOT systemd-run, and the session name must not start with `w-`. Both
# auto-stoppers on this box — `job-janitor` and `run-due` — decide the box is
# idle with `tmux ls | grep -v '^w-'`, so a systemd unit is invisible to them
# and gets the box stopped underneath it. That is not hypothetical: box 2
# stopped itself 60 seconds into this lane's first survey (2026-09-01 06:56:35Z).
#
# A separate `lake-hold` session is kept alive for the whole run so that the
# gap between one shard ending and the next starting cannot look like an idle
# box either.
set -euo pipefail

# §0.1 — pinned, not passed. The box CLI has no region configured.
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1

NAME="${1:-}"; shift || true
if [ -z "$NAME" ] || [ $# -eq 0 ]; then
  echo "usage: run.sh <name> <args to export.mjs...>" >&2
  exit 2
fi

REPO="$HOME/livingston"
LOGS="$HOME/logs/lake"
mkdir -p "$LOGS"

SESSION="lake-$NAME"
case "$SESSION" in w-*) echo "run.sh: 'w-' names are reserved for janitors" >&2; exit 2 ;; esac
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "run.sh: $SESSION is already running" >&2; exit 3
fi

# Keep the box looking busy for the whole lane, not just while a shard runs.
if ! tmux has-session -t lake-hold 2>/dev/null; then
  tmux new-session -d -s lake-hold "while true; do date -u +%FT%TZ >> $LOGS/hold.log; sleep 300; done"
fi

CMD=$(printf '%q ' "$@")
LOG="$LOGS/$NAME.log"

tmux new-session -d -s "$SESSION" \
  "cd $REPO && export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1 && \
   node scripts/lake/export.mjs $CMD 2>&1 | tee -a $LOG; \
   echo EXIT=\${PIPESTATUS[0]} >> $LOG"

echo "$SESSION started · log $LOG"

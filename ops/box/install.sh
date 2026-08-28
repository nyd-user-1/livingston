#!/usr/bin/env bash
# ops/box/install.sh — install livingston's manifests onto the 44b worker box.
#
# Run from the LAPTOP, with the box running:
#
#   IP=$(aws ec2 describe-instances --region us-east-1 \
#          --instance-ids i-030d9cac100e6e124 \
#          --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
#   ops/box/install.sh "$IP"
#
# WHAT THIS DELIBERATELY DOES NOT DO. It copies `jobs.d/lv-*.json` and nothing
# else. The scheduler itself (~/bin/run-job, ~/bin/run-due, ~/bin/job-janitor,
# ~/bin/report-due), the systemd units and the EventBridge wake all live in
# nyd-user-1/44b and are installed by ITS ops/box/install.sh. Two repos sharing
# one box means each has to be able to install its own jobs without reaching
# into the other's; a livingston installer that also shipped run-due would
# eventually ship a stale one. It also refuses to touch any manifest that is not
# ours, so a mistaken run here can never disable or overwrite a 44b harvest.
#
# The box-side prerequisites, done once by lane WB on 2026-08-28 and recorded in
# prompts/2026-08-28-worker-box.md: a read-only deploy key for this repo, the
# `github-livingston` host alias in ~/.ssh/config, a --depth 1 clone at
# ~/livingston, `npm ci`, and ~/livingston/.env.local (mode 600) holding exactly
# POLICY_DATABASE_URL, NYS_LEGISLATION_API_KEY, LEGISCAN_API_KEY, FEC_API_KEY,
# LDA_API_KEY and CRON_SECRET.
#
# Idempotent. It copies manifests and prints what the box now sees; it never
# starts a harvest and never stops the box.
set -euo pipefail

IP="${1:-}"
KEY="${KEY:-$HOME/.ssh/44b-worker.pem}"
[ -n "$IP" ] || { echo "usage: ops/box/install.sh <box-ip>" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "→ copying livingston manifests to $IP"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "ubuntu@$IP" 'mkdir -p ~/jobs.d'
scp -q -i "$KEY" "$HERE"/jobs.d/lv-*.json "ubuntu@$IP:~/jobs.d/"

echo "→ verifying"
ssh -i "$KEY" "ubuntu@$IP" '
  echo "  livingston checkout: $(cd ~/livingston 2>/dev/null && git rev-parse --short HEAD || echo MISSING)"
  echo "  .env.local:          $(test -r ~/livingston/.env.local && echo "present ($(stat -c %a ~/livingston/.env.local), $(grep -c "^[A-Z_]*=" ~/livingston/.env.local) keys)" || echo MISSING)"
  echo "  runner:              $(test -r ~/livingston/scripts/box/run-handler.mjs && echo present || echo MISSING)"
  echo "  run-due knows repo:  $(grep -c "get(.repo.)" ~/bin/run-due || true)  (0 means 44b ops/box/install.sh has not been re-run since the two-repo change)"
  echo "  livingston jobs:     $(ls ~/jobs.d/lv-*.json 2>/dev/null | wc -l | tr -d " ")"
  echo "  44b jobs untouched:  $(ls ~/jobs.d/*.json 2>/dev/null | grep -vc "/lv-" || true)"
'
echo
echo "Dry-run what tonight would do (launches nothing, stops nothing):"
echo "  ssh -i $KEY ubuntu@$IP '~/bin/run-due --dry-run'"

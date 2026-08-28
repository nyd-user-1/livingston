#!/usr/bin/env bash
# ops/box2/install.sh — put lane DP's pipeline on worker-box-2.
#
#   ops/box2/install.sh <ip>              # scripts + manifests (safe today)
#   ops/box2/install.sh <ip> --checkout   # ALSO make ~/livingston a git checkout
#
# Box 2 was built by lane IN with a bare ~/livingston workspace (pg, yaml) and
# ~/bin/{run-job,run-due,job-janitor,report-due,os-scrape} already installed from
# 44b's ops/box/. This adds the pipeline and its manifests. It does NOT install
# run-job or the janitor — those are there and byte-verified against the laptop.
#
# ⚠ READ THIS BEFORE --checkout.
#
# `run-due` will not launch a manifest whose repo has no checkout ("no checkout at
# $HOME/livingston — skipped"), and when it does find one it runs
#     git fetch --depth 1 origin main && git reset --hard origin/main
# BEFORE the job. So --checkout is what arms the schedule, AND it is what would
# destroy an rsync'd working tree. Lane DP's code is not pushed (the brief says
# no push), so today the scripts arrive by rsync and ~/livingston is deliberately
# NOT a git repo: the manifests are installed and inert. Run --checkout only
# after this lane's commit is on origin/main, and take the rsync'd tree as lost
# when you do.
#
# The janitor's contract, worth knowing before you start anything by hand: it
# stops the box 60 s after the LAST job's tmux session ends, and it does not read
# ~/.keep-up (that flag is only honoured by run-due --boot, and only inside its
# 120 s grace — lane WB's D1). To hold the box while working:
#     tmux new-session -d -s dp-hold 'sleep 36000'
# and kill it when you are done so the last real job can stop the box.

set -euo pipefail
IP="${1:?usage: install.sh <ip> [--checkout]}"
CHECKOUT="${2:-}"
KEY="${KEY:-$HOME/.ssh/livingston-worker-2.pem}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "ubuntu@$IP")

echo "==> pipeline scripts -> ~/livingston/scripts/pipeline"
rsync -az --delete -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  "$REPO/scripts/pipeline" "ubuntu@$IP:~/livingston/scripts/"

# api/_lib/polite-fetch.ts is not optional: _lib/polite.mjs bundles it with
# esbuild rather than reimplementing politeness in .mjs, so the fetcher on the
# box and the fetcher lane BT wrote are the same file.
echo "==> api/_lib/polite-fetch.ts -> ~/livingston/api/_lib/"
rsync -az -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" --relative \
  -C "$REPO/./api/_lib/polite-fetch.ts" "ubuntu@$IP:~/livingston/"

echo "==> dependencies"
"${SSH[@]}" 'cd ~/livingston && npm i --no-audit --no-fund pg yaml esbuild fast-xml-parser fflate 2>&1 | tail -2'

echo "==> manifests -> ~/jobs.d"
for f in "$REPO"/ops/box2/jobs.d/*.json; do
  python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f"   # never ship a manifest run-due cannot parse
  scp -q -i "$KEY" "$f" "ubuntu@$IP:~/jobs.d/"
done

echo "==> installed manifests"
"${SSH[@]}" 'ls ~/jobs.d/dp-*.json | sed "s#.*/##"'

if [ "$CHECKOUT" = "--checkout" ]; then
  echo "==> making ~/livingston a git checkout (this DESTROYS the rsync'd tree on the next run-due)"
  "${SSH[@]}" 'set -e
    test -f ~/.ssh/livingston_deploy || { echo "no deploy key at ~/.ssh/livingston_deploy — add one first"; exit 2; }
    if [ ! -d ~/livingston/.git ]; then
      mv ~/livingston ~/livingston.workspace
      GIT_SSH_COMMAND="ssh -i ~/.ssh/livingston_deploy" git clone --depth 1 git@github.com:nyd-user-1/livingston.git ~/livingston
      cp -r ~/livingston.workspace/node_modules ~/livingston/ 2>/dev/null || true
    fi
    cd ~/livingston && npm i --no-audit --no-fund pg esbuild fast-xml-parser fflate 2>&1 | tail -1'
else
  echo
  echo "NOTE: ~/livingston is not a git checkout, so run-due will SKIP every dp-* manifest"
  echo "      (\"no checkout at /home/ubuntu/livingston\"). That is deliberate while this"
  echo "      lane's code is unpushed. Re-run with --checkout once it is on origin/main."
fi

echo "==> dry run (what run-due would do tonight)"
"${SSH[@]}" 'mv ~/.no-auto-jobs ~/.no-auto-jobs.off 2>/dev/null || true
             ~/bin/run-due --dry-run 2>&1 | grep -E "dp-|considered" | head -20
             mv ~/.no-auto-jobs.off ~/.no-auto-jobs 2>/dev/null || true'

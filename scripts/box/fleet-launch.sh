#!/usr/bin/env bash
# scripts/box/fleet-launch.sh — a fleet of bill-text workers, one public IP each.
#
#   fleet-launch.sh <ami-id> <count> [--from i] [--type t4g.medium] [--skip-states A,B] [--start 4] [--max 16] [--dry-run]
#   --from i launches shards i..count-1 only (a box already running shard 0 by hand counts as a member).
#   --pdf-batch  not a walker: one many-core box (default c7g.4xlarge) that converts the PDFs parked in
#                S3 by PDF_DEFER_BUCKET (`--source pdf-batch --batch 500 --concurrency 32`) and shuts down.
#   --bootstrap  the AMI is stock Ubuntu 24.04 arm64: user-data installs node 22 + poppler and unpacks
#                s3://livingston-fec-bulk-638175140432/_fleet/bootstrap/livingston.tgz (box 1's repo with
#                node_modules and .env.local, packed by the lead) — no snapshot to wait for.
#
# Brendan, 2026-08-29: "run 4 per instance for as many instances as you can …
# different IPs … dial up from 4 to 8 … staggered." Every rate limit we have met
# (Florida, Michigan) is per IP, so the fleet is the answer that fits every
# state: k boxes from one AMI, each `--shard i/k` of the outstanding documents
# (document_id % k), each host starting at `start` lanes and ramping itself to
# `max` (POLITE_AUTO_LANES). No box talks to another; the database is the
# coordinator, and a box that dies loses nothing — its shard is simply
# outstanding for the next run.
#
# Each instance: boots the AMI, claims itself against the box's boot janitor,
# disables the scheduler timers (the AMI carries box 1's; eight copies of the
# nightly LegiScan delta would be a disaster), pulls main, runs its shard, and
# terminates itself when the shard is drained. Logs stream to
# s3://livingston-fec-bulk-638175140432/_fleet/<shard>.log every few minutes and
# at exit (that bucket is the one the worker role can already write).
set -euo pipefail
AMI="${1:?ami-id}"; COUNT="${2:?count}"; shift 2
TYPE=t4g.medium; SKIP="NJ,CA,IL,VA,MA,TN"; START=4; MAX=16; DRY=0; FROM=0; BOOT=0; PDFB=0
# The PDF bucket: every PDF the fleet meets is parked here and converted later in one pass.
PDF_BUCKET=livingston-bill-pdfs-638175140432
# The robots-refused states get Tennessee's treatment — Brendan, 2026-08-29 22:05: "all 50 minus
# the 3-4 where you are blocked … you go at max speed." Fixed 4 lanes per IP, Disallow set aside,
# by host name. PA and GA are AWS-range blocks and are not here; they need a human.
OVERRIDES="webserver1.lsb.state.ok.us=0:4:norobots,www.oklegislature.gov=0:4:norobots,www3.oklegislature.gov=0:4:norobots,www.capitol.hawaii.gov=0:4:norobots,leg.colorado.gov=0:4:norobots,www.leg.state.co.us=0:4:norobots,lims.dccouncil.us=0:4:norobots,lims.dccouncil.gov=0:4:norobots,www.legis.state.ak.us=0:4:norobots,www.akleg.gov=0:4:norobots,www.flsenate.gov=1000:2,www.azleg.gov=1000:2,house.mo.gov=1000:2,documents.house.mo.gov=250:4,publications.tnsosfiles.com=500:2:norobots,content.leg.colorado.gov=1000:2:norobots,gc.nh.gov=1000:2,www.legis.iowa.gov=1000:2,alison.legislature.state.al.us=250:4,olis.oregonlegislature.gov=250:4,apps.legislature.ky.gov=250:4"
while [ $# -gt 0 ]; do case "$1" in
  --from) FROM="$2"; shift 2 ;; --bootstrap) BOOT=1; shift ;; --pdf-batch) PDFB=1; TYPE=c7g.4xlarge; shift ;; --type) TYPE="$2"; shift 2 ;; --skip-states) SKIP="$2"; shift 2 ;; --start) START="$2"; shift 2 ;; --max) MAX="$2"; shift 2 ;; --dry-run) DRY=1; shift ;;
  *) echo "unknown arg $1" >&2; exit 2 ;; esac; done
REGION=us-east-1
SUBNET=subnet-09e840612db030382; SG=sg-0d89f5998e3415eb0; KEY=44b-worker
PROFILE=arn:aws:iam::638175140432:instance-profile/44b-worker-selfstop
BUCKET=livingston-fec-bulk-638175140432

for i in $(seq "$FROM" $((COUNT - 1))); do
  SHARD="$i/$COUNT"
  USERDATA=$(cat <<EOF
#!/bin/bash
# fleet worker: shard $SHARD of $COUNT
touch /home/ubuntu/.keep-up /home/ubuntu/.no-auto-jobs; chown ubuntu:ubuntu /home/ubuntu/.keep-up /home/ubuntu/.no-auto-jobs
systemctl disable --now run-due.timer run-due.service run-due-catchup.service 2>/dev/null || true
if [ "$BOOT" = 1 ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq poppler-utils antiword unzip curl ca-certificates git >/dev/null 2>&1
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1 && apt-get install -y -qq nodejs >/dev/null 2>&1
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o /tmp/awscli.zip && (cd /tmp && unzip -q awscli.zip && ./aws/install >/dev/null 2>&1)
  sudo -u ubuntu -H bash -c 'cd /home/ubuntu && aws s3 cp --quiet s3://$BUCKET/_fleet/bootstrap/livingston.tgz /tmp/livingston.tgz --region $REGION && tar xzf /tmp/livingston.tgz && rm /tmp/livingston.tgz'
fi
mkdir -p /home/ubuntu/logs; chown ubuntu:ubuntu /home/ubuntu/logs
LOG=/home/ubuntu/logs/fleet-shard-$i.log
( while true; do sleep 300; aws s3 cp --quiet "\$LOG" s3://$BUCKET/_fleet/shard-$i-of-$COUNT.log --region $REGION 2>/dev/null || true; done ) &
sudo -u ubuntu -H bash -c 'cd /home/ubuntu/livingston && (git pull -q --ff-only origin main 2>/dev/null || true); $( [ "$PDFB" = 1 ] && echo "node scripts/box/text-backfill.mjs --source pdf-batch --batch 1000 --concurrency 96 --max-errors 50" || echo "PDF_DEFER_BUCKET=$PDF_BUCKET TEXT_SINK_BUCKET=$PDF_BUCKET POLITE_HOST_OVERRIDES=$OVERRIDES POLITE_AUTO_LANES=$START:$MAX node scripts/box/text-backfill.mjs --source state_link --all-states --skip-states $SKIP --shard $SHARD --parallel 4 --batch 4000 --since-session 2009 --max-errors 20" )' > "\$LOG" 2>&1
echo "EXIT=\$? \$(date -u +%FT%TZ)" >> "\$LOG"
aws s3 cp --quiet "\$LOG" s3://$BUCKET/_fleet/shard-$i-of-$COUNT.log --region $REGION || true
shutdown -h now
EOF
)
  if [ "$DRY" = 1 ]; then echo "--- shard $SHARD user-data ---"; echo "$USERDATA" | head -12; continue; fi
  ID=$(aws ec2 run-instances --region $REGION --image-id "$AMI" --instance-type "$TYPE" --subnet-id $SUBNET --security-group-ids $SG --key-name $KEY \
        --iam-instance-profile Arn=$PROFILE --instance-initiated-shutdown-behavior terminate \
        --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":100,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=lv-text-$( [ "$PDFB" = 1 ] && echo pdfbatch || echo fleet )-$i},{Key=project,Value=livingston},{Key=fleet,Value=$( [ "$PDFB" = 1 ] && echo pdf || echo text )},{Key=shard,Value=$SHARD}]" \
        --user-data "$USERDATA" --query 'Instances[0].InstanceId' --output text)
  echo "shard $SHARD -> $ID"
  sleep 3   # staggered, as asked; also keeps the API happy
done

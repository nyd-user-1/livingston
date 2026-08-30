#!/usr/bin/env bash
# scripts/box/fleet-launch.sh — a fleet of bill-text workers, one public IP each.
#
#   fleet-launch.sh <ami-id> <count> [--type t4g.medium] [--skip-states A,B] [--start 4] [--max 16] [--dry-run]
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
TYPE=t4g.medium; SKIP="NJ,CA,IL,VA,MA,TN,FL,MI"; START=4; MAX=16; DRY=0
while [ $# -gt 0 ]; do case "$1" in
  --type) TYPE="$2"; shift 2 ;; --skip-states) SKIP="$2"; shift 2 ;; --start) START="$2"; shift 2 ;; --max) MAX="$2"; shift 2 ;; --dry-run) DRY=1; shift ;;
  *) echo "unknown arg $1" >&2; exit 2 ;; esac; done
REGION=us-east-1
SUBNET=subnet-09e840612db030382; SG=sg-0d89f5998e3415eb0; KEY=44b-worker
PROFILE=arn:aws:iam::638175140432:instance-profile/44b-worker-selfstop
BUCKET=livingston-fec-bulk-638175140432

for i in $(seq 0 $((COUNT - 1))); do
  SHARD="$i/$COUNT"
  USERDATA=$(cat <<EOF
#!/bin/bash
# fleet worker: shard $SHARD of $COUNT
touch /home/ubuntu/.keep-up /home/ubuntu/.no-auto-jobs; chown ubuntu:ubuntu /home/ubuntu/.keep-up /home/ubuntu/.no-auto-jobs
systemctl disable --now run-due.timer run-due.service run-due-catchup.service 2>/dev/null || true
mkdir -p /home/ubuntu/logs; chown ubuntu:ubuntu /home/ubuntu/logs
LOG=/home/ubuntu/logs/fleet-shard-$i.log
( while true; do sleep 300; aws s3 cp --quiet "\$LOG" s3://$BUCKET/_fleet/shard-$i-of-$COUNT.log --region $REGION 2>/dev/null || true; done ) &
sudo -u ubuntu -H bash -c 'cd /home/ubuntu/livingston && git pull -q --ff-only origin main; POLITE_AUTO_LANES=$START:$MAX node scripts/box/text-backfill.mjs --source state_link --all-states --skip-states $SKIP --shard $SHARD --parallel 16 --batch 400 --since-session 2009 --max-errors 20' > "\$LOG" 2>&1
echo "EXIT=\$? \$(date -u +%FT%TZ)" >> "\$LOG"
aws s3 cp --quiet "\$LOG" s3://$BUCKET/_fleet/shard-$i-of-$COUNT.log --region $REGION || true
shutdown -h now
EOF
)
  if [ "$DRY" = 1 ]; then echo "--- shard $SHARD user-data ---"; echo "$USERDATA" | head -12; continue; fi
  ID=$(aws ec2 run-instances --region $REGION --image-id "$AMI" --instance-type "$TYPE" --subnet-id $SUBNET --security-group-ids $SG --key-name $KEY \
        --iam-instance-profile Arn=$PROFILE --instance-initiated-shutdown-behavior terminate \
        --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":100,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=lv-text-fleet-$i},{Key=project,Value=livingston},{Key=fleet,Value=text},{Key=shard,Value=$SHARD}]" \
        --user-data "$USERDATA" --query 'Instances[0].InstanceId' --output text)
  echo "shard $SHARD -> $ID"
  sleep 3   # staggered, as asked; also keeps the API happy
done

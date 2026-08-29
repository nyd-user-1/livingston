#!/usr/bin/env bash
# scripts/box/fec-bulk-mirror.sh — mirror the FEC's bulk-downloads bucket to ours.
#
#   fec-bulk-mirror.sh [--parallel 4] [--only PREFIX,PREFIX] [--skip PREFIX,PREFIX] [--dry-run]
#
# The FEC publishes everything on https://www.fec.gov/data/browse-data/?tab=bulk-data
# from one public S3 bucket in GovCloud (cg-519a459a-…, us-gov-west-1), listable
# and readable unsigned. This script lists it — the listing IS the manifest, no
# guessed filenames — and streams every object through the box into
# s3://livingston-fec-bulk-638175140432 under the same key, never touching the
# box's disk (indiv22.zip alone is 5 GB). A key already present at the same size
# is skipped, so the job is resumable and a re-run costs one listing.
#
# Brendan, 2026-08-29: "Get ALL of it, not just 2020-2026, all of it, and put
# it on S3." Cycles 1978→2030, the per-year CSVs, data.fec.gov, the PostgreSQL
# schedule dumps, the presidential map exports. The raw .fec filing archives
# (electronic/, paper/) are sized and reported separately — they are hundreds
# of GB of raw filings, not tables — and mirrored only when listed in --only.
#
# Politeness: a public bucket has no robots.txt and no per-host courtesy to
# keep; --parallel is bounded by the box's network, default 4 streams.
set -uo pipefail

SRC_BUCKET="cg-519a459a-0ea3-42c2-b7bc-fa1143481f74"
SRC_REGION="us-gov-west-1"
SRC_PREFIX="bulk-downloads/"
DST_BUCKET="livingston-fec-bulk-638175140432"
DST_REGION="us-east-1"
PARALLEL=4
ONLY=""
SKIP="test-electronic,test-paper,electronic,paper"
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --parallel) PARALLEL="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --skip) SKIP="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# --- 1. the manifest: every object in the source, with size -----------------
log "listing s3://$SRC_BUCKET/$SRC_PREFIX (unsigned, $SRC_REGION)"
aws s3api list-objects-v2 --no-sign-request --region "$SRC_REGION" --bucket "$SRC_BUCKET" --prefix "$SRC_PREFIX" \
  --query 'Contents[].[Size,LastModified,Key]' --output text > "$WORK/src.tsv"
SRC_N=$(wc -l < "$WORK/src.tsv"); SRC_B=$(awk '{s+=$1} END{print s+0}' "$WORK/src.tsv")
log "source: $SRC_N objects, $(echo "$SRC_B/1073741824" | bc -l | xargs printf '%.1f') GB"

# scope: drop keys whose first path segment after the prefix is in SKIP (unless named in ONLY)
awk -v pre="$SRC_PREFIX" -v only="$ONLY" -v skip="$SKIP" 'BEGIN{
    n=split(only,o,","); for(i=1;i<=n;i++) if(o[i]!="") O[o[i]]=1;
    m=split(skip,s,","); for(i=1;i<=m;i++) if(s[i]!="") S[s[i]]=1;
  }
  { key=$3; for (f=4; f<=NF; f++) key=key " " $f;   # keys with spaces came back split across fields
    rest=substr(key, length(pre)+1); split(rest, seg, "/"); top=(rest ~ /\//) ? seg[1] : "(root)";
    if (length(O)>0) { if (!(top in O)) next } else if (top in S) next;
    if ($1==0 || key ~ /\/$/) next;
    print $1 "\t" $2 "\t" key }' "$WORK/src.tsv" > "$WORK/scope.tsv"
SC_N=$(wc -l < "$WORK/scope.tsv"); SC_B=$(awk '{s+=$1} END{print s+0}' "$WORK/scope.tsv")
log "in scope: $SC_N objects, $(echo "$SC_B/1073741824" | bc -l | xargs printf '%.1f') GB (skip: ${SKIP:-none}; only: ${ONLY:-all})"

# --- 2. what we already hold -------------------------------------------------
aws s3api list-objects-v2 --region "$DST_REGION" --bucket "$DST_BUCKET" --prefix "$SRC_PREFIX" \
  --query 'Contents[].[Size,Key]' --output text 2>/dev/null | grep -v '^None' > "$WORK/dst.tsv" || true
# FILENAME, not NR==FNR: an EMPTY destination listing makes NR==FNR true for every
# line of the second file too, and the whole scope reads as "already held".
awk -F'\t' -v dst="$WORK/dst.tsv" 'FILENAME==dst { k=$2; for (f=3; f<=NF; f++) k=k "\t" $f; have[k]=$1; next } { if (($3 in have) && have[$3]==$1) next; print }' "$WORK/dst.tsv" "$WORK/scope.tsv" > "$WORK/todo.tsv"
TODO_N=$(wc -l < "$WORK/todo.tsv"); TODO_B=$(awk '{s+=$1} END{print s+0}' "$WORK/todo.tsv")
log "to copy: $TODO_N objects, $(echo "$TODO_B/1073741824" | bc -l | xargs printf '%.1f') GB (already held: $((SC_N - TODO_N)))"

# the manifest goes to the destination first, so the haul documents itself
if [ "$DRY" = 0 ]; then
  aws s3 cp --region "$DST_REGION" --quiet "$WORK/src.tsv" "s3://$DST_BUCKET/_manifest/source-$STAMP.tsv"
  aws s3 cp --region "$DST_REGION" --quiet "$WORK/scope.tsv" "s3://$DST_BUCKET/_manifest/scope-$STAMP.tsv"
fi
[ "$DRY" = 1 ] && { awk -F'\t' '{printf "%12d  %s\n", $1, $3}' "$WORK/todo.tsv" | sort -k2 | head -40; exit 0; }

# --- 3. stream, N at a time --------------------------------------------------
copy_one() {
  local size="$1" key="$2" t0 rc
  t0=$(date +%s)
  # One stream: unsigned GET from GovCloud → multipart PUT to us-east-1. --expected-size lets
  # the CLI pick part sizes for anything over 5 GB (indiv22 is 5.0 GB).
  aws s3 cp --no-sign-request --region "$SRC_REGION" --quiet "s3://$SRC_BUCKET/$key" - \
    | aws s3 cp --region "$DST_REGION" --quiet --expected-size "$size" - "s3://$DST_BUCKET/$key"
  rc=$?
  if [ $rc -eq 0 ]; then
    local got; got=$(aws s3api head-object --region "$DST_REGION" --bucket "$DST_BUCKET" --key "$key" --query ContentLength --output text 2>/dev/null)
    if [ "$got" = "$size" ]; then printf '%s ok   %12d  %4ss  %s\n' "$(date -u +%H:%M:%S)" "$size" "$(( $(date +%s) - t0 ))" "$key"; return 0; fi
    printf '%s SIZE MISMATCH %s: wanted %s got %s\n' "$(date -u +%H:%M:%S)" "$key" "$size" "$got"; return 1
  fi
  printf '%s FAIL rc=%s  %s\n' "$(date -u +%H:%M:%S)" "$rc" "$key"; return 1
}
[ -s "$WORK/todo.tsv" ] || { log "nothing to copy"; exit 0; }
export -f copy_one; export SRC_BUCKET SRC_REGION DST_BUCKET DST_REGION
# biggest first, so the tail of the run is small files rather than indiv22
sort -t$'\t' -k1,1nr "$WORK/todo.tsv" | awk -F'\t' '{print $1 "\t" $3}' \
  | xargs -P "$PARALLEL" -n 1 -d '\n' bash -c 'IFS=$'"'"'\t'"'"' read -r size key <<< "$0"; copy_one "$size" "$key"' \
  | tee "$WORK/copies.log"
OK=$(grep -c ' ok ' "$WORK/copies.log" || true); BAD=$(grep -cE 'FAIL|MISMATCH' "$WORK/copies.log" || true)
aws s3 cp --region "$DST_REGION" --quiet "$WORK/copies.log" "s3://$DST_BUCKET/_manifest/copies-$STAMP.log"
log "done: $OK copied, $BAD failed, of $TODO_N"
[ "$BAD" = 0 ]

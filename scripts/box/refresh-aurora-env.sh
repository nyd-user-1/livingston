#!/usr/bin/env bash
# scripts/box/refresh-aurora-env.sh — rewrite ~/.govblock/aurora.env from the
# cluster's own secret, so a box job survives a password rotation.
#
#   scripts/box/refresh-aurora-env.sh && . ~/.govblock/aurora.env
#
# Why: Aurora's master credentials are RDS-managed and **rotate automatically
# every 7 days**. Staging them into a file once, as the migration did on
# 2026-09-01 at 08:06Z, works until the first rotation (12:21Z the same day) and
# then every box-side job fails `password authentication failed` — silently, in a
# log nobody reads, while the site stays green because it reaches Aurora through
# the Data API with the secret's *ARN* and therefore always sees the current one.
#
# Run this at the top of any job that talks to Aurora with psql or `pg`.
set -euo pipefail

CLUSTER="${AURORA_CLUSTER_ID:-aurora-2525}"
REGION="${AWS_REGION:-us-east-1}"
DEST="${AURORA_ENV_FILE:-$HOME/.govblock/aurora.env}"

# Ask the cluster which secret is its own rather than hard-coding the ARN: a
# rotation changes the value, but a re-provision would change the ARN.
SECRET_ARN="$(aws rds describe-db-clusters --region "$REGION" --db-cluster-identifier "$CLUSTER" \
  --query 'DBClusters[0].MasterUserSecret.SecretArn' --output text)"
[ -n "$SECRET_ARN" ] && [ "$SECRET_ARN" != "None" ] || { echo "refresh-aurora-env: no MasterUserSecret on $CLUSTER" >&2; exit 1; }

HOST="$(aws rds describe-db-clusters --region "$REGION" --db-cluster-identifier "$CLUSTER" \
  --query 'DBClusters[0].Endpoint' --output text)"
SECRET="$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET_ARN" --query SecretString --output text)"

mkdir -p "$(dirname "$DEST")"
umask 077
# The password is written twice: raw for PGPASSWORD, percent-encoded inside the
# URL. libpq tolerates a raw password in a URI; `pg` does not — it answers
# "Invalid URL" on the ? ] ( * ! this one contains.
SECRET_ARN="$SECRET_ARN" HOST="$HOST" CLUSTER="$CLUSTER" python3 - "$SECRET" > "$DEST.new" <<'PY'
import json, os, sys, urllib.parse
s = json.loads(sys.argv[1])
user, pw = s["username"], s["password"]
host, arn = os.environ["HOST"], os.environ["SECRET_ARN"]
print(f"# written by scripts/box/refresh-aurora-env.sh — do not edit; the password rotates")
print(f"export PGHOST='{host}'")
print("export PGPORT=5432")
print(f"export PGUSER='{user}'")
print(f"export PGPASSWORD='{pw}'")
print("export PGSSLMODE=require")
print(f"export POLICY_CLUSTER_ARN='arn:aws:rds:{os.environ.get('AWS_REGION','us-east-1')}:638175140432:cluster:{os.environ['CLUSTER']}'")
print(f"export POLICY_SECRET_ARN='{arn}'")
print(f"export AURORA_ADMIN_URL='postgresql://{user}:{urllib.parse.quote(pw, safe='')}@{host}:5432/postgres?sslmode=require'")
print(f"export AURORA_POLICY_URL='postgresql://{user}:{urllib.parse.quote(pw, safe='')}@{host}:5432/policy?sslmode=require'")
PY
chmod 600 "$DEST.new"
mv "$DEST.new" "$DEST"
echo "refresh-aurora-env: $DEST rewritten from $SECRET_ARN"

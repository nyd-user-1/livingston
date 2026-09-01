#!/usr/bin/env python3
"""scripts/lake/duck.py — run one DuckDB query against the lake, print JSON rows.

    python3 scripts/lake/duck.py "select count(*) from read_parquet('s3://.../**/*.parquet')"

The Parquet side of the §5 acceptance check. Kept as a thin shell so verify.mjs
can hold both halves of a comparison — Neon rows and lake rows — in one place.
Credentials come from the instance role via DuckDB's credential chain; the
region is pinned here for the same reason it is pinned everywhere else (§0.1).
"""
import json
import sys
from datetime import date, datetime
from decimal import Decimal

import duckdb


def encode(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, (list, tuple)):
        return [encode(v) for v in value]
    if isinstance(value, dict):
        return {k: encode(v) for k, v in value.items()}
    return value


def main():
    sql = sys.argv[1]
    con = duckdb.connect()
    con.execute("install httpfs; load httpfs;")
    con.execute("set s3_region='us-east-1';")
    con.execute("create or replace secret lake (type s3, provider credential_chain);")
    cur = con.execute(sql)
    columns = [d[0] for d in cur.description]
    rows = [dict(zip(columns, (encode(v) for v in row))) for row in cur.fetchall()]
    json.dump(rows, sys.stdout)


if __name__ == "__main__":
    main()

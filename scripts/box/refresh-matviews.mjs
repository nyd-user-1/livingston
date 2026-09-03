#!/usr/bin/env node
// scripts/box/refresh-matviews.mjs — refresh the policy matviews the govblock
// pages read (mv_stream_latest, mv_newsroom_latest; govblock/sql/001_policy_matviews.sql).
//
// Runs nightly on the worker box from the lv-refresh-matviews manifest, after
// the syncs that change Bills, Sponsors, Calendar and Roll Call. Both views
// refresh CONCURRENTLY, so readers keep the previous rows while the new ones
// build; ~45 s on Neon. Exits non-zero on failure so run-due records it.

import process from "node:process"
import { neon, policyUrl } from "./policy-db.mjs";
// Aurora, not Neon, since 2026-09-03 — see policy-db.mjs.
policyUrl("refresh-matviews");

const url = process.env.POLICY_DATABASE_URL
if (!url) {
  console.error("refresh-matviews: POLICY_DATABASE_URL is not set")
  process.exit(2)
}

const sql = neon(url)
const started = Date.now()
try {
  await sql`select public.refresh_policy_matviews()`
  const [stream] = await sql`select count(*)::int as rows, count(distinct state)::int as states, max(refreshed_at) as at from public.mv_stream_latest`
  const [news] = await sql`select count(*)::int as states, max(refreshed_at) as at from public.mv_newsroom_latest`
  console.log(
    `refresh-matviews: ok in ${((Date.now() - started) / 1000).toFixed(1)} s — stream ${stream.rows} rows / ${stream.states} states, newsroom ${news.states} states, refreshed ${new Date(stream.at).toISOString()}`
  )
} catch (error) {
  console.error("refresh-matviews: failed", error)
  process.exit(1)
}

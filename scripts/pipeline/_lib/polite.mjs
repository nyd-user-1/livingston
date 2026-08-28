#!/usr/bin/env node
// scripts/pipeline/_lib/polite.mjs — lane DP's fetcher IS lane BT's fetcher.
//
// The hard rule says native feeds run at <= 5 req/s and honour Retry-After.
// There is already an implementation of exactly that in api/_lib/polite-fetch.ts
// — per-host serialisation, robots.txt read once and obeyed, Crawl-delay raises
// the interval and never lowers it, Retry-After honoured, five consecutive
// 403/429 and the host is dropped. Writing a second one in .mjs would mean two
// definitions of "polite" drifting apart, which is the failure BT's own comment
// warns about ("a driver can be rewritten by someone in a hurry").
//
// So this bundles the TypeScript with esbuild and imports it, the same shim
// scripts/box/run-handler.mjs already uses for the handlers. One source of
// truth; node 22.16 on the laptop cannot import .ts directly and node 22.23 on
// box 2 can, so the bundle is the thing that works in both places.

import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "./db.mjs";

let cached = null;

export async function politeModule() {
  if (cached) return cached;
  const entry = path.join(REPO, "api", "_lib", "polite-fetch.ts");
  const out = await build({ entryPoints: [entry], write: false, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "warning" });
  const tmp = path.join(os.tmpdir(), `dp-polite-${process.pid}.mjs`);
  fs.writeFileSync(tmp, out.outputFiles[0].text);
  try { cached = await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
  return cached;
}

/**
 * A fetcher for structured feeds.
 *
 * minDelayMs defaults to 1,200 rather than the walker's 1,000 for one measured
 * reason: legislation.nysenate.gov is SHARED with lane BT's lv-text-ny, which
 * runs at a measured 4.1 req/s (300 bills in 73-85 s). The stated ceiling for
 * the host is 5 req/s for all of us together, so this side takes <= 0.83 and the
 * sum stays under. maxBytes is raised because one NY page is 33.6 MB of JSON —
 * the walker's 20 MB cap is right for a document and wrong for a bulk page.
 */
export async function feedFetcher({ minDelayMs = 1200, maxBytes = 192 * 1024 * 1024, timeoutMs = 180_000 } = {}) {
  const { PoliteFetcher } = await politeModule();
  return new PoliteFetcher({ minDelayMs, maxBytes, timeoutMs });
}

/** GET + JSON.parse, with the fetcher's skip reasons preserved rather than thrown away. */
export async function getJson(fetcher, url) {
  const r = await fetcher.get(url);
  if (!r.ok) {
    const e = new Error(r.error || `HTTP ${r.status}`);
    e.status = r.status; e.skipped = r.skipped;
    throw e;
  }
  return JSON.parse(new TextDecoder().decode(r.body));
}

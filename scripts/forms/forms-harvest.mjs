#!/usr/bin/env node
// scripts/forms/forms-harvest.mjs — the forms library: catalogue, fetch, inspect.
//
//   node scripts/forms/forms-harvest.mjs catalog [--source otda|all]
//   node scripts/forms/forms-harvest.mjs fetch   [--source otda|all] [--lanes 4] [--limit 0]
//   node scripts/forms/forms-harvest.mjs inspect [--source otda|all] [--limit 0]
//
// Brendan, 2026-08-30: "find all significant PDF forms relied upon by the state
// and federal government for benefits, grants, and programs … get all of NYS
// and the most common federal forms to start."
//
// The catalogue comes from the Wayback Machine's CDX index — every PDF URL the
// archive has ever captured on a host, with timestamp and digest — plus a few
// live indexes that are plain (IRS's directory, the VA forms API). Files are
// fetched live where the host allows and from the archive where it walls us
// (OTDA and OCFS drop non-browser TLS handshakes; SSA 403s everything). Every
// original lands in S3 untouched; the "Forms" table holds the catalogue and
// what `inspect` learns (pages, fillable field names — Penny's raw material).
//
// Env: POLICY_DATABASE_URL (the policy Neon), AWS creds/role for the bucket.
// Needs: node 22, pdfinfo (poppler-utils) for inspect.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { neon } from "@neondatabase/serverless";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const line of (fs.existsSync(path.join(REPO, ".env.local")) ? fs.readFileSync(path.join(REPO, ".env.local"), "utf8") : "").split("\n")) {
  const s = line.trim(); if (!s || s.startsWith("#")) continue;
  const i = s.indexOf("="); if (i < 1 || process.env[s.slice(0, i).trim()] !== undefined) continue;
  process.env[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const BUCKET = process.env.FORMS_BUCKET || "livingston-bill-pdfs-638175140432";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 livingston-forms/1.0 (contact: brendan@nysgpt.com)";
const argv = process.argv.slice(2);
const CMD = argv[0];
const val = (f, d = "") => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SOURCE = val("--source", "all");
const LANES = Number(val("--lanes", "4")) || 4;
const LIMIT = Number(val("--limit", "0")) || 0;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

/* ---- the sources ---------------------------------------------------------- */
// cdx: URL patterns for the Wayback CDX (host/path*), include/exclude on the path.
// live: plain indexes to crawl (depth 1 unless noted). api: a JSON endpoint.
// The include list is deliberately generous; `inspect` and the human separate forms from brochures.
const FORM_PATH = /forms?\/|application|apply|\/pdf\/|LDSS|OCFS|DOH-|DSS-|-form|form-|\bf\d{3,5}|\bi-\d{2,3}|\bn-\d{3}|ssa-\d|vha-|va-?\d|sf-?\d|hud-?\d|cms-?\d|eta-?\d|\/publications?\//i;
const NOT_FORM = /org-?chart|organization-chart|press|news|minutes|agenda|annual-?report|budget|newsletter|brochure|poster|flyer|calendar|map|photo|slide|presentation|testimony|rfp|rfa|contract|procurement/i;
export const SOURCES = {
  // ---- New York State ----
  otda: { gov: "NYS", agency: "OTDA", cdx: ["otda.ny.gov/programs/*", "otda.ny.gov/forms/*", "otda.ny.gov/applications/*"], walled: true },
  ocfs: { gov: "NYS", agency: "OCFS", cdx: ["ocfs.ny.gov/forms/*", "ocfs.ny.gov/main/forms/*", "ocfs.ny.gov/programs/*"], walled: true },
  doh: { gov: "NYS", agency: "DOH", cdx: ["health.ny.gov/forms/*", "health.ny.gov/health_care/medicaid/*"], live: ["https://www.health.ny.gov/forms/"] },
  dol: { gov: "NYS", agency: "DOL", cdx: ["dol.ny.gov/system/files/documents/*", "dol.ny.gov/forms/*", "labor.ny.gov/formsdocs/*"] },
  dtf: { gov: "NYS", agency: "DTF", cdx: ["tax.ny.gov/pdf/current_forms/*", "tax.ny.gov/pdf/*"], walled: true },
  dmv: { gov: "NYS", agency: "DMV", cdx: ["dmv.ny.gov/forms/*", "dmv.ny.gov/sites/default/files/*"], live: ["https://dmv.ny.gov/forms"] },
  omh: { gov: "NYS", agency: "OMH", cdx: ["omh.ny.gov/omhweb/forms/*"], live: ["https://omh.ny.gov/omhweb/forms/"] },
  oasas: { gov: "NYS", agency: "OASAS", cdx: ["oasas.ny.gov/forms/*", "oasas.ny.gov/system/files/*"] },
  hesc: { gov: "NYS", agency: "HESC", cdx: ["hesc.ny.gov/*"] },
  hcr: { gov: "NYS", agency: "HCR", cdx: ["hcr.ny.gov/system/files/*", "hcr.ny.gov/forms/*"] },
  nycHra: { gov: "NYC", agency: "HRA", cdx: ["nyc.gov/assets/hra/*", "www1.nyc.gov/assets/hra/*"] },
  nycDhs: { gov: "NYC", agency: "DHS", cdx: ["nyc.gov/assets/dhs/*"] },
  nycHpd: { gov: "NYC", agency: "HPD", cdx: ["nyc.gov/assets/hpd/*"] },
  // ---- Federal ----
  irs: { gov: "US", agency: "IRS", live: ["https://www.irs.gov/pub/irs-pdf/"], livePages: 70, include: /\.pdf$/i },
  va: { gov: "US", agency: "VA", api: "https://api.va.gov/v0/forms" },
  uscis: { gov: "US", agency: "USCIS", cdx: ["uscis.gov/sites/default/files/document/forms/*"], live: ["https://www.uscis.gov/forms/all-forms"], liveDepth: 2 },
  ssa: { gov: "US", agency: "SSA", cdx: ["ssa.gov/forms/*"], walled: true },
  grants: { gov: "US", agency: "Grants.gov", cdx: ["grants.gov/forms/*", "apply07.grants.gov/apply/forms/*", "grants.gov/web/grants/forms/*"] },
  hud: { gov: "US", agency: "HUD", cdx: ["hud.gov/sites/documents/*", "hud.gov/sites/dfiles/*"], include: /\d{3,5}/ },
  cms: { gov: "US", agency: "CMS", cdx: ["cms.gov/medicare/cms-forms/*", "cms.gov/files/document/*"] },
  dolEta: { gov: "US", agency: "DOL", cdx: ["dol.gov/sites/dolgov/files/*", "dol.gov/agencies/whd/forms/*"], live: ["https://www.dol.gov/agencies/whd/forms"] },
  fns: { gov: "US", agency: "USDA-FNS", cdx: ["fns-prod.azureedge.us/sites/default/files/*", "fns.usda.gov/sites/default/files/*"] },
  ed: { gov: "US", agency: "ED", cdx: ["studentaid.gov/sites/default/files/*", "fsapartners.ed.gov/sites/default/files/*"] },
  opm: { gov: "US", agency: "OPM", cdx: ["opm.gov/forms/*"] },
  sba: { gov: "US", agency: "SBA", cdx: ["sba.gov/sites/default/files/*", "sba.gov/document/*"] },
  gsa: { gov: "US", agency: "GSA", cdx: ["gsa.gov/cdnstatic/*", "gsa.gov/forms/*"] },
};
const chosen = SOURCE === "all" ? Object.keys(SOURCES) : SOURCE.split(",").map((s) => s.trim()).filter((s) => SOURCES[s]);
if (!CMD || !chosen.length) { console.error("usage: forms-harvest.mjs catalog|fetch|inspect [--source name|all] [--lanes 4] [--limit N]"); process.exit(2); }

const sql = neon(process.env.POLICY_DATABASE_URL);
async function ensureTable() {
  await sql`CREATE TABLE IF NOT EXISTS "Forms" (
    id bigserial PRIMARY KEY, gov text NOT NULL, agency text NOT NULL, source text NOT NULL,
    url text NOT NULL UNIQUE, wayback_ts text, digest text, s3_key text, form_number text, title text,
    bytes int, sha256 text, pages int, fillable_fields jsonb, status text NOT NULL DEFAULT 'catalogued',
    error text, catalogued_at timestamptz NOT NULL DEFAULT now(), fetched_at timestamptz, inspected_at timestamptz)`;
  await sql`CREATE INDEX IF NOT EXISTS forms_source_status_idx ON "Forms" (source, status)`;
}

/* ---- politeness: N lanes per host, browser-ish UA, Retry-After ------------- */
const lanes = new Map();
async function polite(host, fn) {
  let l = lanes.get(host); if (!l) { l = { q: Array.from({ length: LANES }, () => Promise.resolve()), i: 0 }; lanes.set(host, l); }
  const k = l.i++ % l.q.length; const run = l.q[k].then(fn, fn); l.q[k] = run.then(() => undefined, () => undefined); return run;
}
async function get(url, { timeoutMs = 60_000, accept = "*/*" } = {}) {
  const host = new URL(url).host;
  return polite(host, async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let r;
      try { r = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) }); }
      catch (e) { if (attempt === 2) return { ok: false, status: 0, error: String(e.cause?.code || e.message) }; continue; }
      if (r.status === 429 || r.status === 503) { const ra = Number(r.headers.get("retry-after") || 0); await new Promise((ok) => setTimeout(ok, Math.min(120_000, (ra > 0 ? ra : 15) * 1000))); continue; }
      if (!r.ok) return { ok: false, status: r.status, error: `HTTP ${r.status}` };
      return { ok: true, status: r.status, mime: (r.headers.get("content-type") || "").split(";")[0], body: new Uint8Array(await r.arrayBuffer()) };
    }
    return { ok: false, status: 429, error: "retried" };
  });
}

/* ---- catalog --------------------------------------------------------------- */
function looksLikeForm(url, src) {
  const p = url.replace(/^https?:\/\/[^/]+/, "");
  if (src.include && !src.include.test(p)) return false;
  if (NOT_FORM.test(p)) return false;
  return src.include ? true : FORM_PATH.test(p) || /\.pdf$/i.test(p);
}
async function cdxList(pattern) {
  const u = `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(pattern)}&filter=mimetype:application/pdf&fl=original,timestamp,digest,length&collapse=urlkey&limit=200000`;
  const r = await get(u, { timeoutMs: 180_000 });
  if (!r.ok) { log(`  cdx ${pattern}: ${r.error}`); return []; }
  return Buffer.from(r.body).toString("utf8").split("\n").filter(Boolean).map((l) => { const [original, timestamp, digest, length] = l.split(" "); return { original, timestamp, digest, length: Number(length) }; });
}
function pdfLinks(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi)) { try { out.add(new URL(m[1], base).href); } catch { /* skip */ } }
  return [...out];
}
async function catalogSource(name) {
  const src = SOURCES[name]; const rows = new Map();
  for (const pat of src.cdx ?? []) {
    const list = await cdxList(pat);
    // keep the LATEST capture per URL (collapse=urlkey gives one row per urlkey, usually the earliest — resolve the newest via a second pass per host is too costly; use what we have and let fetch prefer live)
    for (const c of list) if (looksLikeForm(c.original, src)) rows.set(c.original.replace(/^http:/, "https:"), { wayback_ts: c.timestamp, digest: c.digest });
    log(`  cdx ${pat}: ${list.length} pdfs, ${rows.size} kept so far`);
  }
  for (const idx of src.live ?? []) {
    const pages = src.livePages ? Array.from({ length: src.livePages }, (_, i) => `${idx}${idx.includes("?") ? "&" : "?"}page=${i}`) : [idx];
    let seen = 0;
    for (const p of pages) {
      const r = await get(p, { accept: "text/html" });
      if (!r.ok) { log(`  live ${p}: ${r.error}`); break; }
      const html = Buffer.from(r.body).toString("utf8");
      const links = pdfLinks(html, p);
      if (src.livePages && !links.length) break;
      for (const u of links) if (looksLikeForm(u, src) && !rows.has(u)) rows.set(u, {});
      if (src.liveDepth === 2) {
        for (const m of html.matchAll(/href=["'](\/[a-z]-\d{2,4}[a-z]?)["']/gi)) {
          const page = new URL(m[1], p).href; const r2 = await get(page, { accept: "text/html" });
          if (r2.ok) for (const u of pdfLinks(Buffer.from(r2.body).toString("utf8"), page)) if (!rows.has(u)) rows.set(u, {});
        }
      }
      seen += links.length;
    }
    log(`  live ${idx}: ${seen} pdf links`);
  }
  if (src.api) {
    const r = await get(src.api, { accept: "application/json" });
    if (r.ok) { const d = JSON.parse(Buffer.from(r.body).toString("utf8")); for (const f of d.data ?? []) { const a = f.attributes ?? {}; if (a.url) rows.set(a.url, { form_number: a.form_name, title: a.title, pages: a.pages }); } log(`  api ${src.api}: ${(d.data ?? []).length} forms`); }
    else log(`  api ${src.api}: ${r.error}`);
  }
  let n = 0;
  for (const [url, meta] of rows) {
    await sql`INSERT INTO "Forms" (gov, agency, source, url, wayback_ts, digest, form_number, title, pages)
              VALUES (${src.gov}, ${src.agency}, ${name}, ${url}, ${meta.wayback_ts ?? null}, ${meta.digest ?? null}, ${meta.form_number ?? null}, ${meta.title ?? null}, ${meta.pages ?? null})
              ON CONFLICT (url) DO UPDATE SET wayback_ts = COALESCE(EXCLUDED.wayback_ts, "Forms".wayback_ts), digest = COALESCE(EXCLUDED.digest, "Forms".digest), title = COALESCE("Forms".title, EXCLUDED.title), form_number = COALESCE("Forms".form_number, EXCLUDED.form_number)`;
    n += 1;
  }
  const jsonl = [...rows.entries()].map(([url, meta]) => JSON.stringify({ gov: src.gov, agency: src.agency, source: name, url, ...meta })).join("\n") + "\n";
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `forms-catalog/${name}.jsonl`, Body: jsonl, ContentType: "application/x-ndjson" }));
  log(`${name}: ${n} catalogued → "Forms" and s3://${BUCKET}/forms-catalog/${name}.jsonl`);
}

/* ---- fetch ------------------------------------------------------------------ */
function keyFor(src, url) {
  const base = decodeURIComponent(new URL(url).pathname.split("/").pop() || "form.pdf").replace(/[^A-Za-z0-9._-]+/g, "_");
  return `forms/${src.gov}/${src.agency}/${base}`;
}
async function fetchOne(row, src) {
  const tryLive = !src.walled;
  let got = tryLive ? await get(row.url) : { ok: false, status: 0, error: "walled" };
  let via = "live";
  const isPdf = (g) => g.ok && g.body.length > 4 && g.body[0] === 0x25 && g.body[1] === 0x50;
  if (!isPdf(got)) {
    if (!row.wayback_ts) return { status: "failed", error: `live: ${got.error ?? got.mime ?? "not a pdf"}; no archive capture` };
    got = await get(`https://web.archive.org/web/${row.wayback_ts}id_/${row.url}`, { timeoutMs: 120_000 });
    via = "archive";
    if (!isPdf(got)) return { status: "failed", error: `archive: ${got.error ?? got.mime ?? "not a pdf"}` };
  }
  const digest = sha(got.body);
  let key = keyFor(src, row.url);
  // versions accumulate: a different file under the same name gets a digest suffix
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    if (head.Metadata?.sha256 && head.Metadata.sha256 !== digest) key = key.replace(/\.pdf$/i, "") + `-${digest.slice(0, 8)}.pdf`;
  } catch { /* absent */ }
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: got.body, ContentType: "application/pdf", Metadata: { sha256: digest, source: row.url.slice(0, 900), via } }));
  return { status: `fetched-${via}`, s3_key: key, bytes: got.body.length, sha256: digest };
}
async function fetchSource(name) {
  const src = SOURCES[name];
  const rows = await sql`SELECT id, url, wayback_ts FROM "Forms" WHERE source = ${name} AND status = 'catalogued' ORDER BY id ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;
  log(`${name}: ${rows.length} to fetch (${src.walled ? "archive" : "live, archive fallback"})`);
  let done = 0, ok = 0, failed = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: LANES * 2 }, async () => {
    for (;;) {
      const row = rows[done++]; if (!row) return;
      const r = await fetchOne(row, src);
      if (r.status.startsWith("fetched")) { ok += 1; await sql`UPDATE "Forms" SET status = ${r.status}, s3_key = ${r.s3_key}, bytes = ${r.bytes}, sha256 = ${r.sha256}, error = NULL, fetched_at = now() WHERE id = ${row.id}`; }
      else { failed += 1; await sql`UPDATE "Forms" SET status = 'failed', error = ${r.error}, fetched_at = now() WHERE id = ${row.id}`; }
      if ((ok + failed) % 200 === 0) log(`  ${name}: ${ok} fetched, ${failed} failed, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    }
  }));
  log(`${name} done: ${ok} fetched, ${failed} failed, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

/* ---- inspect ---------------------------------------------------------------- */
function run(cmd, args, input) { return new Promise((res) => { const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] }); let out = ""; p.stdout.on("data", (b) => { out += b; }); p.on("close", () => res(out)); p.on("error", () => res("")); if (input) p.stdin.end(input); else p.stdin.end(); }); }
async function inspectSource(name) {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const rows = await sql`SELECT id, s3_key, url FROM "Forms" WHERE source = ${name} AND status LIKE 'fetched%' AND inspected_at IS NULL ORDER BY id ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;
  log(`${name}: ${rows.length} to inspect`);
  let n = 0;
  for (const row of rows) {
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: row.s3_key }));
    const bytes = Buffer.from(await obj.Body.transformToByteArray());
    const info = await run("pdfinfo", ["-"], bytes);
    const pages = Number((/Pages:\s+(\d+)/.exec(info) || [])[1] || 0) || null;
    const title = ((/Title:\s+(.+)/.exec(info) || [])[1] || "").trim() || null;
    // AcroForm field names: pdftotext cannot; a cheap scan of the raw PDF for /T (name) entries covers most fillable forms.
    const fields = [...new Set([...bytes.toString("latin1").matchAll(/\/T\s*\(([^)]{1,80})\)/g)].map((m) => m[1]))].slice(0, 500);
    const formNumber = ((/\b(LDSS-\d{3,5}[A-Z]?|OCFS-\d{3,5}[A-Z-]*|DOH-\d{3,5}[A-Z]?|IT-\d{3,4}[A-Z-]*|SSA-\d{2,5}[A-Z-]*|I-\d{3}[A-Z]?|N-\d{3}[A-Z]?|VA\s?\d{2}-\d{3,5}[A-Z]?|SF-?\d{2,4}[A-Z]?|HUD-?\d{3,5}[A-Z-]*|CMS-?\d{3,5}[A-Z-]*|f\d{3,5}[a-z]*)\b/i.exec(`${row.url} ${title ?? ""}`) || [])[1] || null);
    await sql`UPDATE "Forms" SET pages = COALESCE(${pages}, pages), title = COALESCE(title, ${title}), form_number = COALESCE(form_number, ${formNumber}), fillable_fields = ${JSON.stringify(fields)}::jsonb, inspected_at = now() WHERE id = ${row.id}`;
    n += 1;
    if (n % 200 === 0) log(`  ${name}: ${n} inspected`);
  }
  log(`${name}: ${n} inspected`);
}

await ensureTable();
for (const name of chosen) {
  log(`== ${CMD} ${name} (${SOURCES[name].gov} ${SOURCES[name].agency})`);
  if (CMD === "catalog") await catalogSource(name);
  else if (CMD === "fetch") await fetchSource(name);
  else if (CMD === "inspect") await inspectSource(name);
  else { console.error(`unknown command ${CMD}`); process.exit(2); }
}
log("done");

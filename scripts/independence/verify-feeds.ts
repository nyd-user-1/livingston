// scripts/independence/verify-feeds.ts — lane IN, step 1.
//
// "Do not guess; a row you could not verify says so." This fetches ONE artifact from each
// jurisdiction's candidate structured feed / bulk download and records what actually came
// back: HTTP status, content-type, byte count, and a sniff of the first bytes so a page that
// returns 200 with an HTML error body cannot masquerade as a working JSON feed.
//
// It reuses api/_lib/polite-fetch.ts rather than reimplementing manners (ORCHESTRATION §4:
// one definition, imported). robots.txt is obeyed; a disallowed URL is a reported outcome,
// not something to route around.
//
//   node --experimental-strip-types scripts/independence/verify-feeds.ts <feeds.json> <out.json>

import { readFileSync, writeFileSync } from "node:fs";
import { PoliteFetcher } from "../../api/_lib/polite-fetch.ts";

type Row = [string, string, string, string]; // state, description, url, declared format

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error("usage: verify-feeds.ts <feeds.json> <out.json>"); process.exit(2); }

const rows: Row[] = JSON.parse(readFileSync(inPath, "utf8"));

// Secrets are substituted here and never logged. NYS_LEGISLATION_API_KEY is a free key.
const NYS = process.env.NYS_LEGISLATION_API_KEY ?? "";
const subst = (u: string) => u.replace("KEY_NYS", NYS);
const redact = (u: string) => (NYS ? u.split(NYS).join("<KEY>") : u);

function sniff(b: Uint8Array | null): string {
  if (!b || b.length === 0) return "empty";
  const head = Buffer.from(b.subarray(0, 400)).toString("latin1");
  if (head.startsWith("PK\x03\x04")) return "zip";
  if (head.startsWith("%PDF")) return "pdf";
  const t = head.replace(/^﻿/, "").trimStart();
  if (t.startsWith("{") || t.startsWith("[")) return "json-ish";
  if (/^<\?xml/i.test(t)) return "xml";
  if (/^<(!doctype\s+html|html)\b/i.test(t)) return "html";
  if (t.startsWith("<")) return "xml-ish";
  if (/^[\w"'][^\n]*,[^\n]*,/.test(t)) return "csv-ish";
  return "other:" + JSON.stringify(t.slice(0, 40));
}

const pf = new PoliteFetcher({ minDelayMs: 1500 });
const out: any[] = [];

for (const [state, desc, url, fmt] of rows) {
  const started = Date.now();
  let r;
  try {
    r = await pf.get(subst(url));
  } catch (e: any) {
    r = { ok: false, status: 0, mime: "", body: null, bytes: 0, error: String(e?.message ?? e) };
  }
  const rec = {
    state, desc, url: redact(url), declared: fmt,
    status: r.status, mime: r.mime, bytes: r.bytes,
    sniff: sniff(r.body), skipped: (r as any).skipped ?? null,
    error: r.error ? redact(String(r.error)) : null,
    ms: Date.now() - started,
    // "verified" means: 2xx AND the body actually looks like a machine-readable artifact.
    verified: r.ok && ["json-ish", "xml", "xml-ish", "zip", "csv-ish"].includes(sniff(r.body)),
  };
  out.push(rec);
  console.log(
    `${state.padEnd(3)} ${String(rec.status).padEnd(4)} ${String(rec.bytes).padStart(9)}B  ` +
    `${rec.sniff.padEnd(12)} ${rec.verified ? "VERIFIED" : "        "} ${rec.mime.slice(0, 28).padEnd(28)} ${rec.error ?? ""}`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 1));
}
console.log(`\n${out.filter((r) => r.verified).length}/${out.length} verified as structured artifacts`);
console.table(pf.stats().filter((s) => s.dropped || s.strikes).map((s) => ({ host: s.host, strikes: s.strikes, dropped: s.dropped })));

#!/usr/bin/env node
// scripts/independence/load-people.mjs — lane IN, step 4 (people).
//
// Loads openstates/people (CC0-1.0) YAML into openstates.people, and — the question the brief
// actually asks — works out whether the open route carries the EXTERNAL IDs LegiScan gave us
// (VoteSmart, Ballotpedia, bioguide, OpenSecrets, FEC).
//
// It does not only read the `ids:` block, because in this repo that block is almost entirely
// social media. The external ids are present but *encoded in URLs* — a Ballotpedia link under
// `sources:`, a VoteSmart candidate id inside a justfacts URL, a bioguide id inside the
// unitedstates.github.io image path. Reading only `ids:` would have produced a confident 0%
// and it would have been wrong, so every URL on the record is mined too.
//
//   node scripts/independence/load-people.mjs --root ~/src/people/data [--states nj,ny,us]

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ROOT = opt("--root");
const ONLY = (opt("--states") || "").split(",").filter(Boolean);
if (!ROOT) { console.error("need --root <people/data>"); process.exit(2); }

// YAML is parsed with the `yaml` package, not by hand. My first version was a 25-line
// indent-tracking parser; it loaded all 7,975 records with exit 0 and set `district` and
// `chamber` to NULL on every single one, because it mishandled the nested `roles:` list.
// A loader that reports success while producing nulls is the failure this program keeps
// meeting (ORCHESTRATION §9), and the fix is to stop hand-rolling the easy-looking part.
import YAML from "yaml";
const parseYaml = (txt) => YAML.parse(txt);

function externalIds(txt) {
  const out = {};
  let m;
  if ((m = txt.match(/ballotpedia\.org\/([^\s"']+)/i))) out.ballotpedia = decodeURIComponent(m[1]);
  if ((m = txt.match(/votesmart\.org\/candidate(?:\/biography)?\/(\d+)/i))) out.votesmart = m[1];
  if ((m = txt.match(/justfacts\.votesmart\.org\/candidate\/[^/]*\/(\d+)/i))) out.votesmart = m[1];
  if ((m = txt.match(/bioguide(?:\.congress\.gov)?[^\s"']*?([A-Z]\d{6})/))) out.bioguide = m[1];
  if ((m = txt.match(/images\/congress\/[^\s"']*\/([A-Z]\d{6})\./))) out.bioguide = m[1];
  if ((m = txt.match(/opensecrets\.org\/[^\s"']*?(N\d{8})/i))) out.opensecrets = m[1];
  if ((m = txt.match(/fec\.gov\/data\/candidate\/([A-Z0-9]{9})/i))) out.fec = m[1];
  if ((m = txt.match(/^\s+twitter:\s*(\S+)/m))) out.twitter = m[1];
  if ((m = txt.match(/en\.wikipedia\.org\/wiki\/([^\s"']+)/i))) out.wikipedia = decodeURIComponent(m[1]);
  return out;
}

const c = new pg.Client({ connectionString: process.env.POLICY_DATABASE_URL });
await c.connect();
await c.query(`CREATE TABLE IF NOT EXISTS openstates.people (
  os_person_id text PRIMARY KEY, name text, given_name text, family_name text, state text,
  chamber text, district text, party text, ids jsonb, is_current boolean)`);

const rows = [];
const stats = { files: 0, states: 0, with_any_id: 0, by_id: {} };
for (const st of readdirSync(ROOT)) {
  if (ONLY.length && !ONLY.includes(st)) continue;
  const d = join(ROOT, st, "legislature");
  if (!existsSync(d)) continue;
  stats.states++;
  for (const f of readdirSync(d)) {
    if (!f.endsWith(".yml")) continue;
    const txt = readFileSync(join(d, f), "utf8");
    stats.files++;
    const y = parseYaml(txt);
    const role = Array.isArray(y.roles) ? y.roles[y.roles.length - 1] : null;
    const ids = externalIds(txt);
    if (Object.keys(ids).length) stats.with_any_id++;
    for (const k of Object.keys(ids)) stats.by_id[k] = (stats.by_id[k] || 0) + 1;
    rows.push({
      os_person_id: y.id, name: y.name, given_name: y.given_name, family_name: y.family_name,
      state: st.toUpperCase(),
      chamber: role?.type === "upper" ? "S" : role?.type === "lower" ? "H" : (role?.type ?? null),
      district: role?.district ?? null,
      party: Array.isArray(y.party) ? (y.party[y.party.length - 1]?.name ?? null) : null,
      ids: JSON.stringify(ids), is_current: true,
    });
  }
}
const cols = ["os_person_id","name","given_name","family_name","state","chamber","district","party","ids","is_current"];
for (let i = 0; i < rows.length; i += 400) {
  const ch = rows.slice(i, i + 400).filter((r) => r.os_person_id);
  if (!ch.length) continue;
  const vals = []; const ph = ch.map((r, j) => "(" + cols.map((_, k) => `$${j * cols.length + k + 1}`).join(",") + ")").join(",");
  for (const r of ch) for (const k of cols) vals.push(r[k] ?? null);
  await c.query(`INSERT INTO openstates.people (${cols.join(",")}) VALUES ${ph} ON CONFLICT (os_person_id) DO NOTHING`, vals);
}
console.log(JSON.stringify({ loaded: rows.length, ...stats }, null, 1));
await c.end();

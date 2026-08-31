// roster-sync: getSessionPeople for every jurisdiction's current session.
// Writes: People (upsert, full person fields incl. committee_id) and
// "SessionPeople" (session_id, people_id) — the actual roster of a session.
// Run: node scripts/roster-sync.mjs   (needs POLICY_DATABASE_URL, LEGISCAN_API_KEY)
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.POLICY_DATABASE_URL);
const KEY = process.env.LEGISCAN_API_KEY;
if (!KEY) { console.error("no LEGISCAN_API_KEY"); process.exit(1); }
const lowerHouse = (st) => ["NY","CA","NV","NJ","WI"].includes(st) ? "Assembly" : "House";
const idOrNull = (v) => (Number(v) > 0 ? Number(v) : null);
const strOrNull = (v) => (v ? String(v) : null);
await sql`CREATE TABLE IF NOT EXISTS "SessionPeople" (
  session_id bigint NOT NULL, people_id bigint NOT NULL, state text NOT NULL, year int,
  PRIMARY KEY (session_id, people_id))`;
await sql`CREATE INDEX IF NOT EXISTS sessionpeople_state_year_idx ON "SessionPeople" (state, year)`;
const sessions = await sql`
  select distinct on (state) state, session_id, year
  from "LegiscanDatasets"
  order by state, (coalesce(special,0) = 0) desc, year desc`;
console.log("sessions:", sessions.length);
const results = [];
const queue = [...sessions];
async function worker() {
  for (;;) {
    const s = queue.shift();
    if (!s) return;
    try {
      const r = await fetch(`https://api.legiscan.com/?key=${KEY}&op=getSessionPeople&id=${s.session_id}`);
      const j = await r.json();
      if (j.status !== "OK") { results.push([s.state, "API:" + (j.alert?.message ?? j.status)]); continue; }
      const people = j.sessionpeople?.people ?? [];
      let humans = 0, committees = 0;
      for (const p of people) {
        const cid = Number(p.committee_id ?? 0);
        if (cid > 0) committees++; else humans++;
        const chamber = String(p.role ?? "") === "Sen" ? "Senate" : String(p.role ?? "") === "Rep" ? lowerHouse(s.state) : null;
        await sql`
          insert into "People" (people_id, state, name, first_name, middle_name, last_name,
            party_id, party, role_id, role, district, chamber, committee_id,
            votesmart_id, opensecrets_id, ballotpedia, followthemoney_eid, knowwho_pid,
            bioguide_id, nickname, suffix, person_hash)
          values (${Number(p.people_id)}, ${s.state}, ${String(p.name ?? "")}, ${String(p.first_name ?? "")},
            ${String(p.middle_name ?? "") || null}, ${String(p.last_name ?? "")},
            ${Number(p.party_id ?? 0) || null}, ${String(p.party ?? "") || null},
            ${Number(p.role_id ?? 0) || null}, ${String(p.role ?? "") || null},
            ${String(p.district ?? "") || null}, ${chamber}, ${cid > 0 ? String(cid) : null},
            ${idOrNull(p.votesmart_id)}, ${strOrNull(p.opensecrets_id)}, ${strOrNull(p.ballotpedia)},
            ${idOrNull(p.ftm_eid)}, ${idOrNull(p.knowwho_pid)}, ${strOrNull(p.bioguide_id)},
            ${strOrNull(p.nickname)}, ${strOrNull(p.suffix)}, ${strOrNull(p.person_hash)})
          on conflict (people_id) do update set
            state = excluded.state, name = excluded.name, first_name = excluded.first_name,
            middle_name = excluded.middle_name, last_name = excluded.last_name,
            party_id = excluded.party_id, party = excluded.party, role_id = excluded.role_id,
            role = excluded.role, district = excluded.district, chamber = excluded.chamber,
            committee_id = excluded.committee_id,
            votesmart_id = coalesce(excluded.votesmart_id, "People".votesmart_id),
            opensecrets_id = coalesce(excluded.opensecrets_id, "People".opensecrets_id),
            ballotpedia = coalesce(excluded.ballotpedia, "People".ballotpedia),
            followthemoney_eid = coalesce(excluded.followthemoney_eid, "People".followthemoney_eid),
            knowwho_pid = coalesce(excluded.knowwho_pid, "People".knowwho_pid),
            bioguide_id = coalesce(excluded.bioguide_id, "People".bioguide_id),
            nickname = coalesce(excluded.nickname, "People".nickname),
            suffix = coalesce(excluded.suffix, "People".suffix),
            person_hash = excluded.person_hash`;
        if (cid === 0) await sql`
          insert into "SessionPeople" (session_id, people_id, state, year)
          values (${Number(s.session_id)}, ${Number(p.people_id)}, ${s.state}, ${Number(s.year)})
          on conflict do nothing`;
      }
      results.push([s.state, `ok ${humans} people, ${committees} committee-entities, session ${s.session_id}/${s.year}`]);
    } catch (e) { results.push([s.state, "ERR " + e.message.slice(0, 80)]); }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
results.sort((a, b) => a[0].localeCompare(b[0]));
for (const [st, msg] of results) console.log(st, msg);
const tot = await sql`select count(*)::int as roster, count(distinct state)::int as states from "SessionPeople"`;
console.log("SessionPeople:", JSON.stringify(tot));

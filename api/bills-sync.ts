// /api/bills-sync — keep policy's Neon `Bills` current from the NY Senate.
//
// Policy's data moved from Supabase to Neon on 2026-08-18 and the edge
// function that used to sync it stayed behind, so the table froze at the copy.
// This is that sync, on Vercel: every morning (vercel.json crons) pull every
// bill whose last action is newer than the newest one on record and upsert
// it, with its primary sponsor. Same ids, same status codes, same columns as
// the old function wrote (policy's UI reads them unchanged).
//
//   GET /api/bills-sync?secret=…[&since=YYYY-MM-DD][&session=2025][&pages=20]
//   (the cron sends `Authorization: Bearer $CRON_SECRET` instead)
//
// Env: NYS_LEGISLATION_API_KEY, POLICY_DATABASE_URL (policy-nysgpt on Neon),
//      CRON_SECRET.
//
// Not synced here: co-sponsors, the action history and votes — those need
// the per-bill detail view (one request per bill); the list view carries
// everything else. Left for the policy rewrite lane.

import { neon } from "@neondatabase/serverless";

export const config = { maxDuration: 120 };

const API = "https://legislation.nysenate.gov/api/3";
const PAGE = 100;

const currentSession = () => {
  const y = new Date().getFullYear();
  return y % 2 === 1 ? y : y - 1;
};

/** The old function's status codes — policy's UI filters on them. */
const STATUS_CODE: Record<string, number> = {
  INTRODUCED: 1,
  IN_ASSEMBLY_COMM: 2,
  IN_SENATE_COMM: 2,
  ASSEMBLY_FLOOR: 3,
  SENATE_FLOOR: 3,
  PASSED_ASSEMBLY: 4,
  PASSED_SENATE: 4,
  DELIVERED_TO_GOV: 5,
  SIGNED_BY_GOV: 6,
  ADOPTED: 6,
  VETOED: 7,
  SUBSTITUTED: 8,
  STRICKEN: 9,
};

/** `S00256` → `S256`, as the table stores them. */
const normalisePrintNo = (p: string) => {
  const m = p.trim().toUpperCase().match(/^([A-Z])(\d+)([A-Z]?)$/);
  return m ? `${m[1]}${m[2].replace(/^0+/, "") || "0"}${m[3]}` : p.toUpperCase();
};

/** The id the old function minted for a bill it had never seen: session·10⁶ + (A: 500 000) + number. */
const mintId = (printNo: string, session: number) => {
  const m = printNo.match(/^([A-Z])(\d+)/);
  const n = m ? Number(m[2]) : 0;
  return session * 1_000_000 + (m?.[1] === "A" ? 500_000 : 0) + n;
};

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** API district 8 + SENATE → `SD-008`, the form `People.district` uses. */
const dbDistrict = (code: unknown, chamber: unknown) => {
  const n = Number(code);
  if (!Number.isFinite(n) || !n) return null;
  const c = String(chamber ?? "").toUpperCase();
  return `${c === "SENATE" ? "SD" : c === "ASSEMBLY" ? "HD" : ""}-${String(n).padStart(3, "0")}`;
};

interface Person {
  people_id: number;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  district: string | null;
}

/** The old function's match ladder: district + last name, then full name, then first + last. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchPerson(people: Person[], member: any): number | null {
  if (!member) return null;
  const last = stripAccents(String(member.lastName ?? ""));
  const first = stripAccents(String(member.firstName ?? ""));
  const full = stripAccents(String(member.fullName ?? member.shortName ?? ""));
  const district = dbDistrict(member.districtCode, member.chamber);
  const byDistrict = last && district && people.find((p) => p.district === district && stripAccents(p.last_name ?? "") === last);
  if (byDistrict) return Number(byDistrict.people_id);
  const byFull = full && people.find((p) => stripAccents(p.name ?? "") === full);
  if (byFull) return Number(byFull.people_id);
  const byNames = first && last && people.find((p) => stripAccents(p.first_name ?? "") === first && stripAccents(p.last_name ?? "") === last);
  return byNames ? Number(byNames.people_id) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  const secret = process.env.CRON_SECRET;
  const given = String(req.headers?.authorization ?? "").replace(/^Bearer\s+/i, "") || String(req.query?.secret ?? "");
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not set" });
  if (given !== secret) return res.status(401).json({ error: "unauthorised" });
  const key = process.env.NYS_LEGISLATION_API_KEY;
  const dbUrl = process.env.POLICY_DATABASE_URL;
  if (!key || !dbUrl) return res.status(503).json({ error: "NYS_LEGISLATION_API_KEY and POLICY_DATABASE_URL are both required" });

  const sql = neon(dbUrl);
  const session = Number(req.query?.session) || currentSession();
  const maxPages = Math.min(50, Math.max(1, Number(req.query?.pages ?? 20) || 20));
  const t0 = Date.now();

  try {
    // Since when: the newest action on record, less a day of slack (the API's
    // actionDate is a date, and a bill can move twice in one).
    let since = String(req.query?.since ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
      // A LegiScan row with a future last_action_date once put `since` in October and this
      // sync fetched nothing for weeks — ignore dates past today, and never start in the future.
      const [row] = await sql.query(`SELECT max(last_action_date) AS d FROM "Bills" WHERE session_id = $1 AND last_action_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND last_action_date::date <= current_date`, [session]);
      const d = row?.d ? new Date(row.d) : new Date(Date.now() - 30 * 86_400_000);
      d.setUTCDate(d.getUTCDate() - 1);
      const yesterday = new Date(Date.now() - 86_400_000);
      since = (d > yesterday ? yesterday : d).toISOString().slice(0, 10);
    }

    // Newest action first, until we pass `since`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = [];
    let pages = 0;
    let done = false;
    for (let offset = 1; !done && pages < maxPages; offset += PAGE) {
      const r = await fetch(
        `${API}/bills/${session}?limit=${PAGE}&offset=${offset}&sort=status.actionDate:DESC&key=${key}`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) },
      );
      if (!r.ok) throw new Error(`NY Senate API answered ${r.status}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await r.json();
      const page = data?.result?.items ?? [];
      pages += 1;
      for (const b of page) {
        const actionDate = String(b?.status?.actionDate ?? "").slice(0, 10);
        if (actionDate && actionDate < since) {
          done = true;
          break;
        }
        if (b?.basePrintNo) items.push(b);
      }
      if (page.length < PAGE) done = true;
    }

    if (!items.length) {
      return res.status(200).json({ ok: true, session, since, fetched: 0, upserted: 0, pages, ms: Date.now() - t0 });
    }

    // Existing ids by print number (older rows carry LegiScan ids, newer ones
    // the minted form — either way the row's own id wins over a fresh mint).
    const known = await sql.query(`SELECT bill_id, bill_number FROM "Bills" WHERE session_id = $1`, [session]);
    const idOf = new Map<string, number>(known.map((r) => [String(r.bill_number), Number(r.bill_id)]));
    const people = (await sql.query(
      `SELECT people_id, name, first_name, last_name, district FROM "People" WHERE archived IS NOT TRUE`,
    )) as Person[];

    const rows = items.map((b) => {
      const printNo = normalisePrintNo(String(b.basePrintNo));
      const status = b.status ?? {};
      const committee = status.committeeName ? String(status.committeeName) : null;
      const actionDate = status.actionDate ? String(status.actionDate).slice(0, 10) : String(b.publishedDateTime ?? "").slice(0, 10) || null;
      return {
        bill_id: idOf.get(printNo) ?? mintId(printNo, session),
        session_id: session,
        bill_number: printNo,
        status: STATUS_CODE[String(status.statusType ?? "")] ?? 0,
        status_desc: String(status.statusDesc ?? status.statusType ?? "Unknown"),
        status_date: actionDate,
        title: String(b.title ?? "Untitled Bill"),
        description: String(b.summary ?? b.title ?? "") || null,
        committee_id: committee ? committee.toLowerCase().replace(/\s+/g, "-") : null,
        committee,
        last_action_date: actionDate,
        last_action: String(status.statusDesc ?? status.statusType ?? "Introduced"),
        url: `${API}/bills/${session}/${printNo}`,
        state_link: `https://www.nysenate.gov/legislation/bills/${session}/${printNo}`,
        sponsor: matchPerson(people, b.sponsor?.member),
        sponsorName: String(b.sponsor?.member?.fullName ?? ""),
      };
    });

    // One statement per batch: the columns as parallel arrays, unnested.
    const col = <K extends keyof (typeof rows)[number]>(k: K) => rows.map((r) => r[k]);
    await sql.query(
      `INSERT INTO "Bills" (bill_id, session_id, bill_number, status, status_desc, status_date, title, description,
                            committee_id, committee, last_action_date, last_action, url, state_link)
       SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::bigint[], $5::text[], $6::text[], $7::text[], $8::text[],
                            $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[])
       ON CONFLICT (bill_id) DO UPDATE SET
         status = EXCLUDED.status, status_desc = EXCLUDED.status_desc, status_date = EXCLUDED.status_date,
         title = EXCLUDED.title, description = EXCLUDED.description, committee_id = EXCLUDED.committee_id,
         committee = EXCLUDED.committee, last_action_date = EXCLUDED.last_action_date, last_action = EXCLUDED.last_action,
         url = EXCLUDED.url, state_link = EXCLUDED.state_link`,
      [
        col("bill_id"), col("session_id"), col("bill_number"), col("status"), col("status_desc"), col("status_date"),
        col("title"), col("description"), col("committee_id"), col("committee"), col("last_action_date"), col("last_action"),
        col("url"), col("state_link"),
      ],
    );

    // Primary sponsor (position 1) only — co-sponsors live in the detail view.
    const sponsored = rows.filter((r) => r.sponsor !== null);
    if (sponsored.length) {
      await sql.transaction([
        sql.query(`DELETE FROM "Sponsors" WHERE position = 1 AND bill_id = ANY($1::bigint[])`, [sponsored.map((r) => r.bill_id)]),
        sql.query(
          `INSERT INTO "Sponsors" (bill_id, people_id, position) SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::bigint[])`,
          [sponsored.map((r) => r.bill_id), sponsored.map((r) => r.sponsor), sponsored.map(() => 1)],
        ),
      ]);
    }
    const unmatched = [...new Set(rows.filter((r) => r.sponsor === null && r.sponsorName).map((r) => r.sponsorName))];

    return res.status(200).json({
      ok: true,
      session,
      since,
      pages,
      fetched: items.length,
      upserted: rows.length,
      newIds: rows.filter((r) => !idOf.has(r.bill_number)).length,
      sponsorsLinked: sponsored.length,
      unmatchedSponsors: unmatched.slice(0, 20),
      newest: rows[0]?.last_action_date ?? null,
      ms: Date.now() - t0,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message, session, ms: Date.now() - t0 });
  }
}

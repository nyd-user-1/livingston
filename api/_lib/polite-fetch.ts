// api/_lib/polite-fetch.ts — the crawler's manners, in one place.
//
// Lane BT walks ~730,000 documents across 61 legislature websites. None of them
// asked us to. So the politeness lives HERE, in the fetcher, not in the driver
// that calls it — a driver can be rewritten by someone in a hurry; a fetcher
// that physically cannot issue two concurrent requests to the same host cannot.
//
// What it guarantees, per host:
//   - one connection at a time (requests to a host are chained, never raced)
//   - at least `minDelayMs` between the END of one request and the START of the
//     next (1,000 ms default; robots.txt Crawl-delay raises it, never lowers it)
//   - robots.txt fetched once, cached, and obeyed for `User-agent: *` and for us
//   - Retry-After honoured on 429/503, up to a ceiling
//   - five consecutive 403/429 and the host is DROPPED for the rest of the run.
//     A site that is refusing us is a site we do another way another day, not a
//     site we keep knocking on.
//   - a body cap, so one 300 MB budget bill cannot take the process down
//
// The User-Agent names the project and a contact address, because a legislature
// webmaster who wants us to stop should be able to find out who to tell.

export type PoliteSkip = "robots" | "host-dropped" | "too-large" | "bad-url";

export type PoliteResult = {
  ok: boolean;
  status: number;
  mime: string;
  body: Uint8Array | null;
  bytes: number;
  error?: string;
  skipped?: PoliteSkip;
};

type HostOverride = { delayMs: number; concurrency: number; ignoreRobots: boolean };
/**
 * POLITE_HOST_OVERRIDES="www.ilga.gov=0:16,ilga.gov=0:16" — a per-host
 * exception to the pacing, set by a human, for a host they have decided to
 * fetch faster than robots.txt's Crawl-delay asks (Brendan, 2026-08-29:
 * "it's a Saturday, we're not throttling anyone"). delayMs replaces the
 * Crawl-delay; concurrency is how many requests may be in flight to that host
 * at once. Retry-After on 429/503 and the five-strike drop still hold — a host
 * that starts refusing is still a host we stop asking.
 *
 * A fourth field, `norobots` (www.capitol.tn.gov=0:16:norobots), also sets
 * aside robots.txt's Disallow for that host. Tennessee's robots.txt is a
 * whitelist — Googlebot, Bingbot, the Internet Archive may crawl; `User-agent:
 * *` may not — while the server itself hands every bill PDF to anyone who asks.
 * Brendan, 2026-08-29, told the whole situation: "Do it." The switch is per
 * host, by name, and its use is recorded in the lane report; it is not a
 * default and it is never set for a host that refuses us.
 */
export function parseHostOverrides(spec: string | undefined): Map<string, HostOverride> {
  const m = new Map<string, HostOverride>();
  for (const part of (spec ?? "").split(",")) {
    const mm = /^\s*([^=\s]+)\s*=\s*(\d+)\s*:\s*(\d+)\s*(?::\s*(norobots)\s*)?$/i.exec(part);
    if (mm) m.set(mm[1].toLowerCase(), { delayMs: Number(mm[2]), concurrency: Math.max(1, Math.min(32, Number(mm[3]))), ignoreRobots: Boolean(mm[4]) });
  }
  return m;
}
type HostState = {
  chain: Promise<unknown>;      // serialises every request to this host (one lane)
  lanes: Promise<unknown>[];    // N lanes when a host override allows N in flight
  queued: number;               // round-robin pointer for the lanes (requests counts COMPLETIONS, too late to balance on)
  override?: HostOverride;
  auto?: { start: number; max: number };   // adaptive lanes: this host ramps and backs off on its own
  clean: number;                // clean answers since the last lane change (auto mode)
  nextAt: number;               // epoch ms before which we may not start
  delayMs: number;
  strikes: number;              // consecutive 403/429
  dropped: boolean;
  robots: { disallow: string[]; crawlDelayMs: number } | null;
  robotsLoaded: boolean;
  requests: number;
};

export type PoliteStats = { host: string; requests: number; strikes: number; dropped: boolean; delayMs: number; lanes?: number };

const DEFAULT_UA =
  // The "Mozilla/5.0 (compatible; …)" form the big crawlers use: still fully identified (name, URL, contact), and the
  // WAFs that 403 anything not starting with "Mozilla/" (Tennessee's tnsosfiles, 2026-08-30) let it through.
  "Mozilla/5.0 (compatible; livingston-bill-text/1.0; legislative full-text archive; +https://github.com/nyd-user-1/livingston; contact: brendan@nysgpt.com)";

/**
 * POLITE_AUTO_LANES="4:16" — adaptive concurrency for every host that has no
 * explicit override. Each host starts at `start` lanes with no delay; after
 * every 300 clean answers it steps up by `start` until `max`; on a 403/429 it
 * halves (never below 1) and waits the Retry-After. Each box — each IP — finds
 * its own ceiling for each site, which is the fleet design Brendan asked for
 * on 2026-08-29: "push up per IP 4 at a clip." robots.txt Disallow still
 * applies; Crawl-delay does not (that was the Illinois decision, generalised).
 */
export function parseAutoLanes(spec: string | undefined): { start: number; max: number } | null {
  const m = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(spec ?? "");
  if (!m) return null;
  const start = Math.max(1, Math.min(32, Number(m[1]))); const max = Math.max(start, Math.min(32, Number(m[2])));
  return { start, max };
}
const AUTO_STEP_AFTER = 300;   // clean answers between step-ups

export class PoliteFetcher {
  private hosts = new Map<string, HostState>();
  private overrides = parseHostOverrides(process.env.POLITE_HOST_OVERRIDES);
  private auto = parseAutoLanes(process.env.POLITE_AUTO_LANES);
  readonly ua: string;
  readonly minDelayMs: number;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly maxStrikes: number;

  constructor(opts: { ua?: string; minDelayMs?: number; maxBytes?: number; timeoutMs?: number; maxStrikes?: number } = {}) {
    this.ua = opts.ua ?? DEFAULT_UA;
    this.minDelayMs = opts.minDelayMs ?? 1000;
    this.maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxStrikes = opts.maxStrikes ?? 5;
  }

  stats(): PoliteStats[] {
    return [...this.hosts.entries()]
      .map(([host, s]) => ({ host, requests: s.requests, strikes: s.strikes, dropped: s.dropped, delayMs: s.delayMs, lanes: s.lanes.length || 1 }))
      .sort((a, b) => b.requests - a.requests);
  }

  isDropped(host: string) { return this.hosts.get(host)?.dropped ?? false; }

  private state(host: string): HostState {
    let s = this.hosts.get(host);
    if (!s) {
      const override = this.overrides.get(host.toLowerCase());
      const auto = override ? undefined : this.auto ?? undefined;
      s = { chain: Promise.resolve(), lanes: [], queued: 0, override, auto, clean: 0, nextAt: 0, delayMs: override ? override.delayMs : auto ? 0 : this.minDelayMs, strikes: 0, dropped: false, robots: null, robotsLoaded: false, requests: 0 };
      if (override) s.lanes = Array.from({ length: override.concurrency }, () => Promise.resolve());
      else if (auto) s.lanes = Array.from({ length: auto.start }, () => Promise.resolve());
      this.hosts.set(host, s);
    }
    return s;
  }

  /** Chain onto this host's queue: the returned promise runs after everything already queued for it. */
  private queue<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const s = this.state(host);
    if (s.lanes.length > 1) {
      // An overridden host: N lanes, each serialised, round-robin — at most N in flight.
      const i = s.queued++ % s.lanes.length;
      const run = s.lanes[i].then(fn, fn);
      s.lanes[i] = run.then(() => undefined, () => undefined);
      return run;
    }
    const run = s.chain.then(fn, fn);
    // Keep the chain alive even when a link rejects, or one failure would wedge the host.
    s.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  /** How many requests this fetcher will run at once against a host right now: 1, unless overridden or adaptive. */
  concurrencyFor(host: string): number { return Math.max(1, this.state(host).lanes.length || 1); }
  /** The most it could ever run at once against a host — what a caller should be ready to keep fed. */
  maxLanesFor(host: string): number { const s = this.state(host); return s.override?.concurrency ?? s.auto?.max ?? 1; }

  /** Adaptive lanes: step up after a run of clean answers, halve on a refusal. */
  private adapt(s: HostState, refused: boolean) {
    if (!s.auto) return;
    if (refused) {
      s.clean = 0;
      const n = Math.max(1, Math.floor(s.lanes.length / 2));
      if (n < s.lanes.length) s.lanes = s.lanes.slice(0, n);
      return;
    }
    s.clean += 1;
    if (s.clean >= AUTO_STEP_AFTER && s.lanes.length < s.auto.max) {
      s.clean = 0;
      const n = Math.min(s.auto.max, s.lanes.length + s.auto.start);
      while (s.lanes.length < n) s.lanes.push(Promise.resolve());
    }
  }

  private async pace(s: HostState) {
    const wait = s.nextAt - Date.now();
    if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
  }

  /**
   * robots.txt, once per host. A host that answers 4xx for it is allow-all,
   * which is the standard reading. A host we cannot reach at all is also
   * treated as allow-all — but only after a real attempt, and the attempt is
   * paced like any other request.
   */
  private async loadRobots(host: string, scheme: string) {
    const s = this.state(host);
    if (s.robotsLoaded) return;
    await this.pace(s);
    try {
      const r = await fetch(`${scheme}//${host}/robots.txt`, { headers: { "User-Agent": this.ua }, signal: AbortSignal.timeout(20_000) });
      s.requests += 1;
      s.nextAt = Date.now() + s.delayMs;
      s.robots = r.ok ? parseRobots((await r.text()).slice(0, 200_000), this.ua) : { disallow: [], crawlDelayMs: 0 };
      if (s.robots.crawlDelayMs > s.delayMs && !s.override && !s.auto) s.delayMs = s.robots.crawlDelayMs;   // raise only, never lower — unless a human overrode this host, or the fleet's adaptive mode is on
    } catch {
      s.nextAt = Date.now() + s.delayMs;
      s.robots = { disallow: [], crawlDelayMs: 0 };
    }
    s.robotsLoaded = true;
  }

  async get(url: string): Promise<PoliteResult> {
    let u: URL;
    try { u = new URL(url); } catch { return { ok: false, status: 0, mime: "", body: null, bytes: 0, skipped: "bad-url", error: "unparseable url" }; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, status: 0, mime: "", body: null, bytes: 0, skipped: "bad-url", error: u.protocol };
    const host = u.host;

    return this.queue(host, async () => {
      const s = this.state(host);
      if (s.dropped) return { ok: false, status: 0, mime: "", body: null, bytes: 0, skipped: "host-dropped" as PoliteSkip, error: `${host} dropped after ${this.maxStrikes} consecutive 403/429` };

      await this.loadRobots(host, u.protocol);
      if (s.robots && !s.override?.ignoreRobots && isDisallowed(s.robots.disallow, u.pathname + u.search)) {
        return { ok: false, status: 0, mime: "", body: null, bytes: 0, skipped: "robots" as PoliteSkip, error: `robots.txt disallows ${u.pathname}` };
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await this.pace(s);
        let r: Response;
        try {
          r = await fetch(u.href, { headers: { "User-Agent": this.ua, Accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(this.timeoutMs) });
        } catch (e) {
          s.nextAt = Date.now() + s.delayMs;
          if (attempt === 2) {
            // A host that never answers is refusing us as surely as a 403 —
            // Pennsylvania and Georgia black-hole the AWS range and a 4,000-document
            // round of 60 s timeouts held a fleet slot for hours (2026-08-30 04:30Z).
            // Consecutive network failures count as strikes; five and the host is dropped.
            s.strikes += 1;
            this.adapt(s, true);
            if (s.strikes >= this.maxStrikes) {
              s.dropped = true;
              return { ok: false, status: 0, mime: "", body: null, bytes: 0, skipped: "host-dropped" as PoliteSkip, error: `${host} dropped after ${s.strikes} consecutive failures (${String((e as Error).message).slice(0, 60)})` };
            }
            return { ok: false, status: 0, mime: "", body: null, bytes: 0, error: String((e as Error).message) };
          }
          continue;
        }
        s.requests += 1;
        s.nextAt = Date.now() + s.delayMs;

        if (r.status === 403 || r.status === 429) {
          s.strikes += 1;
          this.adapt(s, true);
          if (s.strikes >= this.maxStrikes) {
            s.dropped = true;
            return { ok: false, status: r.status, mime: "", body: null, bytes: 0, skipped: "host-dropped" as PoliteSkip, error: `${host} dropped after ${s.strikes} consecutive ${r.status}` };
          }
          // Retry-After is the site stating its terms. Capped so one hostile
          // header cannot park a run for an hour.
          const ra = Number(r.headers.get("retry-after") ?? 0);
          s.nextAt = Date.now() + Math.min(120_000, (Number.isFinite(ra) && ra > 0 ? ra : 30) * 1000);
          continue;
        }
        if (r.status === 503) {
          const ra = Number(r.headers.get("retry-after") ?? 0);
          s.nextAt = Date.now() + Math.min(120_000, (Number.isFinite(ra) && ra > 0 ? ra : 15) * 1000);
          continue;
        }
        if (!r.ok) { s.strikes = 0; return { ok: false, status: r.status, mime: (r.headers.get("content-type") ?? "").split(";")[0].trim(), body: null, bytes: 0, error: `HTTP ${r.status}` }; }

        s.strikes = 0;
        this.adapt(s, false);
        const mime = (r.headers.get("content-type") ?? "").split(";")[0].trim();
        const declared = Number(r.headers.get("content-length") ?? 0);
        if (declared && declared > this.maxBytes) {
          try { await r.body?.cancel(); } catch { /* already consumed */ }
          return { ok: false, status: r.status, mime, body: null, bytes: declared, skipped: "too-large" as PoliteSkip, error: `${declared} bytes over the cap` };
        }
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.byteLength > this.maxBytes) {
          return { ok: false, status: r.status, mime, body: null, bytes: buf.byteLength, skipped: "too-large" as PoliteSkip, error: `${buf.byteLength} bytes over the cap` };
        }
        return { ok: true, status: r.status, mime, body: buf, bytes: buf.byteLength };
      }
      return { ok: false, status: 429, mime: "", body: null, bytes: 0, error: "retried three times without a usable answer" };
    });
  }
}

/** The `User-agent: *` group, plus any group naming us. */
function parseRobots(txt: string, ua: string): { disallow: string[]; crawlDelayMs: number } {
  // Our own name in robots.txt: the token after "compatible;" when the UA is in that form, else the product before "/".
  const compat = /compatible;\s*([^/;\s)]+)/i.exec(ua);
  const me = (compat ? compat[1] : ua.split("/")[0]).toLowerCase();
  const disallow: string[] = [];
  let crawlDelayMs = 0;
  let applies = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 1) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === "user-agent") { applies = value === "*" || value.toLowerCase() === me; continue; }
    if (!applies) continue;
    if (field === "disallow" && value) disallow.push(value);
    if (field === "crawl-delay") { const n = Number(value); if (Number.isFinite(n) && n > 0) crawlDelayMs = Math.min(30_000, n * 1000); }
  }
  return { disallow, crawlDelayMs };
}

/**
 * Prefix match, with `*` supported as `prefix*suffix`. Anything more exotic is
 * treated as its literal prefix — which errs toward NOT fetching, the right way
 * to be wrong about someone else's robots.txt.
 */
function isDisallowed(rules: string[], path: string): boolean {
  for (const rule of rules) {
    if (rule === "/") return true;
    if (!rule.includes("*")) { if (path.startsWith(rule)) return true; continue; }
    const parts = rule.split("*");
    const pre = parts[0];
    const post = parts.slice(1).join("*").replace(/\$$/, "");
    if (path.startsWith(pre) && (!post || path.includes(post))) return true;
  }
  return false;
}

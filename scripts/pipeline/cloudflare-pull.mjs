// A copy of govblock/scripts/cloudflare/pull.mjs for the box, which has this
// repo and not that one. Keep the two the same; govblock's is the original.
//
// Pull the zone's analytics out of Cloudflare's GraphQL API into Aurora, as
// far back as the plan lets us reach, and keep pulling so the dashboard's
// history outlives Cloudflare's windows (Brendan, 2026-09-06: "pull in all
// analytics data now … before we lose more of it to the 30 day window").
//
//   node scripts/cloudflare/pull.mjs            # everything reachable
//   node scripts/cloudflare/pull.mjs --since 2026-08-01
//
// What the Free plan keeps, measured on 2026-09-06 against the API's own
// errors rather than the docs:
//   httpRequests1dGroups         daily zone totals, back to the zone's first day (2026-07-01)
//   httpRequests1hGroups         hourly zone totals, the last 3 days, 3 days per query
//   httpRequestsAdaptiveGroups   per host, path, referer, country, device, browser, status: the last 8 days, one day per query
//   firewallEventsAdaptiveGroups not reachable with this token; daily threats ride in the zone totals
// So the daily table is complete from day one, and the hourly and dimension
// tables fill from today forward, one nightly pull at a time. Writes go
// through the RDS Data API like scripts/directory/load.mjs, so this runs from
// anywhere with AWS credentials — a laptop, a box, a build.
//
// And the part Cloudflare never saw: policy.nysgpt.com is DNS-only, pointed
// straight at CloudFront, so GovBlock's own traffic has never passed through
// Cloudflare. Its requests, errors, bytes and latency are Amplify's CloudWatch
// metrics (AWS/AmplifyHosting), kept for fifteen months, pulled here per app
// per day since each app's first day on Amplify.

import { readFileSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const { RDSDataClient, BatchExecuteStatementCommand, ExecuteStatementCommand } = require_("@aws-sdk/client-rds-data")
const { CloudWatchClient, GetMetricDataCommand } = require_("@aws-sdk/client-cloudwatch")

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const require_ = createRequire(join(ROOT, "noop.js"))
const args = process.argv.slice(2)
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }

// Env from apps/web/.env.local, then the process, then the 44b env the token
// was first kept in.
const env = {}
for (const file of [join(ROOT, ".env.local"), join(ROOT, "apps/web/.env.local"), join(ROOT, "../44b/.env.local")]) {
  if (!existsSync(file)) continue
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!/^[A-Z_]+=/.test(l)) continue
    const k = l.slice(0, l.indexOf("="))
    if (env[k] === undefined) env[k] = l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "").replace(/^'|'$/g, "")
  }
}
for (const k of Object.keys(process.env)) if (env[k] === undefined) env[k] = process.env[k]
const TOKEN = env.CLOUDFLARE_API_TOKEN
const ZONE = env.CLOUDFLARE_ZONE_ID || "cdfeb4c8e4604d64f2d7bb884aadfc6f"
if (!TOKEN) throw new Error("CLOUDFLARE_API_TOKEN is not set")
const resourceArn = env.POLICY_CLUSTER_ARN, secretArn = env.POLICY_SECRET_ARN, database = env.POLICY_DATABASE || "policy"
if (!resourceArn || !secretArn) throw new Error("POLICY_CLUSTER_ARN and POLICY_SECRET_ARN must be set")
const client = new RDSDataClient({ region: env.AWS_REGION || "us-east-1" })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

/* ---- the database, as load.mjs does it ----------------------------------- */
const s = (v) => (v === null || v === undefined || v === "" ? { isNull: true } : { stringValue: String(v) })
// A key column that is legitimately empty: the zone as host "", a blank referer.
const t = (v) => ({ stringValue: v == null ? "" : String(v) })
const n = (v) => (v === null || v === undefined ? { isNull: true } : { longValue: Math.round(Number(v)) })
const j = (v) => (v === null || v === undefined ? { isNull: true } : { stringValue: JSON.stringify(v) })
async function withResume(fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn() } catch (e) {
      const msg = String(e?.message ?? e)
      if (/resuming|DatabaseResuming|Throttl|timed? ?out|ECONNRESET|socket hang up/i.test(msg) && attempt < 20) { await new Promise((r) => setTimeout(r, 3000)); continue }
      throw e
    }
  }
}
const exec = (sql, parameters) => withResume(() => client.send(new ExecuteStatementCommand({ resourceArn, secretArn, database, sql, parameters, continueAfterTimeout: true })))
async function batch(sql, rows, size = 100) {
  for (let i = 0; i < rows.length; i += size) await withResume(() => client.send(new BatchExecuteStatementCommand({ resourceArn, secretArn, database, sql, parameterSets: rows.slice(i, i + size) })))
}

const DDL = [
  `create table if not exists cloudflare_zone_daily (
     date date primary key, requests bigint, cached_requests bigint, bytes bigint, cached_bytes bigint, threats bigint,
     page_views bigint, encrypted_requests bigint, uniques bigint,
     country_map jsonb, response_status_map jsonb, browser_map jsonb, content_type_map jsonb, client_ssl_map jsonb,
     client_http_version_map jsonb, ip_class_map jsonb, threat_pathing_map jsonb,
     fetched_at timestamptz not null default now())`,
  `create table if not exists cloudflare_zone_hourly (
     datetime timestamptz primary key, requests bigint, cached_requests bigint, bytes bigint, cached_bytes bigint, threats bigint,
     page_views bigint, encrypted_requests bigint, uniques bigint, fetched_at timestamptz not null default now())`,
  // One row per (day, host, dimension, value): host "" is the zone. `requests`
  // is the adaptive count, `visits` Cloudflare's visit estimate, `bytes` the
  // edge response bytes. Sampled: `sample_interval` says how much.
  `create table if not exists cloudflare_adaptive_daily (
     date date not null, host text not null, dimension text not null, value text not null,
     requests bigint, visits bigint, bytes bigint, sample_interval double precision,
     fetched_at timestamptz not null default now(), primary key (date, host, dimension, value))`,
  `create index if not exists cloudflare_adaptive_daily_dim_idx on cloudflare_adaptive_daily (dimension, date)`,
  `create table if not exists cloudflare_pull_state (key text primary key, last_run timestamptz, note text)`,
  `create table if not exists amplify_daily (
     date date not null, app_id text not null, app_name text, requests bigint, errors_4xx bigint, errors_5xx bigint,
     bytes_downloaded bigint, bytes_uploaded bigint, latency_ms double precision,
     fetched_at timestamptz not null default now(), primary key (date, app_id))`,
]

/* ---- the API --------------------------------------------------------------- */
async function gql(query) {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) })
  const body = await res.json()
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "))
  return body.data.viewer.zones[0]
}
const day = (d) => d.toISOString().slice(0, 10)
const daysAgo = (k) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - k); return d }
/** Ask for a range; when the API says it is too wide or too old, narrow it until it answers. */
async function tolerant(fn, from, to) {
  try { return await fn(from, to) } catch (e) {
    const m = /cannot request data older than (\d+)w?(\d+)?d?/.exec(String(e.message))
    if (/older than/.test(String(e.message))) {
      // Parse "1w1d", "3d", "30d" into days.
      const spec = /older than ([0-9wdhm]+)/.exec(String(e.message))?.[1] ?? "30d"
      let days = 0
      for (const [, num, unit] of spec.matchAll(/(\d+)([wd])/g)) days += Number(num) * (unit === "w" ? 7 : 1)
      const floor = daysAgo(Math.max(0, days - 1))
      if (floor > from) { log(`  retention is ${days} days here; asking from ${day(floor)}`); return fn(floor, to) }
    }
    throw e
  }
}

/* ---- main ---------------------------------------------------------------- */
for (const sql of DDL) await exec(sql)
const since = val("--since") ? new Date(`${val("--since")}T00:00:00Z`) : new Date("2026-07-01T00:00:00Z")
const today = new Date()

// 1. Daily zone totals, the whole history.
{
  const rows = (await tolerant((from, to) => gql(`{ viewer { zones(filter:{zoneTag:"${ZONE}"}) { httpRequests1dGroups(limit:1000, orderBy:[date_ASC], filter:{date_geq:"${day(from)}", date_leq:"${day(to)}"}) {
      dimensions { date }
      sum { requests cachedRequests bytes cachedBytes threats pageViews encryptedRequests
            countryMap { clientCountryName requests threats bytes } responseStatusMap { edgeResponseStatus requests }
            browserMap { uaBrowserFamily pageViews } contentTypeMap { edgeResponseContentTypeName requests bytes }
            clientSSLMap { clientSSLProtocol requests } clientHTTPVersionMap { clientHTTPProtocol requests }
            ipClassMap { ipType requests } threatPathingMap { threatPathingName requests } }
      uniq { uniques } } } } }`), since, today)).httpRequests1dGroups
  await batch(
    `insert into cloudflare_zone_daily (date, requests, cached_requests, bytes, cached_bytes, threats, page_views, encrypted_requests, uniques,
       country_map, response_status_map, browser_map, content_type_map, client_ssl_map, client_http_version_map, ip_class_map, threat_pathing_map, fetched_at)
     values (:date::date, :requests, :cached_requests, :bytes, :cached_bytes, :threats, :page_views, :encrypted_requests, :uniques,
       :country_map::jsonb, :response_status_map::jsonb, :browser_map::jsonb, :content_type_map::jsonb, :client_ssl_map::jsonb, :client_http_version_map::jsonb, :ip_class_map::jsonb, :threat_pathing_map::jsonb, now())
     on conflict (date) do update set requests = excluded.requests, cached_requests = excluded.cached_requests, bytes = excluded.bytes, cached_bytes = excluded.cached_bytes,
       threats = excluded.threats, page_views = excluded.page_views, encrypted_requests = excluded.encrypted_requests, uniques = excluded.uniques,
       country_map = excluded.country_map, response_status_map = excluded.response_status_map, browser_map = excluded.browser_map, content_type_map = excluded.content_type_map,
       client_ssl_map = excluded.client_ssl_map, client_http_version_map = excluded.client_http_version_map, ip_class_map = excluded.ip_class_map, threat_pathing_map = excluded.threat_pathing_map, fetched_at = now()`,
    rows.map((r) => [
      { name: "date", value: s(r.dimensions.date) }, { name: "requests", value: n(r.sum.requests) }, { name: "cached_requests", value: n(r.sum.cachedRequests) },
      { name: "bytes", value: n(r.sum.bytes) }, { name: "cached_bytes", value: n(r.sum.cachedBytes) }, { name: "threats", value: n(r.sum.threats) },
      { name: "page_views", value: n(r.sum.pageViews) }, { name: "encrypted_requests", value: n(r.sum.encryptedRequests) }, { name: "uniques", value: n(r.uniq.uniques) },
      { name: "country_map", value: j(r.sum.countryMap) }, { name: "response_status_map", value: j(r.sum.responseStatusMap) }, { name: "browser_map", value: j(r.sum.browserMap) },
      { name: "content_type_map", value: j(r.sum.contentTypeMap) }, { name: "client_ssl_map", value: j(r.sum.clientSSLMap) }, { name: "client_http_version_map", value: j(r.sum.clientHTTPVersionMap) },
      { name: "ip_class_map", value: j(r.sum.ipClassMap) }, { name: "threat_pathing_map", value: j(r.sum.threatPathingMap) },
    ]),
  )
  const total = rows.reduce((a, r) => a + r.sum.requests, 0), views = rows.reduce((a, r) => a + r.sum.pageViews, 0)
  log(`daily: ${rows.length} days, ${rows[0]?.dimensions.date} to ${rows[rows.length - 1]?.dimensions.date} · ${total.toLocaleString()} requests · ${views.toLocaleString()} page views`)
}

// 2. Hourly, the last three days (the API's window), three days a query.
{
  const from = daysAgo(3)
  const rows = (await gql(`{ viewer { zones(filter:{zoneTag:"${ZONE}"}) { httpRequests1hGroups(limit:200, orderBy:[datetime_ASC], filter:{datetime_geq:"${from.toISOString()}", datetime_leq:"${today.toISOString()}"}) {
      dimensions { datetime } sum { requests cachedRequests bytes cachedBytes threats pageViews encryptedRequests } uniq { uniques } } } } }`)).httpRequests1hGroups
  await batch(
    `insert into cloudflare_zone_hourly (datetime, requests, cached_requests, bytes, cached_bytes, threats, page_views, encrypted_requests, uniques, fetched_at)
     values (:datetime::timestamptz, :requests, :cached_requests, :bytes, :cached_bytes, :threats, :page_views, :encrypted_requests, :uniques, now())
     on conflict (datetime) do update set requests = excluded.requests, cached_requests = excluded.cached_requests, bytes = excluded.bytes, cached_bytes = excluded.cached_bytes,
       threats = excluded.threats, page_views = excluded.page_views, encrypted_requests = excluded.encrypted_requests, uniques = excluded.uniques, fetched_at = now()`,
    rows.map((r) => [
      { name: "datetime", value: s(r.dimensions.datetime) }, { name: "requests", value: n(r.sum.requests) }, { name: "cached_requests", value: n(r.sum.cachedRequests) },
      { name: "bytes", value: n(r.sum.bytes) }, { name: "cached_bytes", value: n(r.sum.cachedBytes) }, { name: "threats", value: n(r.sum.threats) },
      { name: "page_views", value: n(r.sum.pageViews) }, { name: "encrypted_requests", value: n(r.sum.encryptedRequests) }, { name: "uniques", value: n(r.uniq.uniques) },
    ]),
  )
  log(`hourly: ${rows.length} hours`)
}

// 3. The dimensions, one day at a time, the last eight days (the API's window).
//    Per host, and per host by path, country, device, browser and status. The
//    zone itself is host "". The referer is not a field the Free plan can read.
const DIMENSIONS = [
  ["host", "clientRequestHTTPHost", 50],
  ["path", "clientRequestPath", 300],
  ["country", "clientCountryName", 60],
  ["device", "clientDeviceType", 10],
  ["browser", "userAgentBrowser", 30],
  ["status", "edgeResponseStatus", 30],
]
{
  let written = 0, days = 0
  for (let k = 8; k >= 0; k--) {
    const d = day(daysAgo(k))
    if (new Date(`${d}T00:00:00Z`) < since) continue
    let dayRows = []
    let hosts = []
    for (const [name, field, limit] of DIMENSIONS) {
      // The host split first; then each host's own breakdown, plus the zone's.
      const scopes = name === "host" ? [""] : ["", ...hosts]
      for (const host of scopes) {
        try {
          const rows = (await gql(`{ viewer { zones(filter:{zoneTag:"${ZONE}"}) { httpRequestsAdaptiveGroups(limit:${limit}, orderBy:[count_DESC], filter:{date:"${d}"${host ? `, clientRequestHTTPHost:"${host}"` : ""}}) {
              count dimensions { ${field} } sum { visits edgeResponseBytes } avg { sampleInterval } } } } }`)).httpRequestsAdaptiveGroups
          if (name === "host") hosts = rows.map((r) => r.dimensions[field]).filter(Boolean).slice(0, 12)
          for (const r of rows) dayRows.push([
            { name: "date", value: s(d) }, { name: "host", value: t(host) }, { name: "dimension", value: s(name) }, { name: "value", value: t(r.dimensions[field]) },
            { name: "requests", value: n(r.count) }, { name: "visits", value: n(r.sum.visits) }, { name: "bytes", value: n(r.sum.edgeResponseBytes) }, { name: "sample_interval", value: { doubleValue: Number(r.avg?.sampleInterval ?? 1) } },
          ])
        } catch (e) { if (!/older than/.test(String(e.message))) log(`  ${d} ${name} ${host || "zone"}: ${String(e.message).slice(0, 100)}`) }
      }
    }
    if (dayRows.length) {
      await batch(
        `insert into cloudflare_adaptive_daily (date, host, dimension, value, requests, visits, bytes, sample_interval, fetched_at)
         values (:date::date, :host, :dimension, :value, :requests, :visits, :bytes, :sample_interval, now())
         on conflict (date, host, dimension, value) do update set requests = excluded.requests, visits = excluded.visits, bytes = excluded.bytes, sample_interval = excluded.sample_interval, fetched_at = now()`,
        dayRows,
      )
      written += dayRows.length; days += 1
    }
  }
  log(`dimensions: ${written} rows across ${days} days`)
}

// 4. Amplify: every app's daily requests, errors, bytes and latency, from
//    CloudWatch, since --since (the metrics reach fifteen months back).
{
  const cw = new CloudWatchClient({ region: env.AWS_REGION || "us-east-1" })
  const apps = [
    ["d2a69zdzqun8m7", "govblock"],
    ["d19scfayvy6e0b", "paulrubell"],
    ["d2bart0mempmp5", "solar"],
  ]
  const start = new Date(Math.max(since.getTime(), daysAgo(450).getTime()))
  const end = new Date(); end.setUTCHours(23, 59, 59, 0)
  let rows = []
  for (const [appId, appName] of apps) {
    const q = (id, metric, stat) => ({ Id: id, MetricStat: { Metric: { Namespace: "AWS/AmplifyHosting", MetricName: metric, Dimensions: [{ Name: "App", Value: appId }] }, Period: 86400, Stat: stat }, ReturnData: true })
    const out = await cw.send(new GetMetricDataCommand({ StartTime: start, EndTime: end, ScanBy: "TimestampAscending", MetricDataQueries: [
      q("requests", "Requests", "Sum"), q("e4", "4xxErrors", "Sum"), q("e5", "5xxErrors", "Sum"),
      q("down", "BytesDownloaded", "Sum"), q("up", "BytesUploaded", "Sum"), q("lat", "Latency", "Average"),
    ] }))
    const series = Object.fromEntries((out.MetricDataResults ?? []).map((r) => [r.Id, new Map((r.Timestamps ?? []).map((t, i) => [day(new Date(t)), r.Values?.[i] ?? null]))]))
    const days = new Set([...(series.requests?.keys() ?? [])])
    for (const d of days) rows.push([
      { name: "date", value: s(d) }, { name: "app_id", value: s(appId) }, { name: "app_name", value: s(appName) },
      { name: "requests", value: n(series.requests?.get(d) ?? 0) }, { name: "errors_4xx", value: n(series.e4?.get(d) ?? 0) }, { name: "errors_5xx", value: n(series.e5?.get(d) ?? 0) },
      { name: "bytes_downloaded", value: n(series.down?.get(d) ?? 0) }, { name: "bytes_uploaded", value: n(series.up?.get(d) ?? 0) },
      { name: "latency_ms", value: series.lat?.get(d) == null ? { isNull: true } : { doubleValue: Number(series.lat.get(d)) } },
    ])
    log(`amplify ${appName}: ${days.size} days`)
  }
  await batch(
    `insert into amplify_daily (date, app_id, app_name, requests, errors_4xx, errors_5xx, bytes_downloaded, bytes_uploaded, latency_ms, fetched_at)
     values (:date::date, :app_id, :app_name, :requests, :errors_4xx, :errors_5xx, :bytes_downloaded, :bytes_uploaded, :latency_ms, now())
     on conflict (date, app_id) do update set app_name = excluded.app_name, requests = excluded.requests, errors_4xx = excluded.errors_4xx, errors_5xx = excluded.errors_5xx,
       bytes_downloaded = excluded.bytes_downloaded, bytes_uploaded = excluded.bytes_uploaded, latency_ms = excluded.latency_ms, fetched_at = now()`,
    rows,
  )
}

await exec(`insert into cloudflare_pull_state (key, last_run, note) values ('zone', now(), :note) on conflict (key) do update set last_run = now(), note = excluded.note`, [{ name: "note", value: s(`pulled ${day(today)}`) }])
log("cloudflare pull done")

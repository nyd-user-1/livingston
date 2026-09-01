#!/usr/bin/env node
// scripts/lake/inventory.mjs — what is actually in Neon, before anything is
// copied out of it (§6.1).
//
//   node scripts/lake/inventory.mjs [--json <path>]
//
// Enumerates every table, view and matview in `public` and `openstates` with
// its row estimate, on-disk size and full column list, assigns each one a lake
// domain per §2/§7.C, and prints the markdown table the report wants. Views are
// listed and skipped — they are queries, not data. App and mutable tables are
// listed and marked out of scope.
//
// Row counts here are planner estimates (`reltuples`), which is the honest
// thing for an inventory: the exact count that parity is judged on is taken by
// the exporter inside the same snapshot it reads the rows from, because a count
// taken in a different transaction than the export is a race, not a check.

import fs from "node:fs"
import process from "node:process"
import { connect, lakeName, parquetType, qualify } from "./_lib.mjs"
import { domainFor, outOfScopeReason } from "./domains.mjs"

const args = process.argv.slice(2)
const jsonPath = args.includes("--json") ? args[args.indexOf("--json") + 1] : null

const RELKIND = { r: "table", p: "partitioned table", m: "matview", v: "view", f: "foreign table" }

async function main() {
  const db = await connect()

  const rels = (
    await db.query(`
      select n.nspname            as schema,
             c.relname            as name,
             c.relkind            as kind,
             c.reltuples::bigint  as est_rows,
             pg_total_relation_size(c.oid) as total_bytes,
             pg_relation_size(c.oid)       as heap_bytes,
             c.oid
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public','openstates')
         and c.relkind in ('r','p','m','v','f')
       order by pg_total_relation_size(c.oid) desc, c.relname
    `)
  ).rows

  const cols = (
    await db.query(`
      select table_schema           as schema,
             table_name             as name,
             column_name            as column,
             ordinal_position       as ord,
             -- udt_name is the postgres type name; an array's is the element
             -- type with a leading underscore, which data_type flags for us.
             ltrim(udt_name, '_')   as pg_type,
             (is_nullable = 'NO')   as not_null,
             (data_type = 'ARRAY')  as is_array
        from information_schema.columns
       where table_schema in ('public','openstates')
       order by table_schema, table_name, ordinal_position
    `)
  ).rows

  // Primary keys, for the §5 round-trip and for the shape notes.
  const pks = (
    await db.query(`
      select n.nspname as schema, c.relname as name,
             array_agg(a.attname order by k.ord) as pk
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        join lateral unnest(con.conkey) with ordinality as k(attnum, ord) on true
        join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
       where con.contype = 'p' and n.nspname in ('public','openstates')
       group by 1,2
    `)
  ).rows

  // information_schema does not cover materialized views, so those are typed by
  // probing what a SELECT actually returns. This is the same shape the exporter
  // will receive, which makes it the more honest source for any relation.
  const pgTypes = new Map(
    (await db.query("select oid, typname, typcategory, typelem from pg_type")).rows.map((t) => [
      Number(t.oid),
      { name: t.typname, isArray: t.typcategory === "A", elem: Number(t.typelem) },
    ])
  )
  const typeName = (oid) => {
    const t = pgTypes.get(oid)
    if (!t) return `oid${oid}`
    if (t.isArray && t.elem) return pgTypes.get(t.elem)?.name ?? `oid${t.elem}`
    return t.name
  }
  for (const r of rels.filter((r) => r.kind === "m")) {
    const probe = await db.query(`select * from ${qualify(r.schema, r.name)} limit 0`)
    probe.fields.forEach((f, i) => {
      cols.push({
        schema: r.schema,
        name: r.name,
        column: f.name,
        ord: i + 1,
        pg_type: typeName(f.dataTypeID),
        not_null: false,
        is_array: pgTypes.get(f.dataTypeID)?.isArray ?? false,
      })
    })
  }

  const colsBy = new Map()
  for (const c of cols) {
    const key = `${c.schema}.${c.name}`
    if (!colsBy.has(key)) colsBy.set(key, [])
    colsBy.get(key).push(c)
  }
  const pkBy = new Map(pks.map((p) => [`${p.schema}.${p.name}`, p.pk]))

  const out = []
  for (const r of rels) {
    const key = `${r.schema}.${r.name}`
    const columns = colsBy.get(key) ?? []
    const isView = r.kind === "v"
    const excluded = outOfScopeReason(r.schema, r.name)
    const scoped = !isView && !excluded
    let domain = null
    const unmapped = []
    if (scoped) {
      domain = domainFor(r.schema, r.name)
      for (const c of columns) {
        try { parquetType(c.pg_type, c.is_array) } catch { unmapped.push(`${c.column}:${c.pg_type}`) }
      }
    }
    out.push({
      schema: r.schema,
      name: r.name,
      lake_name: lakeName(r.name),
      kind: RELKIND[r.kind] ?? r.kind,
      est_rows: Number(r.est_rows),
      total_bytes: Number(r.total_bytes),
      heap_bytes: Number(r.heap_bytes),
      domain,
      in_scope: scoped && !!domain && unmapped.length === 0,
      skip_reason: isView
        ? "view — a query, not data (§7.C)"
        : excluded
          ? `out of scope (§6.1) — ${excluded}`
          : !domain
            ? "UNCLASSIFIED — needs a ruling"
            : unmapped.length
              ? `unmapped column types: ${unmapped.join(", ")}`
              : null,
      pk: pkBy.get(key) ?? null,
      has_state: columns.some((c) => c.column === "state"),
      has_session: columns.some((c) => c.column === "session_id"),
      columns: columns.map((c) => ({
        name: c.column,
        pg_type: c.pg_type,
        is_array: c.is_array,
        not_null: c.not_null,
        parquet: (() => { try { return parquetType(c.pg_type, c.is_array) } catch { return null } })(),
      })),
    })
  }

  await db.end()

  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2))

  const gb = (b) => (b / 1024 ** 3).toFixed(2)
  const n = (x) => x.toLocaleString("en-US")
  console.log("| relation | kind | est rows | size | domain | partition keys | in scope |")
  console.log("| --- | --- | ---: | ---: | --- | --- | --- |")
  for (const t of out) {
    const partKeys = [t.has_state && "jurisdiction", t.has_session && "session"].filter(Boolean).join("/") || "—"
    console.log(
      `| \`${t.schema}."${t.name}"\` | ${t.kind} | ${n(t.est_rows)} | ${gb(t.total_bytes)} GB | ${t.domain ?? "—"} | ${partKeys} | ${t.in_scope ? "yes" : `no — ${t.skip_reason}`} |`
    )
  }
  const scoped = out.filter((t) => t.in_scope)
  console.log(
    `\n${out.length} relations · ${scoped.length} in scope · ` +
      `${n(scoped.reduce((s, t) => s + t.est_rows, 0))} est rows · ` +
      `${gb(scoped.reduce((s, t) => s + t.total_bytes, 0))} GB`
  )
  const unclassified = out.filter((t) => t.skip_reason && /UNCLASSIFIED|unmapped/.test(t.skip_reason))
  if (unclassified.length) {
    console.log(`\nNEEDS A RULING (${unclassified.length}):`)
    for (const t of unclassified) console.log(`  ${t.schema}."${t.name}" — ${t.skip_reason}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

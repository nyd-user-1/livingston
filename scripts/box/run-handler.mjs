#!/usr/bin/env node
// scripts/box/run-handler.mjs — run a Vercel `api/*.ts` handler from a command line.
//
//   node scripts/box/run-handler.mjs api/legiscan-sync.ts mode=delta state=NY
//   node scripts/box/run-handler.mjs --heap 4096 api/legiscan-sync.ts mode=dataset state=NY session=2188
//
// The ingestion routes are Vercel handlers `(req, res)`. On the worker box there
// is no Vercel, so this is the shim: it bundles the TypeScript with esbuild in
// process, imports the bundle, calls the default export with a fake
// request/response pair, prints what the handler answered — and, the part that
// matters, **exits non-zero unless the handler answered 2xx**.
//
// That exit code is the whole point. `run-job` records the command's real code
// as the `EXIT=` line of ~/logs/<job>.log, `run-due` propagates it, and the
// morning digest turns a non-zero into a red line. The throwaway python drivers
// this replaces grepped stdout for "HTTP 200" and always exited 0, which would
// have made every box-side failure silent — the one failure mode the house
// doctrine says to design against (ORCHESTRATION §9).
//
// Env: this script reads `.env.local` from the repo root itself, and only for
// keys not already in the environment. Doing it here rather than relying on
// `node --env-file=` means one command works three ways unchanged — by hand,
// under `run-job`, and under `run-due` (which already passes
// `--env-file=.env.local`, and whose values therefore win).
//
// Exit codes: 0 = handler answered 2xx · 1 = non-2xx, or the handler threw ·
//             2 = usage / missing handler (the job never ran).

import { build } from "esbuild";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(SELF), "..", "..");

function usage(msg) {
  if (msg) console.error(`run-handler: ${msg}`);
  console.error("usage: run-handler.mjs [--heap <mb>] [--quiet] <api/handler.ts> [key=value ...]");
  process.exit(2);
}

/* ---- argv --------------------------------------------------------------- */

const argv = process.argv.slice(2);
let heapMb = 0;
let quiet = false;
let entry = "";
const query = {};
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--heap") { heapMb = Number(argv[i + 1]) || 0; i += 1; continue; }
  if (a.startsWith("--heap=")) { heapMb = Number(a.slice(7)) || 0; continue; }
  if (a === "--quiet") { quiet = true; continue; }
  if (a.startsWith("--")) usage(`unknown flag '${a}'`);
  if (!entry) { entry = a; continue; }
  const eq = a.indexOf("=");
  if (eq < 1) usage(`arguments after the handler must be key=value, got '${a}'`);
  query[a.slice(0, eq)] = a.slice(eq + 1);   // values may contain '=' (access keys do)
}
if (!entry) usage("no handler given");

/* ---- .env.local --------------------------------------------------------- */

// Never overwrite something already exported: run-due hands us `--env-file`
// values, and an operator may want to override one for a single run.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq < 1) continue;
    const k = s.slice(0, eq).trim();
    if (process.env[k] !== undefined) continue;
    process.env[k] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv(path.join(REPO, ".env.local"));

/* ---- --heap: re-exec once with a bigger old space ----------------------- */

// NY's 2025-26 archive is a 72 MB zip and several states' are larger, so
// `mode=dataset` wants 4096. Re-exec rather than making every caller remember
// the node flag; RUN_HANDLER_HEAP marks the child so it cannot recurse.
if (heapMb && !process.env.RUN_HANDLER_HEAP) {
  const child = spawn(process.execPath, [`--max-old-space-size=${heapMb}`, SELF, ...argv], {
    stdio: "inherit",
    env: { ...process.env, RUN_HANDLER_HEAP: String(heapMb) },
  });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 1));
  child.on("error", (err) => { console.error(`run-handler: re-exec failed — ${err.message}`); process.exit(2); });
} else {
  await main();
}

/* ---- bundle, import, call ----------------------------------------------- */

async function main() {
  const abs = path.isAbsolute(entry) ? entry : path.join(REPO, entry);
  if (!fs.existsSync(abs)) usage(`no such handler: ${abs}`);

  let tmp = "";
  let status = 500;
  let body = { error: "handler returned without answering" };
  try {
    const out = await build({
      entryPoints: [abs],
      write: false,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      logLevel: "warning",
    });
    // A temp file, not a data: URL — a stack trace out of a 250 KB data URL is
    // unreadable, and having the path on disk is worth it when a bundle misbehaves.
    tmp = path.join(os.tmpdir(), `run-handler-${path.basename(abs, path.extname(abs))}-${process.pid}.mjs`);
    fs.writeFileSync(tmp, out.outputFiles[0].text);

    const mod = await import(pathToFileURL(tmp).href);
    if (typeof mod.default !== "function") usage(`${entry} has no default-exported handler`);

    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      setHeader() { return this; },
      json(o) { status = this.statusCode; body = o; return this; },
      send(o) { status = this.statusCode; body = o; return this; },
      end(o) { status = this.statusCode; if (o !== undefined) body = o; return this; },
    };
    const req = {
      method: "GET",
      url: `/${entry.replace(/\.ts$/, "")}`,
      headers: {},
      // CRON_SECRET is the default, but an explicit `secret=` on the command line
      // wins — that is how the auth path gets exercised without a live run.
      query: { secret: process.env.CRON_SECRET ?? "", ...query },
    };
    await mod.default(req, res);
  } catch (err) {
    status = 500;
    body = { error: String(err?.stack ?? err?.message ?? err) };
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }

  const ok = status >= 200 && status < 300;
  if (!quiet || !ok) console.log(`HTTP ${status} ${JSON.stringify(body)}`);
  process.exit(ok ? 0 : 1);
}

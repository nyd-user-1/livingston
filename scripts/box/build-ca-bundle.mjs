#!/usr/bin/env node
// scripts/box/build-ca-bundle.mjs — complete the certificate chains six state
// legislatures forget to send, without lowering anyone's guard.
//
//   node scripts/box/build-ca-bundle.mjs            # rebuild ops/box/state-ca-bundle.pem
//   node scripts/box/build-ca-bundle.mjs --verify   # check the existing bundle, write nothing
//
// THE PROBLEM. Six hosts holding ~63,000 bill documents fail TLS verification
// from Node and curl with X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT_LOCALLY (error
// 20): their servers send only the leaf certificate and omit the intermediate
// that links it to a public root. Browsers hide this by chasing the leaf's
// Authority Information Access extension and fetching the missing certificate
// themselves; Node and curl, correctly, do not.
//
// THE FIX, and exactly what it does and does not do. For each host this reads
// the AIA `CA Issuers` URI OUT OF THE LEAF THE HOST ITSELF PRESENTED, downloads
// that intermediate from the certificate authority, and — before keeping it —
// verifies with `openssl verify` that it chains to a root already in the system
// store. Only then does it go in the bundle, which is used via NODE_EXTRA_CA_CERTS
// (an ADDITION to the default roots, never a replacement).
//
// So: we are not disabling verification, not pinning, and not trusting anything
// the site says about itself. We are fetching, from the CA, a certificate the CA
// has already signed with a root we trust, and which the server should have sent
// and did not. Every hostname is still verified, every signature is still
// checked, and an expired or revoked leaf still fails.
//
// The bundle is committed because the box resets its checkout from git; an
// untracked file assembled by hand would disappear on the next `git reset --hard`
// and take 63,000 documents with it. It contains public CA intermediates only —
// nothing secret, nothing per-machine.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const OUT = path.join(REPO, "ops", "box", "state-ca-bundle.pem");
const SYSTEM_ROOTS = process.env.SYSTEM_CA_BUNDLE || "/etc/ssl/certs/ca-certificates.crt";
const VERIFY_ONLY = process.argv.includes("--verify");

// The six measured by lane BT's robots pre-flight, 2026-08-28. Hostnames, not
// document URLs: this needs nothing out of "Documents" and can run while the
// national sweep is rebuilding that table.
const HOSTS = [
  { state: "MS", host: "billstatus.ls.state.ms.us", docs: 22324 },
  { state: "CT", host: "www.cga.ct.gov", docs: 15378 },
  { state: "MI", host: "legislature.mi.gov", docs: 13451 },
  { state: "VT", host: "legislature.vermont.gov", docs: 6141 },
  { state: "PA", host: "www.legis.state.pa.us", docs: 5821 },
  { state: "OH", host: "www.legislature.ohio.gov", docs: 11 },
];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const tmp = (name) => path.join(process.env.TMPDIR || "/tmp", `ca-${process.pid}-${name}`);

function sh(cmd, args, input) {
  return execFileSync(cmd, args, { input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}

// Every s_client goes through `timeout`. A legislature that accepts the TCP
// connection and then says nothing will otherwise hold the whole run open, and
// one of these six is exactly the kind of host that does that.
function ssl(args, seconds = 20) {
  return execFileSync("timeout", [String(seconds), "openssl", ...args], { input: "", encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}

/** The leaf the host actually presents, as PEM. */
function leafOf(host) {
  const out = ssl(["s_client", "-connect", `${host}:443`, "-servername", host, "-showcerts"]);
  const certs = out.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  if (!certs.length) throw new Error("the host presented no certificate at all");
  return { leaf: certs[0], sent: certs.length };
}

/** The AIA "CA Issuers" URI the leaf itself names. */
function caIssuerUri(leafPem) {
  const text = sh("openssl", ["x509", "-noout", "-text"], leafPem);
  const m = /CA Issuers - URI:(\S+)/.exec(text);
  if (!m) throw new Error("the leaf carries no AIA CA Issuers URI — nothing to fetch");
  return m[1].trim();
}

const subjectOf = (pem) => sh("openssl", ["x509", "-noout", "-subject"], pem).replace(/^subject=\s*/, "").trim();
const issuerOf = (pem) => sh("openssl", ["x509", "-noout", "-issuer"], pem).replace(/^issuer=\s*/, "").trim();

async function fetchIssuer(uri) {
  const r = await fetch(uri, { headers: { "User-Agent": "livingston-bill-text/1.0 (contact: brendan@nysgpt.com)" }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${uri} answered ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  // CAs serve DER (.crt/.cer) far more often than PEM. Try PEM, then convert.
  const asText = buf.toString("utf8");
  if (asText.includes("-----BEGIN CERTIFICATE-----")) return asText.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)[0] + "\n";
  const f = tmp("der");
  fs.writeFileSync(f, buf);
  try { return sh("openssl", ["x509", "-inform", "DER", "-in", f, "-outform", "PEM"]); }
  finally { fs.rmSync(f, { force: true }); }
}

/** Does this certificate chain to a root we ALREADY trust? If not, it does not go in. */
function chainsToTrustedRoot(pem) {
  const f = tmp("int.pem");
  fs.writeFileSync(f, pem);
  try {
    sh("openssl", ["verify", "-CAfile", SYSTEM_ROOTS, f]);
    return true;
  } catch { return false; }
  finally { fs.rmSync(f, { force: true }); }
}

/** Does the host verify now, with the bundle in play? */
function hostVerifies(host, bundlePath) {
  const cafile = tmp("all.pem");
  fs.writeFileSync(cafile, fs.readFileSync(SYSTEM_ROOTS, "utf8") + (bundlePath && fs.existsSync(bundlePath) ? fs.readFileSync(bundlePath, "utf8") : ""));
  try {
    const out = ssl(["s_client", "-connect", `${host}:443`, "-servername", host, "-CAfile", cafile, "-verify_return_error", "-brief"]);
    return { ok: true, detail: (/Verification: (\S+)/.exec(out) ?? [, "OK"])[1] };
  } catch (e) {
    const msg = String(e.stderr ?? e.message ?? "").split("\n").find((l) => /verif/i.test(l)) ?? String(e.message).slice(0, 120);
    return { ok: false, detail: msg.trim() };
  } finally { fs.rmSync(cafile, { force: true }); }
}

/* ---- run ----------------------------------------------------------------- */

if (VERIFY_ONLY) {
  log(`verifying ${HOSTS.length} hosts against ${OUT}`);
  let bad = 0;
  for (const h of HOSTS) {
    const v = hostVerifies(h.host, OUT);
    log(`  ${h.state} ${h.host}: ${v.ok ? "OK" : `FAILS — ${v.detail}`}`);
    if (!v.ok) bad += 1;
  }
  process.exit(bad ? 1 : 0);
}

const seen = new Map();       // subject -> pem, so two hosts behind one CA store it once
const report = [];

for (const h of HOSTS) {
  const before = hostVerifies(h.host, null);
  try {
    const { leaf, sent } = leafOf(h.host);
    const uri = caIssuerUri(leaf);
    const inter = await fetchIssuer(uri);
    const subject = subjectOf(inter);
    const trusted = chainsToTrustedRoot(inter);
    if (!trusted) {
      report.push({ ...h, ok: false, note: `intermediate does not chain to a trusted root — REFUSED (${subject})` });
      log(`  ${h.state} ${h.host}: intermediate REFUSED, does not chain to a system root`);
      continue;
    }
    if (!seen.has(subject)) seen.set(subject, inter);
    report.push({ ...h, ok: true, sent, uri, subject, issuer: issuerOf(inter), before: before.detail });
    log(`  ${h.state} ${h.host}: sent ${sent} cert(s); fetched + verified "${subject}"`);
  } catch (e) {
    report.push({ ...h, ok: false, note: String(e.message).slice(0, 160) });
    log(`  ${h.state} ${h.host}: ${String(e.message).slice(0, 160)}`);
  }
}

const header = [
  "# ops/box/state-ca-bundle.pem — intermediate CA certificates that six state",
  "# legislature servers fail to send, fetched from the CA named in each site's own",
  "# AIA extension and each verified to chain to a root already in the system store.",
  "# Used via NODE_EXTRA_CA_CERTS, which ADDS to the default roots and replaces none.",
  "# Regenerate with: node scripts/box/build-ca-bundle.mjs",
  `# Built ${new Date().toISOString()} for: ${report.filter((r) => r.ok).map((r) => r.state).join(" ")}`,
  "",
].join("\n");

const body = [...seen.entries()].map(([subject, pem]) => `# ${subject}\n${pem.trim()}\n`).join("\n");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header + body);
log(`wrote ${OUT}: ${seen.size} intermediate(s) for ${report.filter((r) => r.ok).length}/${HOSTS.length} hosts`);

log("verifying each host with the bundle in play:");
let fixed = 0;
for (const h of HOSTS) {
  const v = hostVerifies(h.host, OUT);
  if (v.ok) fixed += 1;
  log(`  ${h.state} ${h.host} (${h.docs.toLocaleString()} docs): ${v.ok ? "VERIFIES" : `still fails — ${v.detail}`}`);
}
log(`${fixed}/${HOSTS.length} hosts verify with the bundle; ${HOSTS.filter((h) => hostVerifies(h.host, OUT).ok).reduce((n, h) => n + h.docs, 0).toLocaleString()} documents unblocked`);
process.exit(fixed === HOSTS.length ? 0 : 1);

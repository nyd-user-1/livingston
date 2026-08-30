# The bill-text fleet — pointer

The doctrine is canonical in **`/Code/scripts/FLEET-DOCTRINE.md`** (one copy; this file points at it). What lives in this repo:

| Piece | Where |
|---|---|
| Launcher (`--bootstrap`, `--from`, `--pdf-batch`, `--skip-states`, `--start/--max`) | `scripts/box/fleet-launch.sh` |
| Driver (`--shard i/k`, `--all-states`, `--only-states`, `--source pdf-batch`, `--retry-errors`) | `scripts/box/text-backfill.mjs` |
| Fetcher: adaptive lanes, `POLITE_HOST_OVERRIDES` (`host=delay:lanes[:norobots]`), strikes incl. timeouts | `api/_lib/polite-fetch.ts` |
| Handler: two-step selection, PDF deferral (`PDF_DEFER_BUCKET`), `rewriteLink` (moved hosts), `pdf-batch` | `api/bill-text.ts` |
| Shared converters / `TextBuffer` / pooler | `api/_lib/text-shared.ts` |
| Native sources (CA pubinfo, TX FTP, VA LIS API, MA API) | `api/_lib/text-sources/` |
| The night, decision by decision, with the numbers | `prompts/2026-08-29-native-text.md` §Report; `prompts/2026-08-29-text-fleet.md` |
| Buckets | `s3://livingston-bill-pdfs-638175140432/pdf/<state>/<document_id>.pdf` (originals) · `s3://livingston-fec-bulk-638175140432/_fleet/` (shard logs, bootstrap tarball) |

Operating rules that are not optional: read §3 of the doctrine before touching a running fleet — in particular *kill the boot wrapper before the driver* and *never put a kill pattern in the same command as a relaunch*.

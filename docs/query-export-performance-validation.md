# Query and native streamed export validation

Date: 2026-10-01 (Asia/Taipei). Q40–Q50 are implemented after plan checkpoint 7289248. This phase changes query preparation and download delivery. It does not change adopted usage, current-basis pricing, calendar rules, manual browser updates or settings/credential ownership.

## Delivered behavior

Selected Session rows are reused in a two-entry cache owned by the immutable snapshot Session array. Provider, full range/filter/search semantics, path exposure, pricing object and archive availability bound reuse. A fresh snapshot array or pricing change invalidates reuse; live scan/failure qualifiers are rebuilt for every response. Rate matches and timezone bucket calculations have bounded per-query memoization. Model/trend costs use lightweight event subtotals. Detail selects its candidate before computing unrelated usage. Exports prepare only the fields each format needs, with complete matched counts and metadata.

The UI prepares the displayed projection through same-origin POST, then starts a native one-use download. A conflict reloads the complete dashboard and requires another click. Preparation pins the original query, snapshot and pricing basis independently of later refresh. The frontend export path no longer collects a complete Blob or object URL. The server counts exact UTF-8 length, then writes incremental CSV/JSON/Markdown through a reusable 128 KiB buffer. It waits for the write callback and drain before pulling/reusing the buffer. The former 32 MiB cap is removed.

Direct GET export and prepared downloads share one process-wide slot, with immediate busy rejection and no queue. Ready expiry is two minutes; transport idle deadline is 60 seconds and total deadline is 30 minutes. Disconnect, completion, errors, deadlines and shutdown release the plan. Explicit Range requests fail; retry starts a new download. Before-header errors use the normal envelope; after-header errors close the connection. The UI reports handoff only; the browser owns Save, Cancel and partial files. A lost preparation response can retain the slot until bounded expiry.

## Local performance acceptance

Final command: `node tests/performance-baseline.mjs <result.json>`. The final source includes the Provider cache key and fixed-buffer writer. [Raw evidence](query-export-performance-evidence.json) contains 63 HTTP measurements, memory snapshots, sample counts and workload checks. Earlier exploratory runs informed implementation and are not added to this count. The original [baseline](performance-baseline.md) and its 48 measurements remain historical.

Environment and workload match the baseline: macOS arm64, Node v26.0.0, 12 logical CPUs, 24 GiB RAM, parse concurrency two, isolated copied app, blocked external fetch, sequential synthetic requests. Normal loads have 10000/50000/150000 observations and 100/500/1500 Sessions, two alternating models, ten workspaces and 100 shared hourly timestamps. All-time UTC and stable projection clocks are used; first queries include scanning, parsing and complete delivery. No forced GC is used.

| 150000 observations | Target | Final observation |
| --- | --- | --- |
| First dashboard | ≤1500 ms | 1165.6 ms |
| Warm dashboard, two samples | ≤250 ms | 164.4–166.3 ms |
| New model filter | ≤250 ms | 165.2 ms |
| Last Session page, two samples | ≤100 ms | 42.1–43.0 ms |
| Detail | ≤100 ms | 1.5 ms |
| Session CSV prepare + transfer | ≤500 ms | 60.3 + 36.6 = 96.9 ms |
| JSON prepare + transfer | ≤500 ms | 77.6 + 1.8 = 79.4 ms |
| Trend CSV prepare + transfer | ≤500 ms | 124.3 + 1.1 = 125.4 ms |
| Markdown prepare + transfer | ≤500 ms | 39.2 + 1.4 = 40.6 ms |
| Normal sequence observed maximum RSS | ≤512 MiB | 409.7 MiB |

All selected numeric assertions passed. Against the baseline warm dashboard improves from about 1.88 seconds to at most 166.3 ms. The 10000 verified archive first/last-page samples are 16.0–23.3 ms; archive listing architecture is unchanged.

The adversarial 500-Session fixture retains 70000 extra characters per ID. CSV is now complete: 35309532 bytes and 501 lines. Fast transfer adds 1.56 MiB observed RSS. A consumer delayed 20 ms per read takes 11401.7 ms, receives exactly the same bytes, and adds 0.47 MiB with 107 external RSS samples. Both pass the transfer-stage ≤16 MiB target. Preparation and parsing retain their existing projection/input memory; this is not a 16 MiB total-process limit or an unlimited input capacity claim. The normal ≤512 MiB assertion covers the selected normal workload, not arbitrary IDs or simultaneous refresh snapshots.

Elapsed time is parent fetch through complete body consumption. Export latency is preparation plus transfer. RSS is external ps sampling nominally every 100 ms plus handler before/at-headers/after values. Additional transfer RSS is the maximum observed value minus its before-handler value. Fast transfers can have only one external sample. These are observed maxima, not exact peaks, p95, concurrent-load SLA or cross-hardware guarantees. Shared synthetic timestamps favour memoization; real distributions remain unverified. Startup, browser rendering and disk-save time are not included.

## Focused correctness and lifecycle

Implemented first, then checked the affected existing accounting/calendar/projection/detail cases: 50 tests passed. Five new stream tests cover Unicode/formulas/exact length, selection invalidation/live failure, one-use/expiry, fixed-buffer backpressure and injected idle/total/disconnect/shutdown cleanup. Seven request-race tests and two targeted pricing-archive cases passed. After the final Provider key and translation cleanup, the 15 stream/projection tests passed again; these overlap earlier cases and are not reported as additional unique tests.

Copied phase1 and phase4 HTTP fixtures passed selected Claude unknown-TTL pricing, full exports, projection/pricing conflicts and local security. The new `node tests/stream-export-http.mjs` passed real HTTP same-origin/required guards, one shared slot, complete >32 MiB CSV, four formats, one-use/expiry/Range, client cancellation, forced interruption and retry. A prepared snapshot with 7200 Tokens remains 7200 after refresh creates 7210 current Tokens. The CSV scope and byte length are exact. Fake clock/timers cover long deadlines without a 30-minute sleep. Ad hoc byte comparisons against the historical formatter also matched all four formats for empty/nonempty, formula/quote/CRLF/emoji and long Unicode cases: 24 comparisons, separate from the unit-test count.

## Desktop observations

Root used native Safari on the isolated synthetic fixture and a background in-app desktop tab for localized/race flows. Existing user tabs were preserved. The real Safari files were read after Save and matched the captured server wire bytes exactly:

| Native saved file | Bytes | Result |
| --- | --- | --- |
| TEST_ONLY-large.csv | 35370837 | Complete, 600 data rows plus header |
| TEST_ONLY-report.json | 19731 | Complete, 7210 Tokens and full version/scope metadata |
| TEST_ONLY-trend.csv | 1569 | Complete |
| TEST_ONLY-summary.md | 8954 | Complete |
| TEST_ONLY-retry.csv | 35370837 | Complete new download after interruption, 601 lines |

During a slowed native CSV download, switching Codex to Claude leaves the original download progressing. A second export shows the English busy message. Stop leaves a Safari `.download` file labelled stopped; Cancel in Save returns to the page without another completed file. A forced network interruption at about 1 MiB leaves a partial file and Safari explicitly reports lost connection. A new Dashboard download saves the full retry CSV; no resume is used. A stale preflight reloads snapshot three with a review/retry notice and opens no Save dialog.

The in-app page shows Traditional Chinese busy and handoff text. A preparation delayed two seconds, followed immediately by Provider change, produces no late native download, error or busy state; captured wire-file count stays unchanged. Both locale flows have no captured console errors. Expired/used tickets and Range errors were exercised over HTTP; native browser handling is reported only where observed, rather than inferred from translations.

Local proof directory: `/Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/stream-export-native-qa/`. It contains actual files and `verification.json` with hashes/exact-wire matches. Adjacent `stream-download-progress.png`, `stream-download-interrupted.png` and `stream-export-busy-zh.png` preserve desktop evidence. These are synthetic test data, not production Sessions or tickets.

## Limits and cleanup

All changed JavaScript syntax, documentation links and git diff checks passed. Temporary app roots, child listeners and agent-created browser tabs are removed. Production port 3333, real settings/credentials and live upstream services were not changed or called. No install, push, release or deployment occurred.

The source contract harness is skipped because it can fetch upstream prices and write source caches. Windows, other Node/browser versions, real Provider logs, live services, arbitrary capacity and concurrent refresh memory remain unverified. R02 pricing publication ownership/durability and V04 storage-failure injection remain separate phases. This delivery satisfies the selected local Q40–Q50 workload, with those practical boundaries retained.

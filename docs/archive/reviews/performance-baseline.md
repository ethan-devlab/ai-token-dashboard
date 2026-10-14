# Large-data performance baseline

Date: 2026-10-01 (Asia/Taipei). Measured product source: a0ad92c on main. Scope: isolated backend measurements before selecting resource targets. No product code or pricing, accounting, export-limit, synchronization or UI policy changed.

## Method and reproduction

Run `node tests/performance-baseline.mjs <result.json>` from the repository. The harness copies the application into a private temporary directory, generates synthetic Codex JSONL and valid canonical pricing archives, and starts actual HTTP servers on temporary loopback ports. Both Provider roots and credential homes point to disposable directories. Every child fetch is intercepted and returns a local 503. The final run recorded one blocked pricing request and no upstream request. Servers stop and the temporary directory is removed in the success/failure cleanup path. No production process, credentials, source settings or source pricing cache is used.

Environment: macOS arm64, Node v26.0.0, 12 logical CPUs, 24 GiB RAM. AUTO_REFRESH=0, PARSE_CONCURRENCY=2, MAX_FILES=10000. Normal workloads have 100 observations per Session, distinct Session/event identities, 10 workspace labels, two alternating models (gpt-5 and gpt-5.5), and 100 hourly timestamps starting 2026-09-01 UTC. Queries use all-time/UTC, 100-row pages and stable projection time/version for pages, detail and exports. Token and cost coverage are exact: 12 Tokens per observation, all priced; no incomplete, duplicate or truncated scan. These fixtures do not represent measured real-user distributions.

Each normal log workload starts a fresh server. Startup to listen readiness takes about 104–105 ms and is excluded from the first-dashboard duration. First dashboard includes discovery, parse, reconciliation, aggregation, projection and HTTP body delivery. It is not a cold disk-cache measurement: files were just generated. Warm dashboard and last page each have two sequential samples; filtered query, detail and each export have one. The archive sequence grows one running server's retained directory from 1 to 10000 revisions; each first/last page has two samples. Its cumulative memory is not an isolated per-cardinality allocation.

Elapsed time uses the parent clock from fetch to complete body consumption. Test-only preload instrumentation records HTTP-handler duration and process.memoryUsage before/after the handler. External ps samples child RSS at a nominal 100 ms interval plus ps cost; an in-flight sample can finish after the response. Short operations often have one sample. Observed maximum RSS below is the maximum of sampled RSS and handler before/after RSS. It is a lower bound on the true process peak, not an exact peak or operation-only allocation. RSS includes retained memory from earlier requests in the same workload. No forced GC, heap-leak conclusion, p95 or concurrent-load claim is made. Instrumentation and external sampling add overhead.

The complete final-run values, response sizes, counts, scan timings, memory snapshots and sample counts are in [performance-baseline-evidence.json](../evidence/performance-baseline-evidence.json). An initial exploratory run covered two exports; the final run added both other formats and complete price-coverage assertions. Only the final 48 request measurements are reported here. These are benchmark observations, not 48 independent regression tests.

## Query and export results

Times are milliseconds. Two-sample ranges show the observed minimum and maximum, not a percentile.

| Observations / Sessions | First dashboard | Warm dashboard | Last 100-row page | Model-filter dashboard | Detail | Observed max RSS (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10000 / 100 | 257.7 | 133.0–134.8 | 32.2–35.3 | 77.2 | 17.9 | 171.5 |
| 50000 / 500 | 943.7 | 627.1–644.8 | 149.7–150.8 | 349.2 | 83.9 | 273.2 |
| 150000 / 1500 | 2680.3 | 1873.4–1883.6 | 429.6–431.5 | 1087.4 | 257.7 | 625.3 |

| Observations | Session CSV | JSON report | Trend CSV | Markdown summary |
| --- | ---: | ---: | ---: | ---: |
| 10000 | 133.2 | 137.5 | 132.1 | 132.3 |
| 50000 | 613.5 | 615.1 | 598.9 | 603.5 |
| 150000 | 1867.3 | 1858.8 | 1851.7 | 1886.5 |

At 150000 observations, dashboard JSON is 173882 bytes, the last Session page is 172921 bytes, and detail is 34542 bytes. Exports are 960532 bytes (Session CSV), 19913 (JSON), 3316 (trend CSV) and 8957 (Markdown). Even the small reports take about the full projection time. The initial scan reports 29 ms discovery, 526 ms parse, 223 ms aggregation and 25 ms verification; warm requests reuse the snapshot but rebuild projection data. Source inspection confirms every export currently calls buildDashboardPayload with all matching Sessions, including trends/facets/sorting. Detail also filters and computes cost across all Sessions before finding the requested key. These are candidates for profiling and selective work; the benchmark does not prove any single function's CPU share.

Handler-after heapUsed reaches 323.8 MiB during the 150000-observation sequence. The 625.3 MiB RSS observation includes repeated requests and four formats in one process. It does not establish idle retained heap or a memory leak. A future memory target must use the same sequence and a stated sampling method.

## Export-size boundary

A separate adversarial fixture uses 500 Sessions, one observation each, and 70000 extra characters in each Session ID. Input is 35144890 bytes. Its Session-ID fields alone exceed 32 MiB, so it exercises the real buffered export limit without creating a huge observation population. It is not a typical Session-ID workload.

The first dashboard sends 7168364 bytes in 204.2 ms; RSS rises from 60.6 to 500.0 MiB at handler boundaries. CSV export returns 413 EXPORT_TOO_LARGE, a 155-byte error, in 31.8 ms. Handler heapUsed rises from 176.3 to 219.3 MiB and RSS from 500.0 to 550.9 MiB during that request. The complete export body is constructed before rejection in the current code. A subsequent Provider query succeeds in 0.9 ms. Rejection and service survival passed in this bounded case; memory-bounded rejection, interrupted downloads and concurrent-load responsiveness are not certified.

## Pricing-version list

The active bundled basis is retained. Added revisions contain complete canonical rules with distinct valid rates, and every returned item is verified by the actual archive reader. No empty placeholder files are used. Missing optional check metadata is valid. Pages contain at most 100 revisions, ordered by revision as in the current API.

| Retained versions | First page (ms) | Last page (ms) | Observed max RSS for this sequence stage (MiB) |
| --- | ---: | ---: | ---: |
| 1 | 1.9–3.2 | Same page | 61.2 |
| 100 | 14.3–16.5 | Same page | 77.7 |
| 1000 | 11.8–16.0 | 13.5–17.2 | 96.2 |
| 10000 | 16.3–22.9 | 21.5–23.0 | 101.2 |

The 10000-version response is about 18 KiB. readdir and sorting still process every retained filename. These results do not establish behavior at 100000 versions, metadata-heavy archives, damaged records or multiple callers. At the measured scale the version list is a lower priority than projection work; permanent retention under Q32 remains unchanged.

## Verification and next decisions

The final command passed exact matched Session/Token/price counts, complete scan/quality, selected-model totals, last-page counts, detail counts, complete CSV row counts, pinned report totals/scope, trend row counts, Markdown totals, the real 413 error, service survival and verified archive pages. Syntax, evidence consistency, documentation links and git diff --check passed. The temporary root and child listeners were removed. No broad suite or source contract harness ran: product code did not change, and the latter can fetch upstream/write source caches.

This baseline measures backend HTTP work. It does not certify browser render time, native downloads, another Node version, Windows, Claude's larger cache/modifier payloads, calendar comparison/DST queries, long histories, concentrated observations in one Session, query-cache hit rates, interrupted requests or multiple users. Those workloads require separate selected checks.

The decision frontier is implementation priority and accepted workload scale. Recommended first scope is query/projection reuse plus export generation and bounded size rejection. Keep the 10000-version list as a regression boundary until data establishes a problem. After the user selects scope and scale, decide numeric latency/memory targets, projection-cache ownership/invalidation limits if needed, and export rejection/delivery semantics. Do not silently select a database, worker architecture, streaming API, new dependency or a higher export cap from this baseline.

## Historical checkpoint

This record and raw evidence remain the capped-export baseline. The original harness is available at commit 8a488b1. The current runnable tests/performance-baseline.mjs now verifies Q40–Q50 uncapped preparation/transfer and a slow consumer, with the selected local numeric targets. See [the subsequent implementation evidence](../validation/query-export-performance-validation.md); historical 413 results above do not describe current product behavior.

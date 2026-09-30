# Dashboard functional audit

Phase 1 disposition (2026-10-01): FA04–FA06 and the selected FA10/FA18/FA22/FA23 policies are implemented. See [phase1-accounting-validation.md](phase1-accounting-validation.md) for current evidence. The findings and original probe JSON below remain the audit baseline; later-phase findings are still open.

Phase 2 disposition (2026-10-01): FA01–FA03 and FA21 are implemented. The selected calendar/progress comparison, IANA/DST, and strict local-input policies are also implemented. See [phase2-calendar-validation.md](phase2-calendar-validation.md). Original findings below retain their baseline evidence.

Phase 3 disposition (2026-10-01): FA08/FA09/FA11/FA14/FA19 are implemented. The scan/write fingerprint mismatch was reproduced before changes; whole-refresh rollback, stable-pass publication, file coverage, and watcher recovery were validated. See [phase3-reliability-validation.md](phase3-reliability-validation.md). The original audit below remains historical evidence.

Date: 2026-10-01 (Asia/Taipei). Baseline: `665af57` on `main`.

The user accepted the UI result and selected a complete functional review before implementation decisions. This review covers both provider parsers, token/cost calculations, ranges, projections, pagination, refresh/watchers, quotas, exports, settings, pricing, and update checks. Production code and data have not changed.

## Method and evidence

Current code and documented contracts are the primary evidence. `tests/manual-functional-audit.mjs` calls shipped modules with synthetic records. `tests/manual-functional-http-audit.mjs` runs a temporary copy of the shipped HTTP server with 251 Codex fixtures and one Claude fixture. Its external fetch always returns a fixed 503 response. It has no real `.env` or CLI credentials. Temporary files and child processes are cleaned up.

The captured results are in [functional-audit-evidence.json](functional-audit-evidence.json). These scripts report behavior, not passing regression expectations. Exit code zero means the probes completed; it does not mean the discovered defects passed. Synthetic records are never shown in the production dashboard.

Reproduction on macOS zsh, or as separate commands in Windows PowerShell:

```sh
node tests/manual-functional-audit.mjs
node tests/manual-functional-http-audit.mjs
```

The HTTP probe uses Node's `--import` preload and needs Node 18.19 or later. This pass ran on Node `v26.0.0` on macOS. No Node 18/22/24 or Windows compatibility claim follows from that run.

## Confirmed findings

P1 means incorrect data, incomplete exports, lost valid results, or a broken core query. P2 means validation, recovery, or reporting defects with a narrower trigger. Severity assumes the stated trigger; it does not claim the user's current real files contain that trigger. There are 17 reproduced findings: 12 P1 and five P2.

| ID | Priority | Trigger and current result | Source and evidence |
| --- | --- | --- | --- |
| FA01 | P1 | Select `2026-W01`. The pure resolver returns September 14 with a fixed September clock; the HTTP server returns September 28 with its execution clock. Both ignore the requested December 29, 2025 start. | `server/timezone.mjs:85`, FA01 / HTTP02. The browser does send `period`. |
| FA02 | P2 | `2026-02-31T00:00` becomes March 3 and HTTP 200. Month `2026-13` silently becomes the current month, also HTTP 200. | `server/timezone.mjs:55`, `server/timezone.mjs:65`, `server.mjs:53`; FA02 / HTTP03 / HTTP04. |
| FA03 | P1 | The two New York November 1, 2026 01:30 hours, at 05:30Z and 06:30Z, both enter the 05:00Z hourly bucket. Distinct repeated hours are merged. | `server/timezone.mjs:102`, FA03. Exact browser interval URLs cannot repair server bucket identity. |
| FA04 | P1 | Claude reports 10 uncached, 20 cache read, 70 generic cache write, and five output tokens. Parser/API return 35 total instead of 105 because only TTL-specific cache-write counters are read. | `server/claude-session.mjs:16`, FA04 / HTTP05. |
| FA05 | P1 | A Session contains model A's two tokens and model B's five tokens. Ranking attributes all seven to A; facets omit B; selecting B excludes the Session. | `server/dashboard-data.mjs:65`, `server/dashboard-data.mjs:104`, FA05. Model ranking is inconsistent with event-level cost calculation. Filter semantics need a decision below. |
| FA06 | P1 | Unknown pricing modifiers make aggregate and model costs partial, but the same trend point reports `partialCost=false`. | `server/dashboard-data.mjs:88`, FA06. Trend only checks unpriced tokens, not unknown modifiers. |
| FA07 | P1 | A query matches 251 Sessions. Session CSV contains 200 rows. Direct offset 200 exports only the final 51. No truncation notice is returned. | `server.mjs:148`, `server/dashboard-data.mjs:143`, FA07 / HTTP01. Export uses the paged dashboard projection. |
| FA08 | P1 | One Session with 150,000 accepted observations causes an all-time projection to throw `RangeError: Maximum call stack size exceeded`. | `server/dashboard-data.mjs:91`, FA08. `Math.max/min(...events)` exceeds this runtime's argument capacity. This is a failure reproduction, not a performance benchmark. |
| FA09 | P1 | A valid indexed file contributes 110 tokens. After a changed file contains JSON `null`, its parse fails; refresh completes with total zero and drops the last good file. Retry stays at zero. | `server/session-index.mjs:179`, FA09. Whole-loader failures retain a snapshot, but per-file failures are published as a successful pass. Recovery policy needs a decision. |
| FA11 | P2 | Exactly one existing file with `MAX_FILES=1` is labelled truncated even though no file was omitted. | `server/session-index.mjs:186`, FA11. Discovery does not distinguish reaching the cap from exceeding it. |
| FA12 | P1 | Null quota utilization becomes zero used / 100% remaining. Codex null reset becomes January 1, 1970. | `server/account-usage.mjs:20`, FA12. `Number(null)` creates false measured values. |
| FA14 | P2 | Watcher starts with a missing directory. The directory later appears and provider availability becomes true, but watcher remains unavailable. | `server/provider-registry.mjs:23`, FA14. No recovery/rebind path exists. |
| FA16 | P1 | A page response from snapshot 2 updates KPI and Session totals to two tokens; merging it into snapshot 1 leaves trend/models at one token. After another client advances the HTTP snapshot, an unchanged query's JSON export returns 2772 rather than the old displayed 2761 tokens, without export snapshot metadata. | `public/scripts/dashboard.mjs:189`, `public/scripts/dashboard.mjs:241`; FA16 / HTTP07. The merge is a replay of the exact source expression with shipped builders; a multi-tab browser race was not run. |
| FA17 | P2 | Markdown export for an exact custom interval contains only `Range: custom (UTC)`, with neither start nor end bounds. It cannot identify the exported period. | `server/dashboard-data.mjs:145`, FA17. Query/filter and snapshot provenance also need a shared export contract. |
| FA19 | P1 | An index marked truncated does not propagate that flag or the cap into dashboard/quality metadata. The client has no file-cap warning condition. | `server/dashboard-data.mjs:118`, `public/scripts/dashboard.mjs:100`; FA19. Incomplete analytics can appear complete. |
| FA20 | P1 | Two settings saves in the same millisecond share a temporary path. One reports saved Port 3334, but the file contains 3335; the other rejects with `ENOENT`. | `server/settings.mjs:104`, FA20. The isolated probe freezes `Date.now` to force this valid concurrency trigger. It does not touch the real configuration. |
| FA21 | P2 | `limit=0` is accepted with HTTP 200, no rows, and `hasNext=true`. A consumer that advances by the returned limit cannot progress. | `server.mjs:42`, HTTP06. Offset zero is valid; page limit zero should be rejected. |

Claude's official [prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#tracking-cache-performance) defines total input as uncached input plus cache reads plus cache writes. This supports FA04's token count. When a log omits the TTL breakdown, the duration and exact cache-write price are still unknown; retaining the tokens does not justify guessing their price.

## Behaviors that require policy decisions

These are reproduced behaviors with unresolved intended semantics, not additional confirmed defects.

| ID | Current behavior | Recommended decision to evaluate |
| --- | --- | --- |
| FA10 | An earlier model-A cumulative delta of 110 numerically covers and discards a later model-B turn of six. Coverage ignores turn identity, model, and time relation. Partial counter resets also reset the entire previous usage vector. | Define supported log variants and an identity/time-bounded reconciliation policy. Keep ambiguous observations and explicit quality evidence without blindly adding or discarding both sources. Do not claim the correct total is 116 without deciding whether the sources describe separate usage. |
| FA13 | After a successful 75%-remaining quota read, a service failure removes all windows and caches the unavailable result for 60 seconds. | Retain last good quota with explicit check time, stale status, and failure reason. Never show stale quota as current, or reset stale data to zero/100%. |
| FA18 | Two different files with the same Session ID have distinct path-derived keys and are both counted: ten plus ten becomes 20. | Distinguish copied files from resumed/branched sessions by provider identity and observation provenance. A matching Session ID alone does not prove duplicate usage. |
| FA22 | A partial cost lower bound of USD 10 against a USD 100 budget is classified `ok`. The amount has a lower-bound label, but classification ignores uncertainty. | Use an indeterminate status below thresholds when cost is partial; a known subtotal already above a threshold still proves warning/exceeded. |
| FA23 | Input remains 100 while Output falls from ten to five. Whole-vector reset produces accepted Input 200 and Total 215, with a partial-reset count but no ambiguity count. | Skip the uncertain increment, update the baseline, and report incomplete usage. This was subsequently selected by the user. |

Decisions after the initial audit: retain FA22's known-cost classification with visible partial-pricing context, rather than the proposed indeterminate state. Use cumulative priority per model for FA10; do not describe unmatched turns as proven covered. FA18 deduplication needs identical file content or explicit event identity within the selected execution scope; Session ID alone is insufficient. These decisions are recorded in the refactor plan; the initial findings are not yet fixed.

Further dependent decisions: model filtering by matching observations versus complete Sessions; prior calendar period versus equal-duration comparison; exports matching displayed snapshot versus explicitly exporting latest; automatic watcher-to-browser synchronization; and pricing using current published rates versus a historical rate ledger. Current comparisons use equal elapsed duration. Current pricing refresh replaces rates rather than retaining a rate history. These facts alone do not establish bugs.

## Candidate risks and verification gaps

- FA15: a superseded failed request can still throw a generic error from the channel helper because stale detection follows `response.ok`. Main projection loads have a generation guard, but quota/update/diagnostics callers need a targeted race review. The fake-fetch reproduction ignores cancellation; no real browser stale-error overwrite is claimed.
- Watcher events during an in-flight scan join the same cache refresh. There is no dirty-generation follow-up queue. A scan/write timing reproduction is required before assigning severity.
- JSONL files can change while discovery fingerprints and parser reads occur. Content identity checks, unchanged-size/mtime replacement, symlinks, file deletion during discovery, partial appended lines, empty first scan, and worker interruption need focused fixtures before a reliability redesign.
- Detail returns at most 2000 observations and its limit, but no explicit truncation flag. The fixture shows total 2001 and 2000 returned. Decide whether diagnostics should expose complete counts and pagination; retaining a bounded detail response is required.
- Native browser download completion, unload warnings, Windows filesystem/recursive-watch behavior, forced colors, assistive technology, and Node 18/22/24 remain unverified. The old UI screenshots and client geometry tests do not validate backend repeated-hour grouping.
- Upstream live pricing-document format, live quota endpoints, real OAuth rotation conflicts with a running CLI, and subscription semantics were not exercised. Existing service tests use fake responses. No prices or real credential files were changed.
- `/api/summary` deliberately retains legacy all-snapshot totals with filtered rows. Do not change that deprecated contract without a separate compatibility decision.

## Coverage and checks

| Surface | Evidence and current disposition |
| --- | --- |
| Parsers and token/cost accounting | FA04–FA06, FA10, FA18; existing Codex/Claude parser and pricing checks pass. Generic cache, model changes, reconciliation, and duplicate provenance need work. |
| Calendar, DST, custom range | FA01–FA03 plus HTTP02–HTTP04; the existing timezone check passes but omits historical week selection and the repeated-hour grouping case. |
| Incremental refresh and watcher | FA09/FA11/FA14/FA19, CHECK02/04; unchanged-file reuse and whole-refresh rollback work. Per-file failure and cap/recovery contracts need work. |
| Provider isolation and pagination | HTTP boundary probes pass; FA05/FA16/FA21 identify attribution, version, and validation problems. |
| Quota | FA12/FA13; fixed-endpoint credential privacy and fake OAuth rotation checks pass. Null values and stale recovery need work. |
| Export | FA07/FA16/FA17; all four builders were read and CSV/JSON/Markdown paths probed. Real browser file creation was not tested. |
| Settings | CHECK01, HTTP settings checks; validation and preservation of unrelated lines work. FA20 requires safe save serialization and temporary-file identity. |
| Pricing and update checks | Eight targeted existing checks cover rate matching, parsers, cadence, failure retention, config, and stable-release checks. No live endpoint or current-price certification. |
| Client state and recovery | 33 existing client checks pass. Version-safe page merging, export provenance, stale-error races, and uncertain budget classification are not covered. |

Service checks ran in two non-overlapping groups: 11 core checks and eight pricing/update/config checks, 19 passed in total. Client checks: 33 passed. This did not rerun the existing contract harness because it starts the source checkout's server with its pricing-cache paths and automatic external refresh. The isolated HTTP probe exercised actual routes without those side effects. No mobile/tablet work, production browser mutations, configuration save, quota refresh, JSONL rescan, push, release, or deployment was performed.

The next decisions and phase gates are in [dashboard-functional-refactor-plan.md](dashboard-functional-refactor-plan.md). This audit is complete as a bounded first pass, not an exhaustive certification. All findings are open at this checkpoint.

## Phase 4 implementation disposition

FA07/FA16/FA17 have focused implementation evidence in [phase4-projection-validation.md](phase4-projection-validation.md). All 251 matched Sessions export once at offset 200. Guarded page/detail/export reject changed snapshot or pricing basis; desktop conflicts reload the full projection and stop download until a new user action. The original audit evidence above remains the historical baseline. Q19/Q20 are confirmed. Q21 received no dialog response; empty CSV preserves the existing header-only format as a compatibility assumption. Native browser download completion remains unverified. Phase 5 quota/settings work remains open.

# Dashboard functional audit

Current disposition: [functional-status-inventory.md](functional-status-inventory.md) reconciles FA01–FA24 and delivery through Q60 at source checkpoint 59e30b6. All 17 original reproduced defects have correction evidence. The baseline tables below describe the original triggers, not current behavior.

Phase 1 disposition (2026-10-01): FA04–FA06 and the selected FA10/FA18/FA22/FA23 policies are implemented. See [phase1-accounting-validation.md](phase1-accounting-validation.md). The findings and original probe JSON below remain the audit baseline; later dispositions are recorded below and in the current inventory.

Phase 2 disposition (2026-10-01): FA01–FA03 and FA21 are implemented. The selected calendar/progress comparison, IANA/DST, and strict local-input policies are also implemented. See [phase2-calendar-validation.md](phase2-calendar-validation.md). Original findings below retain their baseline evidence.

Phase 3 disposition (2026-10-01): FA08/FA09/FA11/FA14/FA19 are implemented. The scan/write fingerprint mismatch was reproduced before changes; whole-refresh rollback, stable-pass publication, file coverage, and watcher recovery were validated. See [phase3-reliability-validation.md](phase3-reliability-validation.md). The original audit below remains historical evidence.

Date: 2026-10-01 (Asia/Taipei). Baseline: `665af57` on `main`.

The user accepted the UI result and selected a complete functional review before implementation decisions. The baseline review covered both provider parsers, token/cost calculations, ranges, projections, pagination, refresh/watchers, quotas, exports, settings, pricing, and update checks. At that baseline pass, product code and production data had not changed. Later checkpoints changed source code with isolated validation; they did not certify a production rollout.

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

| ID | Priority | Trigger and baseline result | Source and evidence |
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

## Baseline behaviors that required policy decisions

These were reproduced behaviors with unresolved intended semantics at the original audit, not additional confirmed defects. The user subsequently selected policies; the current inventory records their implementation.

| ID | Baseline behavior | Original recommendation to evaluate |
| --- | --- | --- |
| FA10 | An earlier model-A cumulative delta of 110 numerically covers and discards a later model-B turn of six. Coverage ignores turn identity, model, and time relation. Partial counter resets also reset the entire previous usage vector. | Define supported log variants and an identity/time-bounded reconciliation policy. Keep ambiguous observations and explicit quality evidence without blindly adding or discarding both sources. Do not claim the correct total is 116 without deciding whether the sources describe separate usage. |
| FA13 | After a successful 75%-remaining quota read, a service failure removes all windows and caches the unavailable result for 60 seconds. | Retain last good quota with explicit check time, stale status, and failure reason. Never show stale quota as current, or reset stale data to zero/100%. |
| FA18 | Two different files with the same Session ID have distinct path-derived keys and are both counted: ten plus ten becomes 20. | Distinguish copied files from resumed/branched sessions by provider identity and observation provenance. A matching Session ID alone does not prove duplicate usage. |
| FA22 | A partial cost lower bound of USD 10 against a USD 100 budget is classified `ok`. The amount has a lower-bound label, but classification ignores uncertainty. | Use an indeterminate status below thresholds when cost is partial; a known subtotal already above a threshold still proves warning/exceeded. |
| FA23 | Input remains 100 while Output falls from ten to five. Whole-vector reset produces accepted Input 200 and Total 215, with a partial-reset count but no ambiguity count. | Skip the uncertain increment, update the baseline, and report incomplete usage. This was subsequently selected by the user. |

Decisions after the initial audit: retain FA22's known-cost classification with visible partial-pricing context, rather than the proposed indeterminate state. Use cumulative priority per model for FA10; do not describe unmatched turns as proven covered. FA18 deduplication needs identical file content or explicit event identity within the selected execution scope; Session ID alone is insufficient. These decisions are implemented and recorded in the refactor plan and phase validation reports.

The original dependent decisions included model filtering, calendar comparisons, export snapshot identity, browser synchronization and current prices versus a historical ledger. The staged decisions now define observation filtering, calendar alignment, displayed projection exports and manual browser updates. Q28–Q33 retain current-basis estimation with complete read-only archives; a historical effective-rate ledger remains separate scope. See [pricing-archive-validation.md](pricing-archive-validation.md). The initial pricing/comparison behavior alone did not establish bugs.

## Candidate risks and verification gaps

- FA15: the original HTTP-status path was corrected in Phase 4. The later [request-race checkpoint](request-race-validation.md) reproduced and fixed late fetch/body exceptions that bypassed stale detection, plus update/diagnostic busy ownership after Provider changes. Controlled promises deliberately ignore cancellation; a separate browser case verifies native abort. This does not claim normal fetch routinely ignores its signal.
- Phase 3 adds dirty-generation follow-up passes before publication, bounded to three candidate passes. Scan/write mismatch and failed follow-up rollback have focused evidence. This is a stable admitted pass, not an atomic filesystem snapshot. See [phase3-reliability-validation.md](phase3-reliability-validation.md).
- Phase 3 validates fingerprint checks, same-size restored-mtime replacement, in-flight writes, active worker termination and root recovery. Actual watcher errors, worker exit without a message, symlink-swap/deletion timing, partial append and empty-directory edge cases still need focused fixtures; see V05 in the current inventory.
- The initial detail fixture showed total 2001 and 2000 returned without an explicit truncation flag. Q27 is now complete: exact selected count, returned count, limit, and truncation prompt, with full Token/cost totals. See [detail-completeness-validation.md](detail-completeness-validation.md). Pagination and an observation table are outside this scope.
- The [native Safari checkpoint](browser-download-settings-validation.md) verifies actual download bytes, cancellation and unload warnings. [Stream delivery](query-export-performance-validation.md) subsequently verifies >32 MiB files, interruption/retry, pinned content and backpressure. Other browsers, Windows filesystem/recursive-watch behavior, forced colors, assistive technology and Node 18/22/24 remain unverified. Phase 2 separately validates backend repeated-hour grouping.
- Upstream live pricing-document format, live quota endpoints, real CLI login-change timing and subscription semantics were not exercised. Q34 removes dashboard OAuth rotation. Existing service tests use fake responses; no real credential files were changed.
- `/api/summary` deliberately retains legacy all-snapshot totals with filtered rows. Do not change that deprecated contract without a separate compatibility decision.

## Coverage and checks

| Surface | Evidence and current disposition |
| --- | --- |
| Parsers and token/cost accounting | [Phase 1](phase1-accounting-validation.md) resolves generic cache, model attribution, partial cost and selected reconciliation policies. Real log variants remain a validation gap. |
| Calendar, DST, custom range | [Phase 2](phase2-calendar-validation.md) validates historical week, strict inputs, repeated hours and selected comparison rules. |
| Incremental refresh and watcher | [Phase 3](phase3-reliability-validation.md) validates full rollback, stable publication, cap reporting and root recovery. Remaining scan/watch paths are V05. |
| Provider isolation and pagination | [Phase 4](phase4-projection-validation.md) and [request races](request-race-validation.md) validate projection guards and request ownership. |
| Quota | [Phase 5](phase5-reliability-validation.md) validates unknown values, stale/reset behavior and detected credential changes with synthetic credentials. Live endpoints remain unverified. |
| Export | [Phase 4](phase4-projection-validation.md) validates full matched coverage and provenance; [native streaming](query-export-performance-validation.md) adds exact saved bytes, >32 MiB files, interruption/retry and bounded transfer resources. |
| Settings | [Ownership validation](settings-ownership-validation.md) adds one startup writer and explicit recovery to required revisions; [native Safari](browser-download-settings-validation.md) validates leave prompts. External editors must stop the writer. Remaining storage/platform coverage is R01/V04. |
| Pricing and update checks | [Pricing ownership](pricing-ownership-recovery-validation.md) adds publication, per-response verification, explicit reader load and guarded repair to complete archives. Mock update checks cover stable-release handling; live endpoint certification remains V02. |
| Client state and recovery | [Cross-phase acceptance](functional-integration-validation.md) fixes FA24; [request races](request-race-validation.md) closes FA15 within the tested scope. Budget policy remains the user's selected known-cost classification. |

At the baseline audit, service checks ran in two non-overlapping groups: 11 core checks and eight pricing/update/config checks, 19 passed in total. Client checks: 33 passed. This did not rerun the existing contract harness because it starts the source checkout's server with its pricing-cache paths and automatic external refresh. The isolated HTTP probe exercised actual routes without those side effects. No mobile/tablet work, production browser mutations, configuration save, quota refresh, JSONL rescan, push, release, or deployment was performed in that baseline pass. Later isolated checks are recorded in their own reports; their counts overlap.

The decisions and phase gates are in [dashboard-functional-refactor-plan.md](dashboard-functional-refactor-plan.md). This audit was a bounded first pass, not an exhaustive certification. All findings were open at the original baseline; [functional-status-inventory.md](functional-status-inventory.md) is the current disposition.

## Phase 4 implementation disposition

FA07/FA16/FA17 have focused implementation evidence in [phase4-projection-validation.md](phase4-projection-validation.md). All 251 matched Sessions export once at offset 200. Guarded page/detail/export reject changed snapshot or pricing basis; desktop conflicts reload the full projection and stop download until a new user action. The original audit evidence above remains the historical baseline. Q19/Q20 are confirmed. The user subsequently confirmed Q21: empty CSV now carries a typed metadata record, with blank measurements and complete query/version fields. This supersedes the initial header-only default. The later [native Safari checkpoint](browser-download-settings-validation.md) confirms four actual downloads with exact pinned API byte comparisons, save cancellation, export conflict and settings leave/reload behavior. Other browser and platform coverage remains unverified.

## Phase 5 implementation disposition

FA12/FA13/FA20 have focused evidence in [phase5-reliability-validation.md](phase5-reliability-validation.md). Unknown quota values remain unknown; transient upstream failures retain explicit stale data; login changes clear old data; stale windows past reset become unknown. Settings serialize exclusive temporary writes and reject missing/stale revisions. Desktop conflicts retain edits and ask before reload. A fake Claude refresh also confirmed the candidate concurrent-CLI overwrite risk; Q26 includes digest checks before rotation writes. Detected file changes preserve the CLI replacement and clear old quota. External writes after the final check remain a documented cross-process race. These results preserve the original audit as historical evidence and do not certify live upstream or Windows behavior.

## Cross-phase acceptance disposition

[functional-integration-validation.md](functional-integration-validation.md) records 115 passing baseline checks, all five isolated phase HTTP fixtures, and same-server accounting/calendar/rollback/export/quota/settings behavior. Root desktop QA found FA24 (P2): a successful page read after failed refresh hid the unresolved refresh warning, because its qualifiers were not merged. Equal-identity pages now merge only refreshFailure and retainedSnapshot in addition to pagination fields. The warning persists; snapshot data remains intact; watcher repair triggers full conflict reload. Ten projection and 33 client checks passed after the fix. Subsequent checkpoints close detail-count, pricing-archive, native Safari and FA15 gaps; the current inventory separates remaining scope from completed work.

## Settings and credential ownership disposition

[settings-ownership-validation.md](settings-ownership-validation.md) implements Q34–Q39 after the controlled cross-process probe. Claude credentials are now CLI-owned and read-only to the dashboard; this supersedes Phase 5's automatic rotation. Settings use one cooperating startup writer with explicit recovery and read-only additional instances. The remaining independent-editor interval is governed by stop-before-edit workflow; no shared CLI lock is claimed. Pricing ownership is separately delivered by Q51–Q60 in [pricing ownership validation](pricing-ownership-recovery-validation.md).

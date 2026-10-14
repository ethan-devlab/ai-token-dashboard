# Dashboard functional refactor plan

Date: 2026-10-01 (Asia/Taipei). Status: Phases 1–5, cross-phase FA24 correction, Q27 detail counts, Q28–Q33 archives, native Safari/settings-leave acceptance, FA15 request ownership, Q34–Q39 settings/credentials, Q40–Q50 query/native streaming and Q51–Q60 pricing ownership/recovery are delivered. [functional-status-inventory.md](../reviews/functional-status-inventory.md) records remaining scope at source checkpoint 59e30b6 for user decision.

## Confirmed scope

The user accepted the desktop UI result and requested functional inventory and refactoring. The user selected the complete functional chain and an evidence-backed audit before deciding implementation order. Keep the accepted desktop layout, Traditional Chinese/English, local uPlot, APIs, provider boundaries, and persisted preferences. Add functional status text only where needed to identify stale, incomplete, or unsupported data. No new framework, database, package installation, external service, Service/Tray implementation, or release work is included.

The baseline is `665af57`. [dashboard-functional-audit.md](../reviews/dashboard-functional-audit.md) contains 17 reproduced findings, five policy cases (including the follow-up counter-reset probe), and candidate risks. [functional-audit-evidence.json](../evidence/functional-audit-evidence.json) stores isolated results. UI completion did not establish functional completeness.

Decisions confirmed after audit checkpoint commit `b222703`:

- Start with usage and cost correctness.
- If any file fails parsing, abort the entire refresh and retain the last complete snapshot. The reliability phase must preserve this decision.
- Model filters apply to matching observations. KPI, trend, model, Session, and export totals describe only those observations.
- Include mixed-source reconciliation and cross-file duplicate provenance in Phase 1; complete their policy decisions first.
- Retain generic cache-write tokens when TTL is unknown. Do not guess a write price; report known cost as a lower bound.
- Keep budget classification based on known cost. Explicitly describe partial pricing; do not change the selected `ok` behavior to indeterminate.
- Per-model cumulative usage takes priority over unmatched turn usage. Unmatched same-model turns are not added again or claimed to be proven covered; report uncertainty. Turn-only models remain countable.
- Deduplicate within provider/Session scope only when file contents are identical or explicit event identity proves duplication. A matching Session ID alone does not remove usage.
- On partial counter decrease, skip the uncertain increment, advance the baseline, and report incomplete data. Do not reset the whole vector and re-add unchanged counters.
- For the same explicit usage-event identity, select the latest valid version using reliable timestamp and same-file sequence. If cross-file versions cannot be ordered, flag a conflict and do not add them together or combine per-field maxima. A turn/context ID is not automatically a unique usage-event ID.
- Main execution and each distinct subagent have separate deduplication scopes, even if they share a Session ID. Keep the existing default inclusion of subagents.
- Preserve adopted Token totals with explicit incomplete/possible-duplicate reasons. Do not put one lower-bound symbol on all uncertain Token values: possible duplication can also overstate usage.
- The user answered all Phase 1 policy questions and selected full Phase 1 implementation. [phase1-accounting-validation.md](../validation/phase1-accounting-validation.md) records the implementation and focused evidence. Later-phase policy decisions remain separate gates.

## Target invariants

1. Raw usage is normalized once with explicit provider/event provenance. Unknown tokens, prices, modifiers, and quota values do not become measured zero or complete coverage.
2. Reconciliation removes observations only with sufficient evidence. A Session label is metadata; event-level model usage remains available for ranking and cost calculations.
3. A query has validated civil/instant bounds, an IANA timezone, and a half-open interval. A selected ISO week is authoritative; repeated DST hours have distinct instant buckets.
4. Each complete projection has one provider, query, snapshot version, and pricing revision. KPI, models, trend, Session pages, detail, and exports may not silently combine versions.
5. File refresh publishes data according to an explicit failure policy. Missing/deleted files, failed changed files, caps, and estimated timestamps are distinguishable.
6. Export completeness is independent of screen pagination. Every export identifies its provider, period/bounds, timezone, filters, snapshot, and pricing basis without leaking transcript content or paths.
7. Configuration saves have isolated temporary files and a defined concurrent-save order. Successful responses describe the committed result; security checks and restart semantics remain intact.

## Phase sequence and ownership

Phase 0 is the audit checkpoint. Commit its records and probe scripts before changing production code. The root agent performs implementation and all visual/runtime checks. Do not delegate visual QA. Every subsequent phase ends with focused validation, an explicit file review, a successful commit, and a user decision dialog.

### Phase 1 — Usage, cost, and uncertainty

Recommended first because incorrect numbers invalidate downstream analysis.

Own `server/claude-session.mjs`, reconciliation/index accounting in `server/session-index.mjs`, `server/usage.mjs`, event model/cost aggregation in `server/dashboard-data.mjs`, and narrowly related Session/detail and quality/budget text in `public/scripts/dashboard.mjs`, `explorer.mjs`, `drawer.mjs`, and `i18n.mjs`. A small pure reconciliation helper is justified if both parse and index stages need the same rules; do not create a general plugin framework. Update only relevant service/client checks and accounting docs. Budget threshold classification in `state.mjs` stays as selected.

Address FA04–FA06 and the selected FA10/FA18 reconciliation scope. FA22 keeps known-cost classification with an explicit partial-pricing description. Retain generic cache-write tokens without assigning an unsupported TTL price. Rank by event model. Apply model filters to matching observations. Share complete/partial/unknown cost qualification across aggregates, models, trend, budgets, and export fields. Validate metadata/reconciliation counters without exposing events containing conversations.

Acceptance: 10+20+70+5 yields 105; unknown TTL cost remains qualified; two/five tokens rank under the correct models; trend cost coverage matches aggregate coverage; ambiguous mixed sources and copied/resumed Sessions follow the chosen policy; a partial subtotal below budget retains known-cost `ok` classification with visible partial-pricing context. Implement first, then add focused regression checks.

Implementation constraints and focused cases:

- Preserve exact generic cache totals and detailed TTL counters without counting the same write twice. Inconsistent total versus TTL breakdown is a quality condition, not permission to discard known tokens. Unknown rates/modifiers must not become falsely complete known cost.
- Event-level model filters run before usage/cost aggregation and before filtered Session summaries. Add selected-model metadata where needed; preserve legacy Session model metadata rather than silently changing its API meaning. Search, facets, model ranking, comparison, detail, and export must agree on which observations remain.
- Keep source identity, reliable time, sequence, raw cumulative counter state, and duplicate evidence separate from accepted deltas. Deduplicating only already-computed cumulative deltas can lose usage or combine incompatible baselines. Reconcile verified versions before calculating deltas; retain unproven distinct records with quality markers according to the selected policy.
- Scope duplicate evidence by provider, trustworthy Session identity, execution type, and agent identity. Byte-identical files are provable copies within that scope. Only explicit usage/message event IDs count as event identity; Session/turn/context IDs are grouping information. Preserve existing stable Session keys where a canonical source remains available.
- Unordered conflicting versions do not receive arbitrary sums or per-field maxima. Keep a previously confirmed version when available; otherwise mark the observation unresolved and incomplete. Same-file later sequence can identify a version even when timestamps tie; cross-file sequence is not comparable.
- Repeated identical cumulative counters are duplicates. A verified full restart and a partial decrease are separate states. For partial decrease, skip the uncertain increment and advance baseline; the next valid increment is still counted. Do not silently infer a full restart from one falling field.
- Test cloned files, copied files with an appended event, two files with the same Session ID but no identity evidence, matching event IDs with later usage, equal/unreliable cross-file timestamps, model changes, turn-only and mixed models, partial reset followed by a normal delta, and main/subagent identity separation. Mark uncertain adopted totals in the API and existing quality surface.
- Run the accounting/client checks affected by these changes and the isolated actual HTTP projection/export probe. Do not rescan real Session files or save real configuration. Live rollout-format coverage requires redacted representative fixtures or schema evidence; synthetic coverage must remain labelled.

### Phase 2 — Query and calendar correctness

Own `server/timezone.mjs`, query validation in `server.mjs`, and only required query-state helpers. Address FA01–FA03 and FA21. Preserve numeric interval URLs and valid existing query parameters. Reject impossible dates, mode-incompatible periods, invalid ISO weeks, zero page limits, and invalid instant bounds with the existing error envelope.

Confirmed Phase 2 decisions (Q13–Q18):

- Day/week/month/year compare the prior calendar period. Last 24 hours and custom ranges compare equal actual milliseconds. All-time has no comparison.
- An unfinished calendar period compares the same local date/time progress. If the corresponding date does not exist, use the prior period end, not the last valid date at the same hour.
- Keep IANA region choices, including Asia/Taipei and America/New_York. Use UTC instants internally and region rules for local boundaries, including DST. Q17 clarified and superseded the earlier ambiguous request to avoid DST.
- Reject ambiguous or nonexistent custom local times. Keep exact chart/URL UTC millisecond bounds so users can select either repeated hour without a silent default.

Implementation assumptions: an automatic comparison with ambiguous or nonexistent prior local progress is unavailable, while the selected dashboard remains available. Future periods have no comparison before they start. Calendar midnight gaps use the first valid instant; repeated midnight uses the earliest boundary. An empty prior calendar period has no comparison. These rules are documented and tested where applicable. Preserve the selected KPI period; use additive comparison currentRange/currentTotals to show its separate progress cutoff.

Implemented evidence: [phase2-calendar-validation.md](../validation/phase2-calendar-validation.md). FA01–FA03 and FA21 are resolved in isolated fixtures and desktop QA.

Acceptance: W01 starts December 29, 2025; impossible February dates and month 13 return 400; valid leap day passes; both New York repeated hours remain separate; spring transition, year/week rollover, IANA query boundary, and numeric exact interval checks pass. `limit=0` fails while `offset=0` remains valid. Run only timezone/query contract checks and a supported desktop control flow.

### Phase 3 — Index refresh and watcher lifecycle

Own discovery and refresh in `server/session-index.mjs`, worker lifecycle in `server/session-parser-worker.mjs`, `server/summary-cache.mjs`, and `server/provider-registry.mjs`. Address FA08/FA09/FA11/FA14/FA19. First reproduce candidate scan/write and worker timing failures; do not build a speculative scanner.

Replace argument-spread min/max with bounded iteration. Discover enough metadata to distinguish exact cap from omitted files. Propagate completeness/cap/retained-file quality. Implement the chosen failed-file policy and a dirty-generation follow-up when a verified in-flight change requires it. Recover a missing/error watcher without duplicate watchers/timers. Keep disk data immutable and index/snapshots memory-only.

Implementation evidence: [phase3-reliability-validation.md](../validation/phase3-reliability-validation.md). FA08/FA09/FA11/FA14/FA19 are resolved in synthetic fixtures and desktop QA. Refresh prepares a candidate index and publishes index provenance and summary together only after stable verification. Any hard file failure aborts the whole pass. Malformed-line and uncertain-usage policies from Phase 1 remain unchanged.

Implementation assumptions: verify admitted file fingerprints before/after parse and before publication; include inode/device/ctime and nanosecond mtime to detect replacements. A cache refresh can attempt at most three passes for in-flight changes; it retains the prior snapshot if stability cannot be established. The watcher schedules a later retry for unstable-file failures. Missing/error watchers retry and check root identity every second, only when AUTO_REFRESH is enabled. Server-side refresh does not add browser polling; browser synchronization remains a later product decision. File-cap exclusions are not reported as confirmed deletions. Omitted counts are a known minimum, not an invented exact count.

Acceptance: 150,000-observation all-time query completes with correct total (no speed claim); unchanged-file reuse holds; a changed-file failure does not silently discard 110 known tokens; genuine deletion removes usage under the selected policy; exact cap is not flagged, exceeding it is flagged end to end; directory recovery resumes watching; teardown removes watchers and workers. Validate in fixtures, not the user's Session directory.

### Phase 4 — Projection, page, and export consistency

Own projection responses/builders in `server/dashboard-data.mjs` and `server.mjs`, cache/state helpers in `public/scripts/projection-cache.mjs` / `request-channels.mjs`, and orchestration in `public/scripts/dashboard.mjs`. Address FA07/FA16/FA17. Q19 selects displayed data: on conflict, stop download and reload the complete dashboard; the user checks it and presses Download again. Q20 selects manual browser updates. No polling or retained historical snapshot store is added. Q21 is now confirmed: empty CSV contains one metadata record with query scope, filters, snapshot and pricing revision. Add recordType=data for normal rows and recordType=metadata for the empty record. Keep measurement cells blank. This replaces the temporary header-only compatibility default.

Use a complete projection identity, including provider, normalized query, snapshot version, and pricing revision. Reject or reload page merges from another identity. Add export metadata without breaking existing omission behavior. Export matched Sessions through an unpaged/streaming path, not `dashboard.sessions`. Keep CSV safety, redaction, request bounds, attachment names, and bounded responses. Review stale failed requests and busy ownership against the new identity.

Confirmed compatibility path: omitted version retains today's API behavior; the shipped client supplies the displayed identity; a mismatch returns a specific conflict and causes an explicit complete reload before retry. This avoids an unbounded historical snapshot cache. The confirmed product choices authorize this implementation. Evidence: [phase4-projection-validation.md](../validation/phase4-projection-validation.md).

Acceptance: all 251 matched Sessions export once; sorting/filtering do not change coverage; page offset does not truncate export; newer pages never leave old charts/models; snapshot advancement during export is detected; every format identifies exact bounds and qualifiers; an old Provider response cannot alter current-provider data. The subsequent native Safari checkpoint confirms actual desktop file completion; other browsers remain unverified.

### Phase 5 — Quota and settings reliability

Own `server/account-usage.mjs`, `server/settings.mjs`, and their existing client controllers. Address FA12/FA20 and the selected FA13 policy. Preserve fixed official destinations, same-Origin validation, loopback access, credential redaction, allow-listed settings and restart-required behavior. This original phase retained atomic OAuth rotation; Q34 subsequently removes it in favor of CLI-only credential management.

Normalize only supported values; null/empty utilization and invalid reset times remain unknown. Keep a provider-isolated last good quota only if explicit stale status is chosen. Use unique exclusive temporary files and serialize same-file settings saves; consider conflict detection only if the user chooses that requirement. Check concurrent OAuth/CLI file rotation in a fake credential fixture before changing that lifecycle.

Acceptance: null quota never shows 100% or epoch reset; measured zero still does; rate-limit/auth/network states remain distinct; stale quota cannot become current; concurrent settings saves have no shared temporary path and no success/file mismatch; unrelated configuration lines survive; invalid input leaves the old file intact. No real credential or `.env` write is part of QA.

Q22–Q26 are confirmed: retain explicit stale quota for transient upstream errors; clear old quota for login failures/changes; mask each stale window after its reported reset; reject stale settings forms and retain edits; require a quoted If-Match revision on every settings save; protect Claude rotation against detected concurrent CLI-file replacement. Reload asks before discarding edits. Unversioned settings POST now returns 428. No additional stale-retention deadline was selected. Credential identity is checked by private file digest, with conservative invalidation on any external content change. External writes in the final check-to-rename interval remain a documented limit, not a shared cross-process lock. Evidence: [phase5-reliability-validation.md](../validation/phase5-reliability-validation.md).

## Decisions before implementation

Ask the first independent decisions together, then ask their dependent frontier in later dialogs:

- First phase: usage/cost selected.
- Failed changed file: whole-pass rollback selected. Healthy partial updates with retained failed files are not selected.
- Mixed-model filter: matching observations selected. Session totals must use the same filtered observations; preserve existing metadata/API compatibility with explicit projection fields if needed.

Phase 1 accounting, Phase 2 calendars, Phase 3 refresh, Phase 4 displayed exports, and Phase 5 stale quota/settings conflict decisions are confirmed above. Q28–Q33 subsequently select current-basis recalculation with archived rules and read-only tracing. A historical effective-rate ledger remains separate scope. Q20 selects manual browser updates; adding watcher-to-browser synchronization needs a new decision. Do not quietly change those semantics in code.

## Validation and delivery

The user selected cross-phase acceptance after a73bbe6. [functional-integration-validation.md](../validation/functional-integration-validation.md) records the complete fixture run and remaining inventory. FA24 fixes refresh-failure qualifiers lost after an equal-identity page read. This uses the already confirmed rollback/visible-failure policy; it adds no new product policy. Phase 4 page merges preserve data and now also carry the latest refresh attempt qualifiers. Subsequent checkpoints close native Safari and pricing-archive scope. Other browsers, Windows, live contracts, historical effective rates and automatic browser synchronization remain separate work.

## Detail completeness checkpoint

Q27 selects count and truncation prompts, without an observation table or pagination. Detail adds observationCount, returnedObservationCount, and observationsTruncated after the active filters; observationLimit remains 2000. Full Token/cost totals and response order remain unchanged. [detail-completeness-validation.md](../validation/detail-completeness-validation.md) records 17 focused checks, isolated HTTP parser/route checks, and root desktop QA for 2001, exactly 2000, and zero adopted observations. Missing totals stay unknown.

The audit passed 33 existing client checks and 19 service checks in two non-overlapping groups. Those are baseline checks, not evidence that the findings are fixed. The isolated HTTP probe exercised real routes; the standard contract harness was not rerun because it can invoke automatic pricing fetch and cache writes in the source checkout.

For each implementation, turn only relevant audit cases into regression expectations after the change. Do not keep probe exit-zero as a correctness gate. Avoid repeated broad suites; run shared parser/projection coverage when cross-module risk requires it. Use a fully isolated fixture HTTP server for stateful failures and external fake responses. Perform supported desktop runtime checks directly. Maintain a clear Windows-local reproduction command when a platform check cannot run here.

Phase completion requires observable behavior, aligned docs, staged intended files, successful commit, and clean unrelated-change handling. Windows runtime, Node 18/22/24, real populated provider-log variants, other browsers, interrupted/very large downloads, live upstream integration and release validation remain explicit follow-ups. Native Safari download/unload UI has separate completed evidence below. No push or release is authorized by this plan.

## Pricing archive checkpoint

Q28–Q33 are implemented. Current-basis estimates now have complete provider-separated archives, a shared calculation revision, read-only version routes, complete JSON/Markdown basis metadata and desktop status. New prices activate after archive success. Initial unavailable archives leave Tokens usable and costs unknown; verified former rates remain after a candidate failure. [pricing-archive-validation.md](../validation/pricing-archive-validation.md) records 79 focused checks, two isolated HTTP fixtures and root desktop QA. Historical effective-rate inference, version switching, automatic deletion and live certification remain outside this scope.

## Native browser acceptance checkpoint

[browser-download-settings-validation.md](../validation/browser-download-settings-validation.md) closes the previously unverified native Safari cases. All four downloaded files matched pinned API bytes; save cancellation created no file; an export conflict reloaded the dashboard without starting a download. App and native settings leave dialogs preserved or discarded edits as selected. Reverting values and successful isolated saves cleared dirty state. No product defect was reproduced by these cases. Other browsers, Windows and interrupted or very large downloads remain separate validation scope.

## Request race checkpoint

[request-race-validation.md](../validation/request-race-validation.md) resolves the remaining FA15 fetch/body failure path. Superseded exceptions are stale; only the current update/diagnostic attempt can publish results or end busy state. Provider changes invalidate those actions and release their buttons. Fifty focused checks passed. Root desktop QA covers controlled late failures/successes across Provider changes and an actual native-fetch abort. The normal HTTP-status case remains covered by Phase 4. No synchronization, quota or server-operation rollback policy changed.

## Remaining functional inventory checkpoint

The first inventory at c520717 was committed as 83ba020. The user subsequently selected and completed settings, query/export and pricing ownership work. The current [inventory](../reviews/functional-status-inventory.md) is reconciled through 59e30b6. It separates completed policies from non-atomic scan boundaries, remaining storage/live/platform validation and optional product changes. This documentation-only update does not rerun saved checks or authorize another implementation.

## Cross-process write decision checkpoint

The user selected R01 after 83ba020. [cross-process-write-review.md](../reviews/cross-process-write-review.md) records actual shipped write paths with a controlled child-process interleaving. External changes before the final read are preserved; changes after it are overwritten for settings and Claude credentials. This is a diagnostic baseline, not a passing correctness gate. Q34 credential ownership and Q35 settings ownership require separate decisions before product changes. Pricing lifecycle, production restart and live CLI interaction are outside this checkpoint.

## Settings and credential ownership implementation

Q34–Q39 are selected and delivered. [settings-ownership-validation.md](../validation/settings-ownership-validation.md) records read-only Claude credentials, one startup settings writer, read-only additional instances, guarded normal release, conservative explicit recovery and restart-only acquisition. Twenty-three distinct focused cases ran in bounded groups, plus copied multi-process HTTP and root desktop QA. Independent editors must stop the writer before changes; pricing lifecycle, Windows, storage/power-loss failure and rollout remain separate scope.

## Large-data measurement checkpoint

After a0ad92c, the user selected isolated query/export/pricing-list timing and memory measurements before choosing improvement targets. [performance-baseline.md](../reviews/performance-baseline.md) and its raw evidence record 10000/50000/150000 observations, all four exports, the actual buffered 32 MiB rejection and 1–10000 verified archive versions. Product code is unchanged. Warm full projection and all-format export work dominate the measured latency; the archive list remains fast at the tested scale. The next user decisions are scope and accepted workload, followed by numeric resource targets and any required cache/export semantics. No optimization, resource SLA, new dependency or architecture is selected by this measurement checkpoint.

Subsequent Q40–Q50 decisions select query/export optimization with aggressive local latency targets, normal RSS at most 512 MiB, uncapped native streamed downloads, one active slot, restart-from-start and bounded deadlines. [query-export-performance-plan.md](query-export-performance-plan.md) records implementation boundaries and acceptance. The delivery below supersedes the old 32 MiB rejection policy; the baseline remains historical evidence.

## Query and native streamed export delivery

Q40–Q50 are implemented. [The validation record](../validation/query-export-performance-validation.md) covers selective query work, bounded snapshot selection reuse, native prepared downloads, one active slot, transport deadlines, exact saved bytes and the selected local latency/RSS targets. The historical 32 MiB rejection and frontend Blob workflow are replaced. Subsequent Q51–Q60 delivery below closes R02 within the selected process scope. Storage failure V04, real logs and platform/rollout validation remain separate.

## Pricing ownership and recovery decisions

Q51–Q60 now select an independent shared pricing writer, manual latest publication load, archive-plus-publication activation, active-basis revalidation for each cost response, separate check-metadata warnings, controlled first initialization, startup-fixed ownership/manual recovery, process-interruption scope and restricted explicit archive repair. [The complete plan](pricing-ownership-recovery-plan.md) defines owned files, API/UI boundaries and focused acceptance. These policies are delivered in [pricing-ownership-recovery-validation.md](../validation/pricing-ownership-recovery-validation.md). Pricing writes are coordinated independently of settings, repair publication has a persistent guard, and the selected local performance targets remain satisfied. External edits, live contracts, Windows and power-loss durability remain separate validation scope.

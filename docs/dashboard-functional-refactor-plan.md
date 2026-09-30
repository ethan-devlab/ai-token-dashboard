# Dashboard functional refactor plan

Date: 2026-10-01 (Asia/Taipei). Status: Phase 1 product policies confirmed; ready for implementation review.

## Confirmed scope

The user accepted the desktop UI result and requested functional inventory and refactoring. The user selected the complete functional chain and an evidence-backed audit before deciding implementation order. Keep the accepted desktop layout, Traditional Chinese/English, local uPlot, APIs, provider boundaries, and persisted preferences. Add functional status text only where needed to identify stale, incomplete, or unsupported data. No new framework, database, package installation, external service, Service/Tray implementation, or release work is included.

The baseline is `665af57`. [dashboard-functional-audit.md](dashboard-functional-audit.md) contains 17 reproduced findings, five policy cases (including the follow-up counter-reset probe), and candidate risks. [functional-audit-evidence.json](functional-audit-evidence.json) stores isolated results. UI completion did not establish functional completeness.

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
- The user answered all Phase 1 policy questions. No production implementation has started. Later-phase policy decisions remain separate gates.

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

Own `server/timezone.mjs`, query validation in `server.mjs`, and only required query-state helpers. Address FA01–FA03 and FA21. Preserve numeric interval URLs and valid existing query parameters. Reject impossible dates, mode-incompatible periods, invalid ISO weeks, zero page limits, and invalid instant bounds with the existing error envelope. Decide prior-period comparison semantics before changing them.

Acceptance: W01 starts December 29, 2025; impossible February dates and month 13 return 400; valid leap day passes; both New York repeated hours remain separate; spring transition, year/week rollover, IANA query boundary, and numeric exact interval checks pass. `limit=0` fails while `offset=0` remains valid. Run only timezone/query contract checks and a supported desktop control flow.

### Phase 3 — Index refresh and watcher lifecycle

Own discovery and refresh in `server/session-index.mjs`, worker lifecycle in `server/session-parser-worker.mjs`, `server/summary-cache.mjs`, and `server/provider-registry.mjs`. Address FA08/FA09/FA11/FA14/FA19. First reproduce candidate scan/write and worker timing failures; do not build a speculative scanner.

Replace argument-spread min/max with bounded iteration. Discover enough metadata to distinguish exact cap from omitted files. Propagate completeness/cap/retained-file quality. Implement the chosen failed-file policy and a dirty-generation follow-up when a verified in-flight change requires it. Recover a missing/error watcher without duplicate watchers/timers. Keep disk data immutable and index/snapshots memory-only.

Acceptance: 150,000-observation all-time query completes with correct total (no speed claim); unchanged-file reuse holds; a changed-file failure does not silently discard 110 known tokens; genuine deletion removes usage under the selected policy; exact cap is not flagged, exceeding it is flagged end to end; directory recovery resumes watching; teardown removes watchers and workers. Validate in fixtures, not the user's Session directory.

### Phase 4 — Projection, page, and export consistency

Own projection responses/builders in `server/dashboard-data.mjs` and `server.mjs`, cache/state helpers in `public/scripts/projection-cache.mjs` / `request-channels.mjs`, and orchestration in `public/scripts/dashboard.mjs`. Address FA07/FA16/FA17. Decide latest-versus-displayed behavior before introducing API fields.

Use a complete projection identity, including provider, normalized query, snapshot version, and pricing revision. Reject or reload page merges from another identity. Add export metadata without breaking existing omission behavior. Export matched Sessions through an unpaged/streaming path, not `dashboard.sessions`. Keep CSV safety, redaction, request bounds, attachment names, and bounded responses. Review stale failed requests and busy ownership against the new identity.

Recommended compatibility path: omitted version retains today's API behavior; the shipped client supplies the displayed identity; a mismatch returns a specific conflict and causes an explicit complete reload before retry. This avoids an unbounded historical snapshot cache. User confirmation is required for the product behavior, not for routine implementation mechanics.

Acceptance: all 251 matched Sessions export once; sorting/filtering do not change coverage; page offset does not truncate export; newer pages never leave old charts/models; snapshot advancement during export is detected; every format identifies exact bounds and qualifiers; an old Provider response cannot alter current-provider data. An actual desktop download check is still required on a browser that exposes file completion.

### Phase 5 — Quota and settings reliability

Own `server/account-usage.mjs`, `server/settings.mjs`, and their existing client controllers. Address FA12/FA20 and the selected FA13 policy. Preserve fixed official destinations, same-Origin validation, loopback access, credential redaction, atomic OAuth rotation, allow-listed settings, and restart-required behavior.

Normalize only supported values; null/empty utilization and invalid reset times remain unknown. Keep a provider-isolated last good quota only if explicit stale status is chosen. Use unique exclusive temporary files and serialize same-file settings saves; consider conflict detection only if the user chooses that requirement. Check concurrent OAuth/CLI file rotation in a fake credential fixture before changing that lifecycle.

Acceptance: null quota never shows 100% or epoch reset; measured zero still does; rate-limit/auth/network states remain distinct; stale quota cannot become current; concurrent settings saves have no shared temporary path and no success/file mismatch; unrelated configuration lines survive; invalid input leaves the old file intact. No real credential or `.env` write is part of QA.

## Decisions before implementation

Ask the first independent decisions together, then ask their dependent frontier in later dialogs:

- First phase: usage/cost selected.
- Failed changed file: whole-pass rollback selected. Healthy partial updates with retained failed files are not selected.
- Mixed-model filter: matching observations selected. Session totals must use the same filtered observations; preserve existing metadata/API compatibility with explicit projection fields if needed.

Phase 1 mixed-source, duplicate/version, reset, and budget decisions are confirmed above. Later decisions still include stale quota; current versus displayed export version; comparison calendar basis; current pricing versus a historical rate ledger; concurrent settings conflict UX; and watcher-to-browser synchronization. Do not quietly settle those future semantics in code.

## Validation and delivery

The audit passed 33 existing client checks and 19 service checks in two non-overlapping groups. Those are baseline checks, not evidence that the findings are fixed. The isolated HTTP probe exercised real routes; the standard contract harness was not rerun because it can invoke automatic pricing fetch and cache writes in the source checkout.

For each implementation, turn only relevant audit cases into regression expectations after the change. Do not keep probe exit-zero as a correctness gate. Avoid repeated broad suites; run shared parser/projection coverage when cross-module risk requires it. Use a fully isolated fixture HTTP server for stateful failures and external fake responses. Perform supported desktop runtime checks directly. Maintain a clear Windows-local reproduction command when a platform check cannot run here.

Phase completion requires observable behavior, aligned docs, staged intended files, successful commit, and clean unrelated-change handling. Windows runtime, Node 18/22/24, real populated provider-log variants, browser download/unload UI, live upstream integration, and release validation remain explicit follow-ups. No push or release is authorized by this plan.

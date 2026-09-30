# Dashboard functional refactor plan

Date: 2026-10-01 (Asia/Taipei). Status: proposed; implementation order and data policies await user decisions.

## Confirmed scope

The user accepted the desktop UI result and requested functional inventory and refactoring. The user selected the complete functional chain and an evidence-backed audit before deciding implementation order. Keep the accepted desktop layout, Traditional Chinese/English, local uPlot, APIs, provider boundaries, and persisted preferences. Add functional status text only where needed to identify stale, incomplete, or unsupported data. No new framework, database, package installation, external service, Service/Tray implementation, or release work is included.

The baseline is `665af57`. [dashboard-functional-audit.md](dashboard-functional-audit.md) contains 17 reproduced findings, four policy cases, and candidate risks. [functional-audit-evidence.json](functional-audit-evidence.json) stores isolated results. UI completion did not establish functional completeness.

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

Own `server/claude-session.mjs`, reconciliation in `server/session-index.mjs`, `server/usage.mjs`, event model/cost aggregation in `server/dashboard-data.mjs`, and narrowly related budget classification in `public/scripts/state.mjs` / `dashboard.mjs`. Update only the relevant service/client checks and accounting docs.

Address FA04–FA06; decide FA10, FA18, and FA22 before their implementation. Retain generic cache-write tokens without assigning an unsupported TTL price. Rank by event model. Establish model-filter semantics before changing matching. Share complete/partial/unknown cost qualification across aggregates, models, trend, budgets, and export fields. Validate metadata/reconciliation counters without exposing events containing conversations.

Acceptance: 10+20+70+5 yields 105; unknown TTL cost remains qualified; two/five tokens rank under the correct models; trend cost coverage matches aggregate coverage; ambiguous mixed sources and copied/resumed Sessions follow the chosen policy; a partial subtotal below budget does not imply known compliance. Implement first, then add focused regression checks.

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

- First phase: recommended usage/cost, or prioritize calendar/export, or snapshot/refresh reliability.
- Failed changed file: abort the entire pass and keep the previous snapshot, or publish healthy updates plus explicitly retained last-good failed files. Recommended: whole-pass rollback first for a simple, clear correctness boundary; evaluate partial retained snapshots only with explicit freshness metadata.
- Mixed-model filter: recommended matching observations, which makes KPI/model/trend/export totals describe selected-model usage, or matching Sessions with all of their models included. Both require an explicit Session total label/contract.

Dependent later decisions: mixed-source ambiguity and duplicate provenance; partial budget status; stale quota; current versus displayed export version; comparison calendar basis; current pricing versus a historical rate ledger; concurrent settings conflict UX; watcher-to-browser synchronization. Do not quietly settle accounting semantics in code.

## Validation and delivery

The audit passed 33 existing client checks and 19 service checks in two non-overlapping groups. Those are baseline checks, not evidence that the findings are fixed. The isolated HTTP probe exercised real routes; the standard contract harness was not rerun because it can invoke automatic pricing fetch and cache writes in the source checkout.

For each implementation, turn only relevant audit cases into regression expectations after the change. Do not keep probe exit-zero as a correctness gate. Avoid repeated broad suites; run shared parser/projection coverage when cross-module risk requires it. Use a fully isolated fixture HTTP server for stateful failures and external fake responses. Perform supported desktop runtime checks directly. Maintain a clear Windows-local reproduction command when a platform check cannot run here.

Phase completion requires observable behavior, aligned docs, staged intended files, successful commit, and clean unrelated-change handling. Windows runtime, Node 18/22/24, real populated provider-log variants, browser download/unload UI, live upstream integration, and release validation remain explicit follow-ups. No push or release is authorized by this plan.

# Phase 1 accounting implementation and validation

Date: 2026-10-01 (Asia/Taipei). Environment: macOS, Node v26.0.0. All logs, credentials, and configuration in validation were synthetic and isolated. No user Session refresh, real settings save, upstream pricing/quota request, push, or release was performed.

## Changes

- Fixed FA04: Claude input 10, cache read 20, generic cache write 70, and output 5 now total 105. Unknown write duration stays unpriced. Partial or contradictory duration breakdowns do not discard the confirmed write total or charge it twice.
- Fixed FA05: event models drive ranking and model selection. Selecting model B returns five tokens across KPI, chart, Session page, detail, and all four export formats. The legacy Session metadata model remains available separately.
- Fixed FA06: aggregate, model, and trend use the same partial-cost qualification. Unknown modifiers are excluded from known cost instead of assigned a guessed base price.
- Implemented selected FA10/FA18/FA23 policies: per-model cumulative priority; exact-byte or explicit-event evidence; raw-state version selection before deltas; latest valid versions; conflict retention; separate main/agent scopes; skipped uncertain partial resets with a new baseline.
- Implemented selected FA22 policy: budget classification uses known cost. Partial pricing has a separate explanation below the amount. This explanation was adjusted after direct 960px desktop QA found that inline text compressed the budget name.
- Added normalized usage reasons to the dashboard, Session status, drawer, and exports. Token totals do not receive a blanket lower-bound symbol. The original audit evidence remains unchanged.

Production files: `server/claude-session.mjs`, `server/session-index.mjs`, `server/usage-reconciliation.mjs`, `server/dashboard-data.mjs`, `public/scripts/accounting-status.mjs`, `dashboard.mjs`, `explorer.mjs`, `drawer.mjs`, `i18n.mjs`, and one budget-note rule in `public/styles/dashboard.css`. No dependency was added.

## Executed validation

| Check | Result | Limits |
| --- | --- | --- |
| `node --test tests/phase1-accounting.test.mjs` | 23 passed | Synthetic parser/index/projection fixtures |
| `node --test --test-name-pattern='session index\|Claude session parser\|Claude pricing parser' tests/server-services.test.mjs` | 3 passed | Relevant existing service checks only |
| `npm run test:client` | 33 passed | Existing client behavior checks |
| `node tests/phase1-http.mjs --serve` | Passed actual routes and served client assets | Isolated copy; all external fetch returns 503 |
| Direct in-app browser QA | Passed at 1280px and 960px desktop widths | Root agent; English and Traditional Chinese |

The HTTP fixture adopted 52 Codex tokens, including 35 from copied/appended cumulative files. Model B selected five. Claude adopted 105 tokens with 35 priced tokens, 70 unpriced tokens, and USD 0.000185 known cost. Four export formats agreed with selection. Same-origin POST and cross-provider detail boundaries remained enforced. Deprecated summary kept full-snapshot totals with selected rows.

Focused fixtures include exact copies without IDs, appended proven/unproven copies, per-model mixed sources across files, partial reset followed by a normal delta, verified full restart and an uncertain input-only fall, same-file revisions, newer cross-file revisions, tied and estimated-time conflicts, retained confirmed versions, invalid revisions, inferred cumulative order through shared identities, unorderable branches, and main/two-agent separation. No test was written before implementation.

The browser verified checkbox selection and apply, five-token Session detail, Claude 105/70 totals, unknown-duration drawer text, matching partial-cost chart/model labels, a USD 100 local test budget with `data-status=ok`, and the explanation that full cost may be higher. At 960px, page width was 960px and the explanation had its own row. The final test page produced no console errors. Temporary viewport overrides were reset.

Local screenshot artifacts: `phase1-model-drawer.png`, `phase1-claude-cache-drawer.png`, `phase1-claude-budget.png`, and `phase1-budget-960-viewport.png` in this chat's visualization directory. These images show test-only synthetic data.

## Assumptions and remaining work

An explicit Codex usage identity is `event_id`, `usage_id`, or a cumulative wrapper `id`; a turn `id` is grouping data. A Claude message `id` identifies response versions. A fallback filename does not establish shared Session identity. Identical usage with different reliable timestamps uses the latest timestamp for range attribution. Source quality counters are Session-scoped even when usage is filtered. These assumptions are documented in API v2 and tested where applicable.

All later-phase findings remain open: query/week/DST validation, failed-file whole-refresh rollback, watcher recovery/caps, large-query extrema, snapshot/page/export completeness, quota nulls/staleness, and concurrent settings saves. Standard contract validation was not run because its harness can fetch pricing and write the source checkout's cache; the isolated actual-route harness covered this phase instead. Windows runtime, Node 18/22/24, populated real provider-log variants, and native browser download completion remain unverified. The HTTP harness uses `--import` and needs Node 18.19 or later; this does not change the production Node >=18 requirement.

Windows-local checks: run the same three focused Node/npm commands above and `node tests/phase1-http.mjs` in the checkout. Use `--serve` only for the isolated desktop QA surface, then send Enter or stop it to remove its temporary files.

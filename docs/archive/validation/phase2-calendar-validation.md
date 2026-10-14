# Phase 2 query and calendar implementation and validation

Date: 2026-10-01 (Asia/Taipei). Environment: macOS, Node v26.0.0. Phase 1 was committed as `217cebd` before Phase 2 development. Validation used synthetic logs, isolated configuration and credentials, and disabled external fetch. No real Session rescan, source cache/configuration write, production service restart, push, or release was performed.

## Changes

- FA01: selected ISO week determines its calendar bounds. `2026-W01` starts December 29, 2025 in UTC; valid W53 and week-year rollover are handled.
- FA02: impossible dates, invalid months/weeks, and mode-incompatible periods return 400. Valid leap dates pass. Custom civil input no longer normalizes February 31 into March.
- FA03: New York repeated hours have separate UTC bounds and offset labels. Spring gaps, 23/25-hour days, Lord Howe half-hour changes, and a Santiago midnight gap retain actual boundaries.
- FA21: zero page limits fail. Offset zero remains valid. Out-of-Date-range UTC instants fail with the existing error envelope.
- Selected comparison policies: prior calendar periods for day/week/month/year; equal elapsed time for custom/last24h; same local progress for unfinished calendar periods; missing prior date uses prior period end.
- Keep IANA region choices. UTC is the internal instant basis, not a replacement for region timezones. Reject repeated or missing custom local times. Exact chart bounds remain usable and persist through reloads.
- Add comparison current range/totals, basis, progress flag, availability and reason. The client shows both comparison ranges and bilingual invalid-range guidance. The selected whole-period KPI remains unchanged.

Production files: `server/timezone.mjs`, `server.mjs`, `server/dashboard-data.mjs`, `public/scripts/dashboard.mjs`, `state.mjs`, `request-channels.mjs`, and `i18n.mjs`. No dependency or CSS redesign was added. Formatter and offset-window caches are bounded and memory-only.

## Executed validation

| Check | Result | Scope |
| --- | --- | --- |
| `node --test tests/phase2-calendar.test.mjs` | 13 passed | Calendar, DST, comparison, projection and client query fixtures |
| `node --test --test-name-pattern='timezone ranges' tests/server-services.test.mjs` | 1 passed | Existing timezone behavior |
| `npm run test:client` | 33 passed | Existing client behavior |
| `node --test tests/phase1-accounting.test.mjs` | 23 passed | Shared projection accounting regression |
| `node tests/phase2-http.mjs --serve` | Passed | Actual copied routes/assets; fixed test clock; external fetch returns 503 |
| Direct in-app browser QA | Passed | Root agent; 1280px English and 960px Traditional Chinese desktop |

HTTP checks reject 14 invalid queries with HTTP 400 and request IDs. W01 returns seven tokens; a valid leap date resolves correctly. With clock March 10 at noon UTC, whole March KPI is 60 tokens, progress current total is 20, prior aligned total is 10, and comparison is +100%. The fixture includes future events deliberately to verify the comparison cutoff separately from the selected KPI.

Two November 1 01:30 observations become `05:00–06:00Z` (10 tokens, GMT-4) and `06:00–07:00Z` (20 tokens, GMT-5). Selecting the second hour returns 20 across dashboard and detail. The export route rejects `limit=0`; same-origin POST remains enforced. Synthetic model names can be unpriced before their rate-validity date; this is labelled partial pricing, not a fabricated rate.

Browser checks: historical week URL/control; March selection and explicit progress ranges; ambiguous New York custom time rejection with retained-query status; separate chart boundary choices; second-hour apply to the full local query; exact numeric URL bounds; reload retaining 20 tokens; English and Traditional Chinese comparison text. At 960px, scroll width is 960px and comparison dates wrap within the panel. The final page has no console errors. The test tab was closed, viewport reset, and test process/temp files removed.

Screenshots in this chat's visualization directory: `phase2-calendar-comparison.png`, `phase2-dst-error.png`, `phase2-exact-fold-query.png`, `phase2-desktop-960.png`, and `phase2-comparison-960-viewport.png`. All screenshots show test-only data. The complete English comparison screenshot preserves the isolated-test banner.

## Assumptions and remaining work

If automatic prior local progress is ambiguous or missing, only comparison is unavailable. Future calendar periods have no comparison before they start. Midnight calendar gaps use the first valid instant; repeated midnight uses the earliest boundary. Empty prior calendar periods have no comparison. Region rules come from the runtime's ICU timezone data. This work verifies the listed fixtures, not every historical IANA transition or a performance benchmark.

Phase 3 refresh rollback, watcher recovery, scan completeness/caps, and large-query extrema remain open. Phase 4 snapshot/page/export consistency and Phase 5 quota/settings remain open. The standard contract harness was not run because it can perform upstream pricing fetch and write source caches; isolated actual routes covered this phase instead. Windows, Node 18/22/24, real log variants, and native browser download completion remain unverified. The existing production server was not restarted, so it can still serve the prior imported backend until a normal restart.

Windows-local checks: run the four focused Node/npm commands above and `node tests/phase2-http.mjs` in the checkout. The HTTP harness needs Node 18.19+ for `--import`; production still requires Node >=18. Use `--serve` only for isolated desktop QA, then press Enter or stop it to remove temporary files.

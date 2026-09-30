# Desktop dashboard UI/UX review

## Evidence

Reviewed the current dashboard at a 1440 × 1000 desktop viewport on 2026-09-30, with the existing local snapshot. The worktree was clean. The current design system and product rules remain authoritative.

## Findings

| Priority | Finding | Effect | Proposed change |
| --- | --- | --- | --- |
| High | The summary starts at y=779. Eight expanded filter lists consume most of the first screen. | Users must scroll before they can read the complete usage summary. | Keep period controls visible. Put all facets in one native disclosure with an always-visible active count. Open it when URL filters are active. |
| High | Pricing coverage warnings appear below both chart panels. | A user can read an incomplete cost estimate before seeing its qualification. | Place source metadata and quality status directly after the summary. |
| Medium | Header identity and six tools compete for one row. | Long English labels reduce space for the title and increase wrapping at smaller desktop widths. | Use a compact title and a wrapping toolbar. Give the explicit JSONL refresh action a clear primary style. |
| Medium | Trend and model breakdown each use the full page width. | The user must scroll to compare related insights. | Use two columns on wide desktops and one column at the 960px desktop minimum. |
| Medium | Two quota windows fill only half of a fixed four-column grid. | Useful plan data is surrounded by unused space. | Let available quota windows fill the row, with bounded desktop columns. |
| Medium | Disabled buttons use a waiting cursor for all states. | Unavailable actions appear busy even when no operation is running. | Use a disabled cursor; retain explicit loading text for running operations. |

## Implementation boundary

Preserve the dark palette, teal accent, existing DOM identifiers, provider isolation, data accounting, API contracts, URL state, local preferences, and security boundaries. Use existing HTML, CSS, and modules. Add no framework, remote asset, or dependency. Dashboard changes must not alter the settings-page layout. Keep Traditional Chinese and English labels complete.

## Acceptance checks

- The four KPIs and token breakdown are visible within the first 1000px at 1440px width when facets are collapsed.
- Facets remain keyboard accessible. Active URL filters open the disclosure and the count remains visible when it is closed.
- Clearing filters, changing providers, searching, opening a session drawer, and changing language still work.
- Quality warnings sit beside the summary they qualify.
- No document overflow at 960px or 1440px. The session table retains its own horizontal scroll area.
- Run focused client checks and direct desktop browser QA. Do not test mobile or tablet layouts.

## Confirmed direction

The user selected the compact overview direction. This is one UI refactor within the current product phase; it does not start a new backend or product phase.

## Validation results

- `npm run test:client`: all 15 checks passed.
- `node --check public/scripts/dashboard.mjs` and `git diff --check`: passed.
- Direct browser checks: English and Traditional Chinese; model filtering; clear filters; URL restoration; retained disclosure state after a trend change; empty search; session drawer and Escape; period changes; provider changes.
- At 1440 × 1000, the summary starts at y=361 instead of y=779 and ends at y=627. Trend and model columns measure 816px and 544px. The document has no horizontal overflow.
- At 960 × 1000, two KPI columns keep long currency values readable. The summary ends at y=848. Insight panels stack, and table overflow stays local.
- The current Claude source is unavailable. Its provider notice and unavailable plan state were checked; populated Claude data was not verified.
- No browser warnings or errors were recorded in the final view. Backend suites were not run because server code, APIs, and accounting did not change. Mobile and tablet checks are outside product scope.

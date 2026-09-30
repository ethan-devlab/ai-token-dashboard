# Native Canvas and uPlot comparison

Date: 2026-09-30. Status: archived comparison at commit `2a4773d`. The user selected uPlot after reviewing this evidence. The production dashboard now uses only uPlot; the comparison route and its controller were removed.

## Scope

This section describes the prototype at commit `2a4773d`, not a current route. That version served `/chart-comparison.html` on the existing localhost server. The prototype used the existing dashboard API, provider, timezone, and facet parameters. The user chose a same-position engine switch. Both engines shared the data, plot dimensions, metric controls, external readout, semantic table, interval selection, and query projection.

This page does not replace the production trend or model ranking. Applying an interval updates this page's real local usage projection and URL. Return restores its previous query. The dashboard link returns to the initial dashboard query. Account quota is not requested or changed. Explicit test fixtures cannot apply a query and have no simulated model or session results.

The prototype has a separate preference key, `codex-token-dashboard:chart-comparison:v1`. It preserves the production preference key. Locale changes on this page are temporary.

## Implemented contract

- Single cost or Token, stacked Token/cost, and dual-axis presentations; bars and unsmoothed lines. Default: single cost, bars.
- Timestamp positions, complete bucket widths, zero baselines, numeric ticks, selected-timezone labels, and line breaks across missing intervals.
- Unknown cost differs from zero. Partial cost remains a lower bound. Positive costs below six-decimal precision do not become a false zero.
- Compact pointer preview, click-to-pin, external complete readout, and Home/End/Arrow selection. Pointer motion updates overlays through one animation frame and does not redraw the plot or announce each movement.
- Drag selection and native start/end selects snap to complete buckets. Zoom changes only the plot. Apply explicitly changes local usage; Return restores the previous projection.
- Engine, mode, and mark changes preserve timestamp selection, interval, zoom, and the table disclosure. The uPlot instance is reused for resize and redraw; it is destroyed when its adapter is replaced.
- Token uses the information color; cost uses the accent color. Dual-axis cost is outlined for bars and dashed for lines so coincident series remain visible.

## Asset provenance

The pinned version is uPlot 1.6.32. Its official distribution and API are described in the [uPlot repository](https://github.com/leeoniya/uPlot) and [type declarations](https://github.com/leeoniya/uPlot/blob/1.6.32/dist/uPlot.d.ts). The exact package came from the [npm registry archive](https://registry.npmjs.org/uplot/-/uplot-1.6.32.tgz). Its SHA-512 integrity was verified before reading selected files:

`sha512-KIMVnG68zvu5XXUbC4LQEPnhwOxBuLyW1AHtpm6IKTXImkbLgkMy+jabjLgSLMasNuGGzQm/ep3tOkyTxpiQIw==`

The local module contains the official minified IIFE distribution with only `export default uPlot;` appended. The official minified CSS and [MIT license](../public/scripts/vendor/uplot-LICENSE.txt) are retained. There is no package installation, bundler, CDN, remote font, or external usage-data request.

| Candidate | Added vendor runtime bytes | Gzip estimate |
| --- | ---: | ---: |
| Native Canvas | 0 | 0 |
| uPlot module | 51,104 | 22,023 |
| uPlot CSS | 1,857 | 758 |
| uPlot combined | 52,961 | 22,781 |

These figures exclude shared application code. Gzip is an estimate; the current server sends the uncompressed files. For comparison, the prototype eagerly loads both adapters and the vendor assets even when Native is selected. The zero-vendor figure describes a production Native choice, not this prototype's network load.

## Measured redraw work

Environment: local macOS Codex IAB, 1440px desktop viewport. Each final measurement contains 20 requested redraws and 20 verified draw callbacks. Both candidates use a stable adapter, single cost, the same data, and the final minified vendor distribution.

| Data and mark | Native median / p95 | uPlot median / p95 |
| --- | ---: | ---: |
| Real Codex projection, 9 buckets, bars | 0.50 / 0.60 ms | 0.50 / 0.60 ms |
| Explicit test data, 10,000 buckets, lines | 0.80 / 1.40 ms | 0.70 / 0.80 ms |
| Explicit test data, 10,000 buckets, bars | 1.10 / 1.30 ms | 1.20 / 1.50 ms |

The timer measures JavaScript work through the Canvas draw or uPlot draw callback, including scale/path work. It does not measure complete browser paint, GPU completion, memory, cold loading, or creation of the 10,000-row semantic table. Earlier repeated runs varied and sometimes reversed the small difference. These results do not establish a stable performance winner. Initial measurements that recreated uPlot on every redraw were discarded after its lifecycle was corrected.

## Direct verification

- `npm run test:client`: 25 passed. New checks cover gaps and null values, interval snapping, line midpoints, zero baselines, large values, 24/23/24-hour DST buckets, and small-cost qualifiers.
- Desktop layout at 960, 1200, 1440, and 1600px: no document overflow; plot widths 854, 1094, 1334, and 1494px. The uPlot drawing region matches the Native gutters.
- Both engines in all 12 engine/mode/mark combinations: correct canvas count, eight partial-fixture table rows, unknown cost retained, test Apply disabled, and no browser errors.
- Empty, one-point, zero, sparse, partial-cost, large-value, spring DST, and 10,000-point fixtures were checked. Isolated sparse line points remain visible. Missing intervals remain gaps.
- Home pin, interval selection, zoom, and engine/mode/mark changes retained selected timestamp, zoom, and table disclosure. Pointer drag snapped to complete sparse buckets.
- New York spring DST readout includes the actual GMT-5 to GMT-4 boundary and its 23-hour bucket. Applying a real September 6–15 interval produced three trend buckets and four sessions. Return restored the original month, timezone, totals, cost qualifier, sessions, and URL.
- The real baseline contained nine trend buckets and eight sessions. It used actual local data. Fixture choices were labeled as tests.
- Static HTML/module/CSS assets returned HTTP 200, correct content types, and exact local file content. Existing page and asset CSP policies were preserved. No server changes were required.

Screenshots at 1440px:

- `/Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/phase3-native-1440.png`
- `/Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/phase3-uplot-1440.png`

## Decision and remaining work

Native Canvas is the recommended default for the current aggregated dashboard: it satisfies the approved interactions without another vendor asset. The application must own and maintain axes, paths, scale choices, and renderer cleanup.

uPlot is a valid alternative if library-managed scales, paths, and lifecycle are preferred over the added local asset and version maintenance. The application still owns timezone semantics, complete-bucket bars, keyboard interaction, readout, cost coverage, interval application, and table parity. The prototype uses a custom bar path because elapsed bucket widths must remain accurate.

The user selected uPlot. Production integration uses one renderer, a stable chart controller, compatible mode/mark preferences, true model ratios, and complete-list access. Synthetic fixtures now live under `tests/fixtures`; they cannot appear as production data. The earlier Native recommendation above records the comparison trade-off and does not override the user decision. See the production Phase 3 checkpoint in `dashboard-deep-audit.md` for current verification. These redraw measurements remain prototype measurements; they were not rerun as a production performance benchmark.

Not verified: Windows controls, a screen-reader session, populated Claude, autumn DST ambiguity in this prototype, fault-injected failed queries, full browser paint/memory, cold-load performance, settings POST, remote CI, or deployment. The broad backend suites were not run because the server and API contracts did not change. Windows follow-up: `npm run test:client` and `npm start`, followed by desktop interaction checks.

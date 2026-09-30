# Desktop dashboard deep audit

Review date: 2026-09-30. Status: planning evidence, not implementation approval.

## Scope and method

The user confirmed the entire desktop interface: dashboard, session drawer, and shared settings controls. They also requested a comparison of native charts and chart libraries. Keep the existing dark appearance, Traditional Chinese and English, local data boundaries, and desktop-only support.

This review includes the previous, uncommitted overview changes. It is a new review of the current working tree, not a review of the older layout. Product files were not changed during this audit.

Evidence comes from current source, direct browser checks at 1440 × 1000 and 960 × 1000, computed styles and element bounds, and contrast calculations from the current tokens. Browser sizes were verified from `innerWidth`, rather than assumed from the viewport command. No visual work was delegated. Settings were inspected without saving `.env` or changing security controls.

## Assessment

The dark palette and system typography fit the documented product. There are no decorative gradients or remote assets. Repeated full-border panels and repeated headings add some visual weight, but the main weaknesses are behavior and data presentation.

| Dimension | Provisional score | Main evidence |
| --- | --- | --- |
| Accessibility | 2/4 | Modal focus escapes; small supporting text is below the normal-text contrast target. |
| Render structure and performance | 3/4 | No frontend framework or remote assets; whole-view renders reset chart state and repeat drawing work. No frame-time benchmark was run. |
| Desktop layout | 2/4 | A view panel starts at x=-98 at 960px; table density causes chart-table overlap at 1440px. |
| Tokens and CSS boundaries | 2/4 | Useful base tokens exist, but global table rules, component display rules, and late overrides leak between surfaces. |
| Product clarity | 3/4 | Summary priority improved; duplicate labels, incomplete axes, and ambiguous preference scope remain. |
| Total | 12/20 | Significant structural work is needed. |

This score is a review heuristic. It is not a formal WCAG conformance result or a performance certification. Desktop layout is rated only within supported desktop sizes.

Twenty findings: 0 P0, 8 P1, 11 P2, and 1 P3. P1 means a material task, data-presentation, or accessibility defect. P2 means a usable but incomplete interaction or maintainability problem. P3 means optional polish.

## P1 findings

### F01. Hidden elements can still render

- Location: `public/styles/base.css:1`, `public/styles/components.css:121`, `public/styles/components.css:179`, `public/styles/components.css:180`, `public/scripts/settings.mjs:55`.
- Category: CSS state correctness.
- Evidence: `#settingsUnavailable.hidden` is true on the loopback settings page, but computed display is `grid`. The page shows the remote-only warning together with the valid local form. `#explorerPagination` is also hidden but computed display is `flex`.
- Impact: Hidden, unavailable, and empty states are not reliable. The same CSS cascade threatens the remote-disabled form's visual state; that remote case was not run. Server endpoint restrictions remain a separate boundary and were not found to be bypassed.
- Recommendation: Establish a base `[hidden]` rule that survives component display styles. If `hidden="until-found"` is ever added, define its behavior separately. Validate each actual hidden component, not only the attribute value.

### F02. The modal drawer loses focus and permits background navigation

- Location: `public/scripts/drawer-controller.mjs:5`, `public/scripts/drawer-controller.mjs:13`, `public/index.html:63`.
- Category: Keyboard and modal lifecycle.
- Evidence: After the detail response replaces drawer content, the focused element becomes `BODY`. Tab from the close button, followed by another Tab, reaches the background `#provider` select while the drawer is still open. The controller has no focus containment or background inert handling.
- Impact: Keyboard users leave a dialog declared with `aria-modal="true"`. Async rendering also removes their current focus target.
- Recommendation: Preserve the drawer shell and close control while updating detail regions. Keep Tab within the active drawer, make background content inert, support Escape, and restore focus to a connected trigger or a defined fallback.
- Reference: [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) specifies contained Tab navigation and inactive background content.

### F03. The view panel is clipped at the supported desktop minimum

- Location: `public/styles/components.css:14`.
- Category: Desktop layout and menu positioning.
- Evidence: At a verified 960px viewport, the 304px panel spans x=-98 to x=206. Its labels and controls are clipped at the left edge. The document's scroll width remains 960px, so a no-overflow check alone misses this defect.
- Impact: Users cannot read or operate all view options at a supported width.
- Recommendation: Use a left-aligned panel at the wrapped desktop toolbar, then right alignment where there is room. Test panel bounds, not only document width. Keep native disclosure semantics.

### F04. A temporal trend compresses unequal time gaps into equal distances

- Location: `public/scripts/trend.mjs:8`, `public/scripts/trend.mjs:17`, `server/dashboard-data.mjs:93`.
- Category: Plot geometry and data meaning.
- Evidence: Current labels are 09-01, 09-06, 09-07, 09-14, 09-15, 09-21, 09-22, and 09-23. The renderer positions each by array index. One-day and seven-day gaps have equal horizontal lengths. The server already supplies `fromMs` and `toMs`.
- Impact: The line visually misstates the rate and timing of changes.
- Recommendation: Use a timestamp scale. Locate pointer selections against rendered timestamp positions. Mark absent buckets as absent; do not add zero values unless the source contract establishes that interpretation.

### F05. Partial-cost labels disagree between chart surfaces

- Location: `public/scripts/trend.mjs:5`, `public/scripts/trend.mjs:6`, `public/scripts/trend.mjs:23`, `public/scripts/trend.mjs:28`.
- Category: Accounting presentation.
- Evidence: For 09-23, the tooltip shows `≥ US$2.903042`; the cost data table shows `US$2.903042`. The peak summary also formats a numeric value without the point's partial flag.
- Impact: A lower-bound estimate can appear to be a complete cost when the user changes the presentation surface.
- Recommendation: Use one cost-display rule for the chart, table, peak summary, model ranks, drawer, and KPIs. Preserve the server's coverage flags without deriving billing logic in the browser.

### F06. Small supporting text has insufficient contrast

- Location: `public/styles/tokens.css:10`, `public/styles/components.css:18`, `public/styles/components.css:38`, `public/styles/components.css:54`, `public/styles/components.css:138`.
- Category: Text contrast.
- Evidence: `--color-subtle` has 4.35:1 contrast on `--color-surface` and 4.05:1 on `--color-surface-raised`. It is used for 12px exact figures, labels, and preference status. Main text and muted text are substantially stronger: 16.47:1 and 8.19:1 on the ordinary surface.
- Impact: Supporting values that users need to reconcile usage are harder to read.
- Recommendation: Separate readable secondary text from decorative chart lines. Require at least 4.5:1 for normal-sized informational text on every surface where that token is used.
- Reference: [WCAG normal-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Ratios here were calculated locally using the current colors, not inferred from screenshots.

### F07. Session density styles alter the trend data table

- Location: `public/styles/components.css:83`, `public/styles/components.css:106`, `public/styles/components.css:110`.
- Category: CSS component isolation.
- Evidence: In Compact mode, a trend table measures 928px inside an 816px panel. It spans x=53 to x=981; the adjacent model panel starts at x=864. The body-density table selector overrides the trend table's minimum width. Opening the table also stretches the adjacent panel to 695px tall.
- Impact: Two separate data views overlap, and the model section gains a large empty area.
- Recommendation: Scope density, columns, and widths to the session table. Give the trend table its own layout. Align adjacent insights at their starts rather than stretching them to match an expanded table.

### F14. Session timestamps do not follow the selected query timezone

- Location: `public/scripts/format.mjs:6`, `public/scripts/format.mjs:58`, `public/scripts/explorer.mjs:10`, `public/scripts/drawer.mjs:15`.
- Category: Date and timezone presentation.
- Evidence: A URL-restored query shows `America/New_York` in the period context, while the first session still displays September 23 at 03:38, the same browser-local value shown for Asia/Taipei. `dateFormat` sets locale but no timezone.
- Impact: Users compare timezone-aware aggregates against session dates rendered in a different zone.
- Recommendation: Pass the selected timezone to usage-event date formatting. Define a separate, explicit policy for operational timestamps such as scan time and account reset. Keep locale and timezone as separate inputs.

## P2 findings

| ID | Surface and source | Evidence and user effect | Recommended contract |
| --- | --- | --- | --- |
| F08 | Plot axes, `trend.mjs:18` | Only the baseline and first/last date labels are drawn. There are no numeric Y ticks or metric unit on the axis. Users must inspect points to estimate magnitude. | Add restrained numeric ticks, meaningful X ticks, and an explicit metric unit. Keep linear scale and a visible zero baseline for nonnegative usage. |
| F09 | Tooltip and redraw, `trend.mjs:30` | The latest-point tooltip is always shown. No pointer-leave or dismiss handler exists. Every pointer move redraws all points and replaces tooltip text, including moves within the same selected interval. | Distinguish idle, pointer preview, and keyboard selection. Avoid redundant redraws; use one scheduled paint and one announcement per changed selection. Retain a readable selected value outside the plot. |
| F10 | Error recovery, `dashboard.mjs:66` | A reversed custom range produces generic stale-projection text, no `aria-invalid` fields, and no displayed specific error when prior data exists. The old chart stays fully opaque and operable; export is correctly disabled. | Validate the range in place, associate errors with fields, and show the active query separately from the prior successful projection. Add an explicit retry for request failures. |
| F11 | Facet select lists, `index.html:41` | Eight native multiple lists require modifier-key knowledge. A collapsed summary gives a count but does not identify which values restrict the report. | Keep native selects in the first migration. Add visible active-value chips with named remove buttons and Clear all outside the expanded area. Offer plain checkbox groups only where the small fixed domain makes them simpler. |
| F12 | Button and input states, `base.css:5`, `components.css:202` | Hover exists, but there is no authored pressed-state system. Disabled buttons can match hover rules. Most async buttons only become disabled without an operation label. The dashboard primary style is tied to `#refresh`; settings Save has the generic style. | Define shared primary, secondary, quiet, and remove variants with enabled hover/pressed, focus, busy, disabled, and error states. Keep labels stable in width. Use consistent named size tokens. |
| F13 | Preference scope, `components.css:123`, `explorer.mjs:10` | Exact/detail preferences have different effects in the summary and drawer. The session renderer does not emit `.cell-exact` or `.detail-col`, despite styles for them. Canvas and row focus rely on browser outlines rather than the authored teal focus rule. | State where each preference applies and test that effect. Include canvas and row actions in the shared focus vocabulary. Prefer one named detail action per session in the Tab order. |
| F15 | KPI copy, `dashboard.mjs:45` | Exact Input and Output values are both followed by the translated Total tokens label. The numeric value is right; its label is wrong. | Associate each exact value with its own measure name. Keep display rounding separate from raw accounting values. |
| F16 | Price disclosure, `dashboard.mjs:64`, `components.css:130` | Rate entries contain newline characters, but computed `white-space` is `normal`. Separate rate lines become one prose block. | Use a model heading and semantic label/value rows, preferably a compact price table. Keep unsupported rate components as unavailable. |
| F17 | Drawer diagnostics, `drawer.mjs:9` | Missing counts are formatted as zero. The observed drawer reports zero JSONL lines alongside accepted observations. Absence and a measured zero cannot be distinguished. | Show unavailable values as unavailable. Display zero only when the payload explicitly supplies zero; do not change the server's redaction rules. |
| F18 | Render boundaries, `dashboard.mjs:66`, `trend.mjs:25` | Turning off exact values resets a Home-selected chart point from 09-01 to 09-23 and closes an expanded trend table. Full rendering recreates charts, observers, facet options, rows, quotas, and drawer content. | Update only affected regions. Retain chart selection by timestamp, disclosures by identity, and focus by stable control. Preserve existing request-channel and bounded-cache logic. |
| F20 | Session table scroll contract, `components.css:95`, `components.css:98` | The table owns overflow but has no constrained vertical height. Sticky headers bind to that overflow ancestor instead of the document, while the document owns vertical scroll. Rows and their detail buttons also add duplicate Tab stops. | Define horizontal table overflow explicitly; verify vertical header behavior in the chosen scroll model. Keep a semantic table and named detail buttons. Do not adopt an ARIA grid without a real spreadsheet interaction requirement. |

F12 and F13 are authored-state consistency findings. A browser outline was visibly present on the canvas: `auto 1px`. This audit does not claim that all chart focus is invisible. Some native hover and select-popup behavior remains platform-specific and requires Windows verification.

Control borders currently have about 1.41:1 contrast against their input background. This is a risk to review against the full control design, not a claim that every border must meet 3:1. [WCAG non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) concerns visual information required to identify controls and states.

## P3 finding

F19: Repeated headings and panel weight. The model section repeats the concept in the eyebrow, title, and summary. The quota area nests bordered surfaces, while empty comparison and budget panels reserve 120px. Simplify repetition and use quiet separators where grouping does not require a panel. Preserve privacy and estimate explanations that change how a user interprets the data. Sources: `public/index.html:50`, `public/index.html:55`, `public/styles/components.css:49`, `public/styles/components.css:160`.

## Strengths to preserve

- The overview now starts at y=361 and ends at y=627 at 1440px.
- Source warnings are close to the summary, and partial totals retain a lower-bound marker there.
- Canvas keyboard selection and a semantic data table already exist.
- Chart ResizeObserver and listener cleanup are explicit.
- Query state, provider preferences, a bounded projection cache, and request cancellation have existing modules.
- Table rows expose redacted summaries, not raw conversations.
- Export is disabled while a projection is loading or stale.
- Settings remain a same-origin, allow-listed server operation. This audit did not save configuration.
- System fonts, local assets, desktop boundaries, and reduced-motion support fit the product.

## Evidence artifacts

The screenshots are local review evidence, not design mockups:

- Overview: `/Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/audit-overview.jpg`
- Drawer: `/Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/audit-drawer.jpg`
- Compact trend-table overlap: `/Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/audit-trend-overflow.jpg`
- View panel clipped at a verified 960px: `/Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/audit-view-menu-960.jpg`

## Limits

The current Codex month projection has six sessions, eight trend points, and three model rows. Normal populated Claude data is unavailable locally. No large-data performance benchmark, screen-reader session, Windows-native select check, browser zoom check, forced-colors check, remote-bind run, or network-failure injection was performed. CSS hover rules were inspected; not every control's native pointer behavior was exercised. Existing tests were read but not rerun during this planning-only pass.

See `docs/dashboard-ui-refactor-plan.md` for migration order, component contracts, chart options, and focused acceptance checks.

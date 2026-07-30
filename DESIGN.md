# Codex Token Dashboard Design System

## 1. Intent and visual thesis

This is a desktop-local engineering surface for understanding a selected period of Codex usage: total tokens, the API-equivalent estimate, source quality, and individual sessions. It should feel like a restrained observability console, not a consumer SaaS product: a calm cool-gray field, subtle layers, dense but readable information, and one teal action color. The existing JSONL parser and its accounting semantics remain authoritative; the UI only makes those facts inspectable.

## 2. Design tokens

All presentation values come from `public/styles/tokens.css`; no remote font, CDN, image, gradient, or one-off branded asset is used.

| Token family | Values and purpose |
| --- | --- |
| Canvas and surfaces | `--color-canvas: #0B0E12`; `--color-surface: #11161C`; `--color-surface-raised: #171D25`; `--color-surface-muted: #0F141A` distinguish page, ordinary panel, raised KPI/table header, and quiet supporting areas. |
| Text and borders | `--color-text: #F1F4F7`; `--color-muted: #A5AFBC`; `--color-subtle: #717D8D`; `--color-border: #29313C`. |
| Semantic status | `--color-accent: #63D3B2` for the primary action and selected estimate; `--color-info: #78AEFF`; `--color-success: #76D6A4`; `--color-warning: #F0C66C`; `--color-danger: #FF8294`, each with a quiet surface where a warning/error panel needs one. Text labels always accompany status color. |
| Typography | `--font-sans` is the system UI stack; `--font-mono` is for paths, diagnostics, and exact values. `--text-xs` 12px, `--text-sm` 14px, `--text-base` 16px, `--text-lg` 20px, `--text-xl` 28px, `--text-2xl` 40px. Numbers use tabular figures. |
| Spacing | Four-pixel scale: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px. |
| Shape and depth | `--radius-sm` 8px, `--radius-md` 12px, `--radius-lg` 16px, and `--shadow-surface` provide quiet, consistent elevation. Panels use a full low-contrast border, never a colored side stripe. |

## 3. Typography and content hierarchy

The interface supports Traditional Chinese and English, retaining established technical English labels such as `Input`, `Output`, `Cached`, and model names where they are the clearest domain terms. The hierarchy is: selected period and refresh/update actions; four executive KPIs; the token breakdown; system metadata and any real data-quality warning; then the interactive trend, session explorer, and pricing disclosure. KPI numerals are prominent without becoming marketing headlines. Exact values, paths, and diagnostic source labels use the mono stack with lower contrast.

## 4. Layout, responsive behavior, and scroll ownership

The supported product surface is desktop only: 1440–1600px content frame and a 960px minimum inline size. There is no mobile or tablet adaptation in this scope. The document owns vertical scrolling. The session table alone owns local horizontal overflow; its header stays sticky inside that container. The application shell, summary, metadata, and disclosures must not acquire nested scroll regions. Controls may wrap inside the dedicated period context without displacing the visual hierarchy at supported desktop widths.

## 5. Component inventory and states

| Primitive | Required state behavior |
| --- | --- |
| `AppHeader` | Identity, local-data explanation, language/view settings, explicit refresh, and user-initiated update check: default, loading (`解析中…`), success, unavailable, and disabled. |
| `PeriodContext` | Search, range, range-specific input, display unit, exact/detail toggles, sort, and native multi-select facets: default, keyboard-focus, selected, custom-range, and active-filter states. Multi-select facets include a short selection hint, a polite active-filter count, and a disabled clear action when no filter is active. |
| `MetricCard` | Exactly four executive cards: API-equivalent cost, Total, Input, Output; loading skeleton, populated, and unavailable (`—`) states. |
| `SecondaryBreakdown` | Cached, uncached, cache-write, and reasoning figures; loading and populated states. |
| `SystemMetadata` | Operating facts such as source directory, session count, timing, and pricing date; distinct from quality status. |
| `DataQuality` | Hidden while healthy. Warning/error panels appear only for parse failures, unpriced/partial-priced models, or a file cap. |
| `SessionTable` | A semantic table with a local scroll owner, sticky header, loading, populated, empty, and server-paginated states. The current page retains the complete accounting columns; column visibility is a local view preference. Density is local too: Comfortable retains full context with 100 sessions per page, Compact uses shorter rows with 150, and Dense removes secondary session context for a 200-session scan mode. |
| `PricingDisclosure` | Native `<details>` disclosure with collapsed and expanded states. |
| `UsageTrend` | Native Canvas line trend with pointer-nearest-point selection, Left/Right/Home/End keyboard selection, and an anchored detail popup that exposes the selected interval, total tokens, and estimated cost. A native disclosure table remains the non-canvas alternative. It has no decorative animation. |
| `ProjectionStatus` | A compact polite status line for the server projection: current, loading, stale-while-loading, and error. A cache hit is current only when it exactly matches the URL query; a miss never presents prior totals as current. |
| `BudgetForm` | A native inline `<details>` form with an explicit name, supported scope select, positive numeric limit, cancel, validation feedback, and saved state. It uses the existing control and action tokens rather than browser prompts. |
| `SettingsPage` | A loopback-only, two-column local configuration form using the existing control, surface, notice, and primary-action primitives. It has loading, validation-error, saved/restart-required, and remote-unavailable states; the unavailable state hides the unusable form and provides an explicit dashboard return path. It never embeds runtime secrets or session data. |

## 6. Interaction and motion

Range, search, sort, and paging obtain projections from the latest successful in-memory snapshot without starting a new JSONL parse. The client keeps a small, bounded cache of already-rendered dashboard projections. A cache hit may render immediately only when it exactly matches the active URL query. On a cache miss, the prior projection is explicitly stale, its metrics and explorer are busy, and the projection status announces that replacement values are loading. Only the explicit refresh control calls the rescan endpoint; the server double-buffers the result and retains the previous snapshot if parsing fails. JSONL parsing executes outside the HTTP event loop so static, diagnostic, and snapshot responses remain available during a scan. Range, search, and sort state are mirrored in the URL, while language, density, unit, detail, trend, and column preferences stay in local storage. The GitHub update check is a separate explicit user action and never runs automatically. The Canvas trend is a recorded novel interaction informed by the nearest restrained data-table pattern: pointer and keyboard selection anchor a non-interactive detail popup to the closest point; it flips below a near-top point and aligns at an edge so values stay visible. It uses no motion because no state transition benefits from animation. Focus indication is a 3px teal outline with offset; hover only clarifies actionable controls and table rows. Loading uses a low-contrast 1.2s opacity skeleton and must not shift layout. `prefers-reduced-motion: reduce` suppresses nonessential animation and transitions while preserving actual loading/error text. Escape closes the session drawer first, then clears search or closes the view menu.

## 7. Accessibility and security constraints

Controls have explicit labels; the summary, insight, and explorer expose `aria-busy`; quality/error and projection text use polite live regions; and the semantic table keeps headers. The active `lang`, metadata, title, dates, numbers, and currency follow the selected `zh-Hant` or `en` locale. The Canvas trend exposes a short summary, a live selected-point value, keyboard navigation, and a semantic table alternative. The local static shell stays same-origin under a restrictive CSP and `nosniff`; it must not expose raw session JSONL or conversation content. The settings endpoint is available only when the configured server host is loopback, requires the same Origin and bounded JSON body, allow-lists its `.env` keys, and atomically writes the local file; saved values require a restart before they affect the running process. GitHub checking only reads a fixed `owner/repo` latest-release endpoint when a user asks. Browser visual QA is directly performed by the root agent at desktop widths only; it is not delegated.

## 8. Scope, verification, and accepted debt

Focused verification covers syntax, the server’s static/root/CSP boundary, route traversal rejection, parser fixture semantics, server-side aggregation, pagination, URL state, local view preferences, the bounded projection cache, watcher status propagation, pricing disclosure data, and loopback-only atomic settings persistence. Direct visual verification checks the shipped desktop page and its loading, populated, warning, error, range, explorer, drawer, pagination, disclosure, and settings states. No mobile/tablet work, remote dependencies, analytics, glass effects, neon gradients, fake data, or silent data-semantic changes are accepted.

The server keeps `GET /api/summary` as its compatibility response. `GET /api/dashboard` accepts the validated range, search, sort, offset, and limit query parameters and returns range aggregates plus the first session page. `GET /api/sessions` returns subsequent filtered pages only. `POST /api/refresh` is the only rescan path; all current snapshot responses contain scan timestamp, snapshot version, and refreshing state. `GET /api/update` is disabled unless `UPDATE_REPOSITORY=owner/repo` is valid and never accepts a caller-provided URL. Dashboard routes expose summaries rather than raw JSONL or conversation content; model pricing is loaded from `server/pricing.json`.

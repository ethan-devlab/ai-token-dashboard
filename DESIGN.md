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

The interface is Traditional Chinese first, retaining established technical English labels such as `Input`, `Output`, `Cached`, and model names. The hierarchy is: selected period and refresh action; four executive KPIs; the token breakdown; system metadata and any real data-quality warning; then the session explorer and pricing disclosure. KPI numerals are prominent without becoming marketing headlines. Exact values, paths, and diagnostic source labels use the mono stack with lower contrast.

## 4. Layout, responsive behavior, and scroll ownership

The supported product surface is desktop only: 1440–1600px content frame and a 960px minimum inline size. There is no mobile or tablet adaptation in this scope. The document owns vertical scrolling. The session table alone owns local horizontal overflow; its header stays sticky inside that container. The application shell, summary, metadata, and disclosures must not acquire nested scroll regions. Controls may wrap inside the dedicated period context without displacing the visual hierarchy at supported desktop widths.

## 5. Component inventory and states

| Primitive | Required state behavior |
| --- | --- |
| `AppHeader` | Identity, local-data explanation, and a refresh action: default, loading (`解析中…`), and disabled. |
| `PeriodContext` | Search, range, range-specific input, display unit, exact/detail toggles, and sort: default, keyboard-focus, selected, and custom-range states. |
| `MetricCard` | Exactly four executive cards: API-equivalent cost, Total, Input, Output; loading skeleton, populated, and unavailable (`—`) states. |
| `SecondaryBreakdown` | Cached, uncached, cache-write, and reasoning figures; loading and populated states. |
| `SystemMetadata` | Operating facts such as source directory, session count, timing, and pricing date; distinct from quality status. |
| `DataQuality` | Hidden while healthy. Warning/error panels appear only for parse failures, unpriced/partial-priced models, or a file cap. |
| `SessionTable` | A semantic table with a local scroll owner, sticky header, loading, populated, empty, and server-paginated states. The current page retains the complete accounting columns; density and column visibility are local view preferences. |
| `PricingDisclosure` | Native `<details>` disclosure with collapsed and expanded states. |

## 6. Interaction and motion

The refresh action is the only header action. Range, search, and sort state are mirrored in the URL, while density, unit, detail, trend, and column preferences stay in local storage. These controls update visible data without changing accounting rules. Focus indication is a 3px teal outline with offset; hover only clarifies actionable controls and table rows. Loading uses a low-contrast 1.2s opacity skeleton and must not shift layout. `prefers-reduced-motion: reduce` suppresses nonessential animation and transitions while preserving actual loading/error text. Escape closes the session drawer first, then clears search or closes the view menu.

## 7. Accessibility and security constraints

Controls have explicit labels; the summary exposes `aria-busy`; quality/error text is a polite live region; and the semantic table keeps headers. `lang="zh-Hant"`, legible contrast, focus visibility, tabular numbers, and text-based state labels are required. The local static shell stays same-origin under a restrictive CSP and `nosniff`; it must not expose raw session JSONL or conversation content. Browser visual QA is directly performed by the root agent at desktop widths only; it is not delegated.

## 8. Scope, verification, and accepted debt

Focused verification covers syntax, the server’s static/root/CSP boundary, route traversal rejection, parser fixture semantics, server-side aggregation, pagination, URL state, and local view preferences. Direct visual verification checks the shipped desktop page and its loading, populated, warning, error, range, explorer, drawer, pagination, and disclosure states. No mobile/tablet work, remote dependencies, analytics, glass effects, neon gradients, fake data, or silent data-semantic changes are accepted.

The server keeps `GET /api/summary` as its compatibility response. `GET /api/dashboard` accepts the validated range, search, sort, offset, and limit query parameters and returns range aggregates plus the first session page. `GET /api/sessions` returns subsequent filtered pages only. Both dashboard routes expose summaries rather than raw JSONL or conversation content; model pricing is loaded from `server/pricing.json`.

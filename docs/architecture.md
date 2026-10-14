# Architecture

[Documentation index](README.md) · [API](api-v2.md) · [Security](security.md)

## Responsibilities

The server owns a registry of Codex and Claude providers. Each provider has its own parser adapter, incremental file index, atomic snapshot, pricing service, and watcher status. The server owns reconciliation, filtering, pricing, trend/model aggregation, pagination, comparison, export, and diagnostics. The browser persists permitted view state and renders server projections.

Providers initialize lazily on first data request. Refresh builds a new in-memory snapshot from that provider's file index. Unchanged files reuse their parsed session; changed files parse with bounded concurrency; a successful complete pass atomically replaces only that provider's active snapshot. Neither index nor session data is written to disk. Pricing caches contain public rates only.

## Data flow

JSONL discovery and parser workers produce adopted observations. Reconciliation identifies copies and valid event versions without guessing missing identities. The query selects observations, prices them against a verified current basis and builds one projection for KPI, trend, models and Session totals. Pagination and detail use that projection guard. Export preparation retains the admitted projection; transfer uses bounded buffers and response backpressure.

The browser requests server aggregates and renders them with local uPlot assets. It stores only permitted preferences, Provider-specific budgets and query/view state. Transcripts and credentials do not enter client storage. GET /api/providers also returns the running package version for the header.

## Storage and ownership

| State | Storage |
| --- | --- |
| Parsed data, incremental file index, snapshots and export tickets | Server memory |
| Local settings | Ignored .env file |
| Current public-price publications | Ignored Provider cache files |
| Complete pricing bases, check metadata and quarantined repair evidence | Ignored .pricing-archive and app-local pricing records |
| Minimal lifecycle events | Ignored private .lifecycle directory |
| Settings and pricing writer generations | Separate app-local lock directories |

Each lock elects one cooperating writer at startup. Normal shutdown drains work before releasing its generations. Startup recovery accepts only a confirmed absent same-machine owner under a guarded retirement; running readers do not take over. See [operations](operations.md) for failure handling and [security](security.md) for the external-editor boundary.

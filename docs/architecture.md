# v2 architecture

The server owns a registry of Codex and Claude providers. Each provider has its own parser adapter, incremental file index, atomic snapshot, pricing service, and watcher status. The server owns reconciliation, filtering, pricing, trend/model aggregation, pagination, comparison, export, and diagnostics. The browser persists permitted view state and renders server projections.

Providers initialize lazily on first data request. Refresh builds a new in-memory snapshot from that provider's file index. Unchanged files reuse their parsed session; changed files parse with bounded concurrency; a successful complete pass atomically replaces only that provider's active snapshot. Neither index nor session data is written to disk. Pricing caches contain public rates only.

# v2 architecture

The server owns parsing, reconciliation, filtering, pricing, trend/model aggregation, pagination, comparison, export, and diagnostics. The browser persists permitted view state and renders server projections.

Refresh builds a new in-memory snapshot from a file index. Unchanged files reuse their parsed session; changed files parse with bounded concurrency; a successful complete pass atomically replaces the active snapshot. Neither the index nor session data is written to disk.

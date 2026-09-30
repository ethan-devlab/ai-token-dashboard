# Phase 3 refresh and watcher implementation and validation

Date: 2026-10-01 (Asia/Taipei). Environment: macOS, Node v26.0.0. Phase 2 was committed as `443007b` before Phase 3 development. All validation used synthetic logs and isolated configuration/credentials. No real Session rescan, production restart, upstream request, source cache/configuration save, push, or release was performed.

## Changes and evidence

- FA08: removed argument-spread extrema. A 150,000-observation all-time projection completes with 150,000 tokens in KPI, model rank, and trend. This is a correctness check, not a performance claim.
- FA09: any hard file failure rejects the full refresh. Healthy-file updates, deletion, index records, reconciliation provenance, and snapshot version remain unpublished until the complete pass succeeds. A first failure stays uninitialized. Failure reason and retention status are visible in HTTP, metadata, diagnostics, and the existing UI.
- FA11/FA19: discovery checks for one extra eligible JSONL. Exactly the cap is not truncated; exceeding it marks file coverage incomplete and propagates the cap and known minimum omission through dashboard, quality and JSON export. Cap-displaced records count as excluded rather than verified deleted.
- FA14: missing-directory watchers recover; ordinary writes refresh an initialized cache; changed root identity causes rebind. Timers/watchers are owned, bounded and closed. An active parser is terminated on index close and cannot publish afterward.
- In-flight changes: candidates verify admitted membership and fingerprints, including reused files. Fingerprints include device/inode, size, nanosecond mtime and ctime. Same-size replacements with restored mtime are reparsed. Dirty events and unstable reads trigger a stable follow-up before publication. Only the final candidate commits. Three candidate passes bound one refresh; unstable automatic passes schedule a later debounce retry.

Before implementation, `tests/manual-phase3-probe.mjs` reproduced exact-cap false positives, failed-file loss (110 to zero), and a discovery/read mismatch. A 20,000-record file received an append during scanning; the parser read 2,480,125 bytes and 20,020 tokens, while the index retained an earlier fingerprint and reparsed it as changed on the next pass. After the change, that unstable candidate is rejected and the stable next pass adopts 20,020. Plain concurrent refresh calls still coalesce; only verified dirtiness requests follow-up. Receipts: `phase3-probe-baseline.json` and `phase3-probe-after.json`.

Production files: `server/session-index.mjs`, `session-parser-worker.mjs`, new small `session-file-state.mjs`, `summary-cache.mjs`, `provider-registry.mjs`, `dashboard-data.mjs`, `server.mjs`, and `public/scripts/dashboard.mjs`, `request-channels.mjs`, `i18n.mjs`. No package, database, CSS redesign, or browser polling was added.

## Executed checks

| Command or surface | Result | Scope |
| --- | --- | --- |
| `node --test tests/phase3-reliability.test.mjs` | 11 passed | Transaction rollback, cap, reuse, scan/write, bounded follow-up, worker close, large projection, real local watcher lifecycle |
| `node --test --test-name-pattern='summary cache\|session index' tests/server-services.test.mjs` | 3 passed | Existing affected service checks |
| `node --test tests/phase1-accounting.test.mjs tests/phase2-calendar.test.mjs` | 36 passed | Shared index/projection regression |
| `npm run test:client` | 33 passed | Existing client behavior |
| `node tests/phase3-http.mjs --serve` | Passed | Actual copied server routes/assets; isolated failure/cap fixtures; external fetch returns 503 |
| Direct in-app browser QA | Passed | Root agent; English 1280px and Traditional Chinese 960px desktop |

The rollback fixture retains 118 tokens (failed 110, healthy 5, later-deleted 3) and v1 across repeated failures. Repair then adopts 129 (120 + 9), records one deletion/two changes, clears the failure and publishes v2. An in-flight write is rejected while the committed index remains reusable. Deferred-generation tests prove only one final commit; follow-up failure and continuing changes cannot commit an earlier candidate. Closing during parsing leaves zero active workers. The real watcher fixture covers missing root recovery, subsequent writes, root rename/replacement, teardown, and no later version change after close.

HTTP checks verify first scan failure has no snapshot, 110 tokens/v1 survive a failed manual refresh and remain in list/detail, repair publishes v2, cap warning propagates into JSON export, and removing the extra file clears the cap at v3. Same-origin POST remains enforced. Public error/projection fields do not expose the temporary absolute root.

Browser QA uses a retained 120-token capped test snapshot v4. Initial GET shows the prior file failure and file-coverage warning. Manual Reparse and Retry keep 120/v4 with localized failure reason, retained-query status, and disabled export while the failed client refresh is unresolved. At 960px, scroll width is 960px and the warning fits its panel. The final page has no console errors. The tab was closed, temporary viewport reset, and fixture server/temp files removed.

Screenshots in this chat's visualization directory: `phase3-refresh-rollback.png`, `phase3-retained-960.png`, and `phase3-quality-960-viewport.png`. They show synthetic test data only.

## Assumptions and limits

File coverage is distinct from skipped lines and uncertain usage. Existing malformed-line and Phase 1 reconciliation policies remain in force. A capped snapshot can be a successful accepted pass while file coverage is incomplete; retention qualifiers do not remove its cap warning. Files are never locked or edited by production scanning. Verification establishes a stable admitted pass, not an atomic filesystem-wide snapshot or protection against every missed OS event.

Watcher recovery checks identity every second only with AUTO_REFRESH enabled. Browser synchronization is still a product decision; this phase does not add polling. Real OS watcher error emission and worker exit without a message were not fault-injected; their close/retry guards were inspected, while active worker termination and directory recovery/replacement were executed.

Phase 4 page/snapshot/export consistency and Phase 5 quota/settings remain open. Standard source contract harness was skipped because it can make upstream pricing requests and write source caches; isolated actual routes covered this phase. Windows, other Node versions, real provider-log variants, native browser download completion, and production rollout remain unverified. The existing production service was not restarted. The HTTP harness requires Node 18.19+ for --import; production remains Node >=18.

Windows-local checks: run the four focused Node/npm commands above and `node tests/phase3-http.mjs`. Use --serve for the isolated desktop QA surface, then press Enter or stop it to remove temporary files.

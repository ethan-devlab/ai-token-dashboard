# Fork accounting validation

Date: 2026-10-15. Runtime: Windows, Node v24.13.1.

## Scope

- Codex paginated continuation and fork baselines use the referenced decoded byte prefix, not the ancestor's latest total.
- Claude copied assistant responses share one adopted message version across main Session IDs. Main and distinct agents remain separate namespaces.
- Incremental refresh recomputes reconciliation from retained normalized observations. It does not mutate the parsed-file index or write a Session disk cache.
- The HTTP harness uses isolated synthetic logs, settings, credentials, pricing storage, and a loopback port. Its imported fetch stub prevents upstream requests. Temporary files and the owned server are removed in `finally`.

## Checks

`node --test tests/phase1-accounting.test.mjs`

Covers exact UTF-8/CRLF boundaries in Zstandard history, parent versus fork attribution, recursive inherited baselines, missing and cyclic ancestors, ancestor recovery with reused child files, genuine resets, independent same-ID files, inherited explicit-event replay, and unsupported unbounded forks. Claude checks cover cross-Session copies, newer versions, repeated conflicting refresh retention, distinct response IDs, costs, details, and agent isolation. Existing accounting and quality checks remain enabled.

`node tests/phase1-http.mjs`

The isolated shipped routes adopt 100 parent tokens plus 30 new fork tokens: all-time is 130 and October is 30. Dashboard, trend, Sessions, detail, and JSON export agree. Claude adopts a copied 15-token response once plus a new 17-token response: 32 total. Existing export-format, provider-isolation, and same-origin checks remain enabled. History metadata and byte offsets are absent from public payloads. The Windows fixture loader uses a file URL for `--import`.

`node --test tests/phase4-projection.test.mjs`

Checks projection identity, pagination, full matched exports, and provider isolation.

`node --test --test-name-pattern='session index|compressed Codex history|Claude session parser' tests/server-services.test.mjs`

Checks existing incremental index, compressed copy/failure retention, and Claude parser contracts.

`node --test tests/phase3-reliability.test.mjs`

Ten checks passed, including rollback, reuse, concurrent changes, worker cleanup, and a 150000-observation query. The watcher root-rename check returned `EPERM` in the sandbox. The isolated rerun below passed outside the sandbox; no watcher implementation was changed:

`node --test --test-name-pattern='missing-directory watcher' tests/phase3-reliability.test.mjs`

`git diff --check` and syntax checks of the changed server modules passed.

## Boundaries

Local real-log comparisons were read-only. No transcript, credential, local directory, response ID, or private usage measurement is stored in this report. No external provider request, browser visual QA, GitHub push, version bump, or release was performed. This change has no UI layout component.

Missing identities and unsupported fork formats remain explicitly uncertain. This is not a guarantee that every historical log variant can be reconciled. Restart the server to load the changed code and replace its memory-only snapshots.

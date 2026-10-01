# Phase 5 quota and settings validation

Historical checkpoint: Q34–Q39 subsequently replace dashboard OAuth rotation with CLI-owned read-only credentials and add settings ownership. See [settings-ownership-validation.md](settings-ownership-validation.md). The executed evidence below describes the original Phase 5 policy, not the current automatic-refresh behavior.

Date: 2026-10-01 (Asia/Taipei). Branch: main. Node: v26.0.0 on macOS.

## Confirmed policies

Q22 retains the last successful quota after network, rate-limit, or service failure. The response and UI mark it stale and show the successful fetch time, failed check time, and normalized reason. Authentication, invalid/missing credentials, and login changes clear former quota. Q24 masks each stale window after its reported reset; other windows retain stale values. Missing reset times stay unknown. No extra retention deadline was selected. Retention is in memory and ends on successful replacement, a login/unsupported-response failure, or process exit.

Q23 rejects stale settings forms and retains their edits. Q25 requires a version on every settings save. Q26 includes Claude credential-file conflict protection in this phase.

## Changes and compatibility

Server quota normalization accepts finite numeric percentages from 0 through 100. Null, empty text, booleans, numeric strings, and out-of-range values remain unknown. Present windows with unknown usage remain visible; absent or unsupported window structures do not fabricate windows. Reset conversion checks the Date range before formatting. A measured numeric zero remains valid; numeric zero reset remains the epoch, while null never becomes the epoch.

Quota caches remain provider-separated and coalesce active checks. A server-only digest of credential-file contents gates cache reuse and response publication. Any external content change invalidates former success; the digest, tokens, account IDs, and paths never enter quota responses. An owned OAuth rotation preserves login continuity, including stale quota if the subsequent usage request fails transiently. Claude rotation checks the original file before creating its exclusive temporary file and again before rename. A detected change aborts the write and returns credentials-changed. Normal rotation preserves unrelated fields and restrictive permissions. The original fake-file probe lost both the CLI token and unrelated CLI change; the new regression preserves the replacement file exactly and skips the usage request.

Settings GET reads the current file and adds a revision. POST requires a quoted If-Match header containing that revision. Missing or malformed versions return 428 SETTINGS_REVISION_REQUIRED; changed versions return 409 SETTINGS_CONFLICT. This intentionally changes the old unversioned POST contract. The JSON body retains the exact settings allow-list. Each resolved file path has a serialized save queue, an exclusive UUID temporary file, and a second revision check before rename. Comments and unrelated values survive. Runtime settings still apply only after restart.

The browser retains a rejected form and disables save until reload. Reload asks whether to keep edits or discard them and load current settings. There is no silent merge, forced save, automatic retry, or automatic restart. Local transport failures hide quota because the browser cannot verify the current login; upstream transient failures use server-verified stale data. Unsupported upstream formats do not retain old quota. These conservative cases preserve the login boundary.

Owned files: server/account-usage.mjs, server/settings.mjs, server.mjs, public/scripts/account-usage.mjs, dashboard.mjs, settings.mjs, i18n.mjs, public/settings.html, focused service/client tests, and this phase's test fixtures, README API table, and documentation. No CSS, dependency, provider parser, pricing, watcher, or export change.

## Executed checks

- node --test tests/phase5-reliability.test.mjs: 7 passed. Covers unknown values, measured zero, reset bounds, stale failures, per-window reset masking, login/cache invalidation, in-flight login replacement, concurrent CLI rotation, owned token-rotation continuity, conflicting settings saves, file permissions, cleanup, missing versions, invalid settings, and external edits.
- node --test --test-name-pattern='account usage|settings' tests/server-services.test.mjs: 5 passed. Includes normal Claude rotation and preserved metadata.
- node --test --test-name-pattern='account usage|quota percentages|settings dirtiness' tests/client-state.test.mjs: 3 passed. The old expectation that 102 becomes 100 was changed to unknown.
- node tests/phase5-http.mjs --serve: passed against actual copied routes/assets with synthetic credentials, a disposable .env, and upstream mocks. Confirms stale/reset/auth/unknown quota states, secret redaction, 428/409/400/403 settings responses, a single concurrent-save winner, fresh-file GET, external edits, and restart-required responses.
- Syntax checks for changed modules and git diff --check passed.

Root desktop QA used English at 1280px and Traditional Chinese at 960px. Quota showed a stale reason, unknown expired 5-hour usage, and retained 50% weekly usage. Authentication failure cleared both windows and details and released the busy state. Null usage/reset showed unknown; measured zero showed 100% remaining. Switching to an unsigned Claude fixture cleared Codex figures. Two settings tabs produced a successful 3350 save and a rejected 3351 edit. Keep editing retained 3351; confirmed discard/reload read 3350 and cleared dirty state. A later external fixture change to 3366 also rejected the retained 3352 form. The Traditional Chinese dialog fit 960px; scroll width was 960px. No console errors were captured in the quota or settings checks.

Proof files: phase5-stale-quota.png, phase5-stale-quota-960.png, phase5-settings-conflict.png, and phase5-settings-conflict-960.png under the session visualization directory. The viewport API applies to the active tab; dimensions were read from the target DOM before accepting 960px evidence.

## Limits and reproduction

Serialization protects dashboard-owned saves within one process. Revision checks detect external changes that occur before the last check. An uncooperative external writer can still change either file between that check and rename; filesystem rename does not offer a cross-process conditional replacement. This phase does not claim a shared CLI lock or perfect exclusion of external writes.

Windows, other Node versions, live provider endpoints, real credentials, native Service/Tray, production rollout, disk-full/write-denied fault injection, and native download completion were not checked. No real configuration/credential write, production restart/rescan, upstream request, push, or release occurred. Broad accounting/contract suites were not repeated because their modules were unchanged; the source contract harness can fetch upstream prices and write source caches. Fixture tabs/server/files were removed and temporary viewport changes were reset after desktop QA.

Windows-local reproduction: run the three focused Node test commands above and node tests/phase5-http.mjs. For desktop QA, run node tests/phase5-http.mjs --serve and use its test-only URL. Type fail, auth, unknown, or ok before the UI quota check; type settings after loading a form to create an external file conflict. Stop with Ctrl+C. The harness requires Node 18.19+ for --import; production remains Node >=18.

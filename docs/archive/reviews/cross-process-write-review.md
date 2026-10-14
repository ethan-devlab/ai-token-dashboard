# Cross-process write boundary review

Date: 2026-10-01 (Asia/Taipei). Source baseline: 83ba020 on main. Runtime: Node v26.0.0 on macOS. The original checkpoint added a diagnostic probe and decisions only. Q34–Q39 subsequently change product behavior; see [settings-ownership-validation.md](../validation/settings-ownership-validation.md).

## Write ownership at baseline

Settings writes originate from the loopback, same-origin, revision-required settings route. server/settings.mjs serializes writes by resolved path in one process. It reads the initial revision, creates an exclusive temporary file, reads the revision again and renames the temporary file over .env. Another dashboard process has a separate queue. A manual editor does not participate in that queue.

Codex quota reads credentials but does not rotate them. Claude quota can refresh OAuth credentials when expiration is near or the usage endpoint returns an authentication error. server/account-usage.mjs checks the original digest before writing a temporary file and again before rename. Active requests are coalesced in one service instance. A CLI or another dashboard process does not share that active map. Quota publication rechecks the resulting file digest; it cannot recover a CLI replacement already overwritten by the dashboard.

The current atomic replacement keeps readers from receiving a partially written dashboard file. It does not make the separate revision read and replacement one conditional operation. A lock used only by dashboard instances cannot force an independent editor or CLI to wait.

## Controlled reproduction

Run:

```sh
node tests/manual-cross-process-write-audit.mjs
```

The command works as a separate Node command on Windows too, but Windows was not run here. It creates disposable synthetic .env and credential files. A child Node process writes the external replacement. All OAuth/usage responses are mocked; no network request or real credential read occurs.

The original probe committed in 40c3e6c uses process-local built-in interception to pause the shipped write sequence at temporary-file completion or immediately before native rename. It synchronizes ESM bindings, runs the child writer, then resumes the operation. It does not modify product modules. Hooks are restored and disposable files removed. This is a forced valid interleaving, not a probability estimate or a live CLI reproduction. The current script retains the raw settings boundary probe and replaces the removed credential-write cases with read-only expiry and in-flight CLI replacement checks. The table below is the original observation record.

| Surface | Child write timing | Observed result | External replacement |
| --- | --- | --- | --- |
| Settings | Before final revision read | SETTINGS_CONFLICT | Preserved byte-for-byte |
| Claude credentials | Before final digest read | credentials-changed, no usage request | Preserved byte-for-byte |
| Settings | After final revision read, before rename | Save reports success | Overwritten |
| Claude credentials | After final digest read, before rename | Quota reports available; one mocked old-login usage request | Overwritten |

All four scenarios reached their intended injection point and left no temporary write files. Quota responses contained no synthetic credential marker. Exit zero means the expected baseline behavior was observed, including the two overwrites; it is not a correctness pass. Do not add this diagnostic to a passing regression suite unchanged after a mitigation alters the observed behavior.

## Decision frontier

Settings and credential ownership are independent decisions. Their dependent implementation questions must wait for the selected ownership policy.

- Q34: Should the CLI own all Claude credential writes? Recommended: dashboard reads credentials and uses valid access tokens, but never requests a refresh token or writes the shared login file. Expired or rejected credentials require a CLI refresh/login and an explicit recheck. Local JSONL analysis remains available. This removes dashboard-origin credential replacement; it changes the currently supported automatic refresh behavior. Alternative: retain current guarded rotation and explicitly accept the final external-writer interval. A dashboard-only lock must not be presented as CLI cooperation.
- Q35: Should one dashboard writer own each settings file? Recommended: enforce ownership among dashboard instances, retain version checks, and require external edits while the writer is stopped. Independent editors cannot be technically excluded by this policy. Alternative: retain current process-local serialization and best-effort external revision detection, with the final interval documented.

If Q34 selects read-only credentials, the next frontier covers expiry/auth response semantics and removal of unused rotation code, tests and documentation. It must preserve Q22–Q24 login invalidation and transient stale retention. No new credential copy or refresh-token store is implied. If rotation is retained, its residual risk must stay explicit.

If Q35 selects single-writer settings, the next frontier covers ownership scope, second-instance behavior, crash recovery and manual-editor workflow. No lock-file deletion, stale-lock recovery or server startup failure policy is silently selected here. Locking pricing caches and archives remains R02 scope unless separately included.

## Confirmed ownership decisions

Q34 selects CLI-only Claude credential management. Dashboard requests must not call the OAuth refresh endpoint or write the credential file. Valid access tokens can query usage; expired or rejected credentials require a CLI update and manual recheck. Preserve login-change invalidation, transient stale retention and local JSONL analysis. No dashboard credential copy is introduced.

Q35 selects a single dashboard settings writer for each settings file, with required revisions retained. External edits are supported while the writer is stopped; they cannot be excluded by a dashboard-only ownership mechanism. The selected policy does not include pricing lifecycle ownership.

The current server has a close handler but no explicit SIGINT/SIGTERM shutdown handler. A new ownership lifecycle must cover normal signal exit and listen failure. Q36 selects a usable additional instance with read-only settings. Q37 selects explicit manual recovery; unknown, malformed or unverifiable ownership must not become permission to overwrite.

Q38 fixes ownership at process startup. A read-only instance does not acquire ownership through polling, settings reload or a failed save. It requires restart after ownership becomes available. Q39 selects an explicit unlock command that acts only when the same-host former owner can be confirmed absent. Active, permission-denied, malformed, foreign-host and uncertain owner states are refused. Normal shutdown releases the owned lease; a crash leaves it for explicit recovery.

## Implementation scope and acceptance plan

1. Remove Claude OAuth refresh and shared-file writes from server/account-usage.mjs. Use valid access tokens for the fixed usage endpoint. A known expiry at or before the request clock, or an authentication rejection, returns auth-expired with no windows and clears last success. Tokens still valid near expiry may be used; the former 30-second proactive rotation is removed. Missing expiry can still be checked by the official usage endpoint; invalid credentials retain existing errors. Keep credential digest checks around cache use/publication, Provider isolation, transient stale/reset behavior and secret redaction. Update bilingual CLI refresh/recheck guidance and remove obsolete rotation claims.
2. Add a narrow server/settings-owner.mjs lifecycle for the settings path. Use exclusive filesystem ownership with a private generation identifier. Resolve the parent identity so normal directory aliases share ownership; unsafe/unverifiable paths must disable writes. Validate the owned generation before saves and release only the same owned generation. Unknown existing state is read-only. Revisions and existing temporary-file serialization remain required. No dashboard-only lock claims to exclude editors or CLI writes.
3. Integrate ownership at startup in server.mjs. Settings GET adds a bounded write-availability state without owner PID, digest or lock path. A non-owner POST returns a specific conflict before writing; existing loopback, Origin, body limits and revision checks stay intact. Other routes remain available. Normal SIGINT/SIGTERM and listen failure clean up the owned lease after dashboard-owned settings work is finished. Never release another generation or auto-recover a stale lease.
4. Show stored values with disabled editing/saving and a restart explanation in a non-owner settings page. Read-only state is not busy state and must not block Back. Retain dirty-form conflict/leave behavior if ownership is lost after editing. Reload does not acquire ownership. No layout redesign is included.
5. Add node server.mjs --unlock-settings as an explicit local recovery mode before pricing initialization, provider scanning or listening. Validate the supported command and current app's settings lock; refuse active or uncertain owners. Verify the exact stale generation and protect recovery from deleting a newly acquired owner, including two competing unlock commands. Do not add force deletion. Document manual external-edit shutdown and restart steps; ignore the local lease artifact in Git.
6. Replace obsolete rotation expectations after implementation and add focused ownership/service checks. Update the diagnostic's credential branch to report read-only behavior rather than preserve old overwrite expectations. Keep the settings branch explicitly scoped: an uncooperative external edit during an owned save is still possible and violates the selected stop-before-edit workflow.

Required observable cases:

- Valid Claude quota uses one usage request and leaves credential bytes unchanged. Expired credentials cause zero network requests; 401/403 causes no refresh retry. CLI replacement invalidates old quota. Network failure retains same-login stale values; passed reset windows remain unknown.
- Two actual copied server processes share one .env at distinct ports. Exactly one can save; the other reads the same settings with disabled writes, while query/export still work. Same-process stale revisions still reject. Alias-path ownership cannot yield a second writer.
- Normal owner shutdown and failed listen do not strand its lease. Existing read-only instances stay read-only; a new process can own it. An abnormal exit leaves a lease that no startup or page reload steals.
- The explicit command refuses a live, foreign or malformed owner and performs no pricing/network/scan work. It removes only a verified absent same-host owner's lease. Concurrent unlock/acquire cases cannot remove a new owner. Retry then restores one writer.
- Root desktop QA checks English and Traditional Chinese read-only settings, usable Back/reload, expired Claude guidance and unaffected local analytics on a copied fixture. No production process or real settings/credential file is changed.

Implementation, focused checks, isolated actual HTTP/multi-process scenarios and root desktop QA must finish before the implementation commit and next decision dialog. Windows, power-loss durability, malicious lock replacement, live CLI timing, pricing ownership and release rollout remain separate limits. No dependency or framework is added.

## Executed validation and limits

The diagnostic ran once and produced the four observations above. Its syntax and git diff --check passed. No product test suite or browser QA was repeated because no product change was made. No real settings/credential write, production request/restart, package installation, live endpoint call, push or release occurred. Live CLI timing, Windows behavior and power-loss durability remain unverified.

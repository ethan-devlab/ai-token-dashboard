# Cross-process write boundary review

Date: 2026-10-01 (Asia/Taipei). Source baseline: 83ba020 on main. Runtime: Node v26.0.0 on macOS. This checkpoint adds a diagnostic probe and decision record only. Product behavior is unchanged.

## Write ownership today

Settings writes originate from the loopback, same-origin, revision-required settings route. server/settings.mjs serializes writes by resolved path in one process. It reads the initial revision, creates an exclusive temporary file, reads the revision again and renames the temporary file over .env. Another dashboard process has a separate queue. A manual editor does not participate in that queue.

Codex quota reads credentials but does not rotate them. Claude quota can refresh OAuth credentials when expiration is near or the usage endpoint returns an authentication error. server/account-usage.mjs checks the original digest before writing a temporary file and again before rename. Active requests are coalesced in one service instance. A CLI or another dashboard process does not share that active map. Quota publication rechecks the resulting file digest; it cannot recover a CLI replacement already overwritten by the dashboard.

The current atomic replacement keeps readers from receiving a partially written dashboard file. It does not make the separate revision read and replacement one conditional operation. A lock used only by dashboard instances cannot force an independent editor or CLI to wait.

## Controlled reproduction

Run:

```sh
node tests/manual-cross-process-write-audit.mjs
```

The command works as a separate Node command on Windows too, but Windows was not run here. It creates disposable synthetic .env and credential files. A child Node process writes the external replacement. All OAuth/usage responses are mocked; no network request or real credential read occurs.

The probe uses process-local built-in function interception to pause the shipped write sequence at either temporary-file completion or immediately before the native rename. It synchronizes ESM bindings, runs the child writer, then resumes the actual operation. It does not modify the product modules. Hooks are restored and disposable files are removed. This is a forced valid interleaving, not a probability estimate or a reproduction with a live CLI.

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

## Executed validation and limits

The diagnostic ran once and produced the four observations above. Its syntax and git diff --check passed. No product test suite or browser QA was repeated because no product change was made. No real settings/credential write, production request/restart, package installation, live endpoint call, push or release occurred. Live CLI timing, Windows behavior and power-loss durability remain unverified.

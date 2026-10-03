# Startup recovery of absent owners

Date: 2026-10-03 (Asia/Taipei). Environment: macOS, Node v26.0.0. Decision Q78 supersedes the manual-only recovery of a valid confirmed absent local owner in Q37/Q39/Q58. The user selected this change after [terminal stop investigation](terminal-stop-lock-investigation.md). Normal shutdown still drains work and releases its own generations.

## Delivered behavior

Settings and pricing acquire ownership at startup. When the lock already exists, startup validates its owner record and accepts recovery only for this machine with an owner PID that returns ESRCH. It repeats that absence check inside the existing guarded retirement. Retirement moves the guarded old directory to a unique retired path and removes only that path; startup then competes through exclusive mkdir and owner-file creation for a new generation.

An active or reused PID, foreign host, malformed/oversized record, unsafe path, permission-denied process check, busy operation guard or unexpected directory content does not grant write access. Damaged or uncertain state remains available for inspection. A competing new generation is not removed. Startup does not retry acquisition indefinitely. Each settings/pricing lease has one writer, independently; they do not have to belong to the same winning contender. A running reader remains read-only even after its former writer ends.

Explicit unlock commands remain available with their existing guard and no force option. Recovery is not exposed by HTTP. Same-origin and revision checks, atomic settings writes, pricing publication/basis validation, fatal crash handling, the 30-second drain and minimal journals are unchanged. Automatic lease recovery does not repair a damaged settings file, pricing publication or basis archive. An interrupted .operation guard remains an inspection boundary. PID reuse can conservatively block recovery until the unrelated PID ends; a live PID is never assumed stale from elapsed time.

## Focused validation

| Check | Result |
| --- | --- |
| `node --test tests/settings-owner.test.mjs tests/pricing-owner.test.mjs` | 23 passed. Absence recovery, eight simultaneous contenders, recheck that becomes active, active unlock refusal, foreign/malformed/oversized/busy/unexpected/permission-denied refusal, lost/replacement generation, aliases and unsafe paths |
| `node tests/startup-recovery-http.mjs --serve` | Real SIGKILL leaves both leases and no final record. Two real startup contenders recover without manual unlock; exactly one settings writer and one pricing writer per Provider. Existing readers remain read-only. Configuration bytes and complete adopted usage match before any deliberate fixture save |
| `node tests/settings-owner-http.mjs` | Guarded saves, reader refusal, Claude no-write/no-refresh, normal/failure cleanup and automatic restart after SIGKILL passed |
| `node tests/process-lifecycle-http.mjs --skip-deadline` | All handled signals, admitted work/stream interruption, failure paths and journals passed. Fatal exception/rejection and SIGKILL leave evidence; the next startup automatically recovers both verified absent owners |
| `node tests/pricing-ownership-http.mjs` | Publication, verification, reader, repair and cleanup regressions passed. SIGKILL checkpoints after archive, cache temporary file, publication and quarantine now restart without unlock commands, preserving the publication/unknown-cost rules |
| Desktop in-app browser | Recovered writer had enabled controls. Saving Maximum files from 999 to 1001 displayed Saved to .env and No unsaved changes; the fixture file contained MAX_FILES=1001. No writer console errors. Competing reader showed the updated warning and disabled fields/save |

All HTTP and save checks used copied applications, disposable configuration, synthetic logs and blocked upstream requests. The main multiprocess fixture adopted exactly 10 Tokens. Temporary applications and desktop tabs were removed. Desktop artifacts: `startup-recovery-settings-saved.png` and `startup-recovery-reader-readonly.png` in the chat visualization directory.

The changed-owner unit check makes the first process probe report absent and the guarded second probe report active; the original owner bytes remain intact and no operation directory remains. Refused malformed/foreign checks also preserve the owner bytes. Simultaneous recovery and independent acquisition cannot remove the newly acquired generation.

## Delivery scope

The formal 3333 process still runs the earlier backend from the separately authorized pricing recovery. Its settings and pricing writer access are available; this phase did not signal it or change its .env. A separately selected restart is required to enable Q78 there. The previous Claude publication/archive error remains outside this lock change.

No Codex application code, terminal behavior, service manager, dependency or global configuration was modified. No real Codex stop button was used to force-kill the formal server. The unchanged real 30-second deadline, full suite, power-loss durability, a frozen event loop and other operating systems were not retested. This change restores safe access on next startup; it does not claim SIGKILL can execute shutdown cleanup.

## Authorized formal restart after 351c4d6

The user selected restart and verification. Preflight confirmed PID 81058 held both leases on 127.0.0.1:3333. SIGTERM recorded cleanup-complete and exit 0; both lock paths were absent before restart. The previous npm session ended successfully. A new npm start, Node PID 81611, now runs Q78 and owns both leases.

The .env SHA-256 remained `86115a871701c9aef95f4286923ba2dffa377f560ccbf6661b85f67b5a442268`. Settings revision, HOST and ALLOW_REMOTE are unchanged. September 2026 / Asia/Taipei range, complete totals, full cost object and pricing basis revision exactly match preflight; adopted usage is 587597633 Tokens. Settings and both Provider pricing services are writable. The new lifecycle record has start/listening, availability=true and no error. Its private file mode is 0600. The real desktop settings page has enabled controls and save with no console errors; no real configuration save was made.

The prior Claude publication/archive error remains separate and unchanged. No forced stop was applied to the formal service; the automatic absent-owner path was verified in the isolated multiprocess checks above. Artifacts: `startup-recovery-live-before.json`, `startup-recovery-live-after.json` and `startup-recovery-live-settings.png` in the chat visualization directory. The temporary tab was closed and the service remains running.

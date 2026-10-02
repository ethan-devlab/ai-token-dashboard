# Graceful shutdown and lifecycle record validation

Date: 2026-10-03 (Asia/Taipei). Policy: Q70–Q77. Plan: 7f63b6f. Runtime: Node v26.0.0 on macOS. The old owner's exact termination cause remains unknown; the earlier investigation only reproduced one possible SIGHUP path.

## Delivered behavior

- `server/process-lifecycle.mjs` writes separate private, exclusive UUID JSONL records under ignored `.lifecycle/`, using restricted event fields. No automatic deletion or shared append file exists. Unsafe existing directories are refused without following their symlinks. Record failure latches unavailable and stops further recording for that run; service and saves remain available. A later run creates a new file.
- `server.mjs` installs signal and fatal observation before owner acquisition, tracks initialization and asynchronous handlers independently of sockets, and admits no new route work after stopping. SIGINT/SIGTERM/SIGHUP share one 30-second deadline. Repeated signals coalesce with bounded records. Exports abort, HTTP closes, parsing and pricing work drain, then guarded owner generations release. Startup interrupted before listening does not start further services.
- Provider closure now waits for watcher startup and the pending summary refresh as well as parser termination. Failed listen and normal shutdown use the same cleanup. Cleanup failure and deadline exit nonzero. Required cleanup precedes release; unsafe/unreleased generations remain blocked for explicit recovery. An existing nonzero exit code is preserved.
- Native fatal exception/rejection behavior is retained through `uncaughtExceptionMonitor`; no crash/rejection handler keeps the app alive or releases locks. SIGKILL cannot produce a final record. HTTP Diagnostics returns only journal availability, restricted error state and last complete UTC record time; existing local/source restrictions stay in place.

## Checks and evidence

All injected faults use disposable copied applications, synthetic settings/logs, fake credential roots and blocked upstream fetches. No test runs against the formal app's settings, credentials or pricing stores.

| Check | Actual result |
| --- | --- |
| Three graceful signals and restart | Exit 0; both owned locks removed; exact start/listening/shutdown/cleanup/exit sequence; restart writable; separate run files |
| Client cancels a delayed settings save | Saved `.env` matches the prepared file byte for byte. Both locks remain while the save is delayed; cleanup runs once after completion |
| Client cancels a delayed pricing repair | Publication matches prepared bytes exactly before ownership release; clean shutdown waits for queued work |
| Signal during initialization | Delayed bundled publication completes exactly, no listening event or further settings acquisition; safe lock release |
| Repeated mixed signals | First SIGHUP cause retained, one cleanup, bounded coalesced records and one deadline |
| Already-connected new request during shutdown | Valid local request returns 503 SERVER_STOPPING; hostile Origin still returns 403 before route work |
| Active streamed download | Transfer body fails after SIGHUP; graceful exit and both lock releases follow aborted export completion |
| Real deadline | Full integration run measured 30,022 ms; exit 1, both unsafe locks retained, deadline/exit records; second signal did not extend it. Earlier run measured 30,010 ms |
| Cleanup release failure | Nonzero exit and failed settings generation retained; no false cleanup-complete record |
| Fatal exception/default fatal rejection | Native exit 1, fatal/exit evidence, both locks retained; synthetic secret/error text absent from JSONL |
| SIGKILL/manual recovery | Locks retained, last event only listening; reader stays read-only. Restricted recovery commands succeed after absent owner and create no lifecycle records |
| Open/write/partial-write fault | Safe unavailable Diagnostics, settings save still succeeds, failed file bytes do not change after failure, exactly one failed write attempt; restart creates a healthy new record |
| Unsafe directory/symlink | Refused journal path; outside target unchanged; normal analysis and lock cleanup remain available |
| Concurrent processes | Distinct run identities/files, one settings writer, reader shutdown preserves writer locks, no previous record cleanup |
| Local/remote source policy | Cross-origin and cross-site Diagnostics denied; remote bind denies Diagnostics; recovery and record status reveal no private ownership fields |
| Background refresh closure | Waits for admitted work, rejects its late publication, no initialized cache after closure |
| Desktop Diagnostics | Actual 1280×720 IAB page displays available/null and unavailable/write-failed states. Both pages have zero console errors; lifecycle contains exactly three approved keys |

Commands run:

```sh
node --test tests/process-lifecycle.test.mjs tests/request-policy.test.mjs tests/export-stream.test.mjs tests/server-services.test.mjs
node --test tests/phase3-reliability.test.mjs
node tests/process-lifecycle-http.mjs --serve
node tests/process-lifecycle-http.mjs
node tests/process-lifecycle-http.mjs --skip-deadline
node tests/settings-owner-http.mjs
node tests/local-policy-http.mjs
node tests/stream-export-http.mjs
```

The selected unit run passed 32 tests, followed by a five-test targeted lifecycle run that includes the added exit-status check (33 distinct checks in total). The 11-check parsing/watcher regression suite also passed after early watcher stop was added. Two complete integration runs included the real deadline. Later integration reruns used `--skip-deadline` to validate byte comparisons, pricing drain, active-export interruption and early watcher stop without repeating the unchanged 30-second stall. The normal default command always includes the real deadline. Settings ownership, local-source HTTP and native streaming HTTP regressions passed. Syntax, diff whitespace and 68 local documentation links passed. All disposable processes/files and desktop tabs were cleaned up.

Desktop artifacts are under the task artifact directory `~/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/`: `lifecycle-diagnostics-available.png` and `lifecycle-diagnostics-failed.png`. These are isolated fixture views, not the formal service.

## Formal service and limits

The formal 3333 service was not signaled, restarted or given new settings. Delivery checks confirmed the same listener (PID 73255), an unchanged `.env` SHA-256 (`01602ebfcfc4427badcaf1224b6f51f3a869904842f2a0dff902fd4fd80d7b52`), settings/pricing writer access, no lifecycle field yet and no formal `.lifecycle/` directory. It will gain lifecycle behavior only after an explicitly selected restart. No service manager, global configuration, dependency, cloud resource or credential change was made.

No power-loss/fsync guarantee, Windows/other Node runtime certification or caller attribution was tested. The deadline needs a responsive event loop; it cannot preempt a frozen main thread or blocked synchronous OS I/O. A process removed before observation, a module/import failure, or SIGKILL may lack a final record. Native Node stderr is left unchanged and is not copied into the journal. Journal files are diagnostic evidence, not a tamper-proof ledger; external mutation of app directories remains outside cooperative writer guarantees.

# Graceful shutdown and lifecycle record plan

Date: 2026-10-03 (Asia/Taipei). Design checkpoint: f017d95. Plan commit: 7f63b6f. Status: user-confirmed implementation completed; see [validation](process-lifecycle-validation.md). The formal 3333 restart remains a separate decision. See the [process investigation](process-lifecycle-investigation.md). The exact termination cause of historical PID 69544 remains unknown.

## Confirmed decisions

| Decision | Selected behavior |
| --- | --- |
| Q70 | Keep npm start and manual lock recovery; add graceful SIGHUP handling and lifecycle records. No LaunchAgent installation or automatic takeover |
| Q71 | Permanently retain small local records; deletion needs a separate explicit instruction. No automatic cleanup |
| Q72 | A record failure does not stop analysis or change settings/pricing safety. Report the failure; do not claim persistence |
| Q73 | First shutdown request starts one 30-second deadline. Stop admission and downloads, wait for started work, then release ownership. Timeout exits nonzero with unreleased locks retained |
| Q74 | Coalesce repeated SIGINT/SIGTERM/SIGHUP. Do not restart cleanup or extend the deadline |
| Q75 | On an observable fatal exception, record a restricted event if possible and retain the native Node crash path. No asynchronous cleanup, lock release or continued service |
| Q76 | Add current record availability and safe failure state to existing loopback Diagnostics; no record contents or private identifiers |
| Q77 | After any journal failure, stop writing that run's file, retain partial evidence and latch the unavailable state. Restart creates a new record |

No recorded event includes request contents, query values, full paths, environment values, credentials, usage data, error messages or stacks. PID and a random run identity are local-file evidence only; HTTP never returns them.

## Current source and external contracts

server.mjs currently handles only SIGINT/SIGTERM and starts cleanup after HTTP close. providerRegistry.close() is asynchronous but is not awaited at the current call site. Both pricing services expose queued close() completion. A closed client socket does not establish that its asynchronous settings/pricing handler has finished. The new drain must track started handler completion separately from connections, before releasing ownership.

Node's [HTTP close API](https://nodejs.org/api/http.html#serverclosecallback) stops new connections; its force-close API also destroys active connections. This plan uses graceful close first and forceful socket closure only at the selected deadline. Node's [uncaughtExceptionMonitor](https://nodejs.org/api/process.html#event-uncaughtexceptionmonitor) observes an exception without replacing the default crash behavior. Do not install an uncaughtException or unhandledRejection handler that silently keeps the service alive. Validate behavior on the installed runtime; other versions remain unverified.

## Implementation boundaries

- Add a small lifecycle module under server/ and integrate it into server.mjs. Use built-in Node APIs; no dependency, new form setting, global startup change or service manager.
- Store each normal application run in a separate exclusive UUID-named JSONL file under APP_DIR/.lifecycle/. Add only that directory to .gitignore. Create private directories/files (0700/0600), reject unsafe existing directory/file types and do not follow symlinks or overwrite another run. No shared append file, archive activation or record reader API is needed.
- A record schema has a version, UTC timestamp, PID/run identity, fixed event name and allow-listed signal, exit code or reason when applicable. Events cover process start, listening, first shutdown request, bounded duplicate-signal evidence, successful/failed cleanup, deadline, observable fatal failure and exit. Use bounded event records; never copy exception text or Node stderr into JSONL.
- Register normal lifecycle observation and shutdown handling as early as practical after the explicit recovery-command branch and before owner acquisition. --unlock-settings/--unlock-pricing retain their existing no-listener/no-pricing/no-scan behavior and do not create lifecycle records. Handle signals during initialization as an interrupted startup: stop starting further work, wait for admitted initialization/write work, then release safely. Module parse/import failures before observation starts are outside the record guarantee.
- Journal initialization/write failures latch unavailable status for the run and emit a bounded safe stderr warning. Analysis and ownership rules continue. Do not retry, repair or truncate the damaged run file. New startup uses a new file. Final/crash records are best effort, not fsync or power-loss evidence.
- Add lifecycle to GET /api/diagnostics with only availability, a safe lastError code and the last successfully recorded timestamp. Keep loopback-only and source guards. Existing diagnostics JSON rendering displays it; no history UI or unrelated dashboard change is needed.

## Shutdown sequence and invariants

1. The first supported signal sets stopping state and one referenced 30-second timer. Record the request if the journal is available. Repeated signals cannot replace the first cause, reset that timer or start another cleanup.
2. Stop accepting new HTTP connections and new handler work. Any already-connected request that reaches the application after stopping returns a safe 503 SERVER_STOPPING before route work, while retaining the existing Host/Origin gates. Close idle connections and abort/release active export plans as existing shutdown semantics require. Stop automatic pricing schedules.
3. Wait for admitted initialization and asynchronous handlers, including handlers whose clients already disconnected. Then await provider shutdown and pricing queue completion. Do not let HTTP close alone release writer generations. Await required cleanup before release; failures must not be reported as a clean stop.
4. Release each owned generation only when admitted work is quiescent. Preserve existing guarded generation retirement and non-owner behavior. Record completed cleanup and normal exit without converting a prior failure to exit 0.
5. At the original deadline, stop remaining sockets, record timeout if possible and exit nonzero. Do not call unsafe early release or delete retained locks. Partial cleanup may have released a generation that completed safely; any remaining uncertain state stays blocked for the existing explicit recovery process.
6. Fatal exceptions only trigger restricted synchronous/best-effort observation and the original Node exit behavior. No lock release or continued request processing is attempted. SIGKILL, native fatal errors and process removal can leave only earlier events, or no final event. A missing final record cannot identify the caller or signal.

The deadline is a process timer under a responsive event loop, not a hardware guarantee for a frozen main thread, blocked OS I/O or power loss. The journal is private diagnostic evidence, not a tamper-proof ledger. This scope does not decouple the process from Codex/terminal lifetime.

## Focused implementation acceptance

Implement first, then add focused tests; no TDD. All fault injection uses disposable copied applications, synthetic data and intercepted upstreams.

| Scenario | Required evidence |
| --- | --- |
| SIGINT, SIGTERM, SIGHUP | Normal exit, both owned locks removed, correct journal sequence, one cleanup; restart restores one writer |
| Repeated mixed signals during delayed work | First cause and deadline stay fixed, cleanup occurs once, no default second-signal termination |
| Delayed settings/pricing operation and client disconnect | Exact committed file bytes; locks retained until handler work and queues finish; no post-release publication |
| Signal during startup | No premature listen/new work; admitted initialization completes or times out; no early generation release |
| Stalled handler/cleanup | Selected 30-second timer leads to nonzero exit and retained unsafe locks; verify one real deadline case and use injected timers for small unit cases |
| Uncaught exception/default fatal rejection | Nonzero native exit, restricted fatal/exit evidence if possible, locks retained; no synthetic secret/message/stack in journal or Diagnostics |
| SIGKILL | Locks retained; no claimed final event; manual restricted recovery remains required |
| Journal denied/open/write/partial-write fault | Service and normal settings API remain usable, safe stderr/Diagnostics error, no further writes to failed run, a later run creates a separate record |
| Unsafe journal path and concurrent processes | Refuse symlink/unsafe record writes without touching their targets; distinct run files, one cooperating settings/pricing writer, no cleanup of old records |
| Diagnostics desktop | Actual local page displays only approved lifecycle status; remote/source-denied requests remain refused; no PID, run ID, file name, path or journal data in HTTP |

Run the new lifecycle tests plus selected settings-ownership, local-source and stream-shutdown regressions. Do not repeat the broad contract harness or pricing fetches against the real app. Check syntax, fixture cleanup, data/log redaction, docs and intended staged files. Record actual results and limits, then commit. The formal 3333 process, .env and credentials remain unchanged during implementation acceptance; a formal restart is a separate decision afterward.

The user confirmed complete implementation after plan commit 7f63b6f. Q70–Q77 remain the policy basis. No formal restart or independent startup manager was included in that authorization.

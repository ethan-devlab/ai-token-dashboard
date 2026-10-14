# Terminal stop and ownership recovery

Date: 2026-10-03 (Asia/Taipei). Source checkpoint: b4f8370. The user authorized recovery of the stale pricing lease and reported stopping the earlier server through the Codex terminal or task UI.

## Completed recovery

The pricing owner record identified same-machine PID 75532. A fresh process check returned ESRCH. Its private lifecycle record contained only start and listening, with no handled shutdown, fatal, cleanup or exit event. This does not identify the exact termination signal or caller.

The restricted `node server.mjs --unlock-pricing` command succeeded. No force deletion was used. PID 80973 was then stopped with SIGTERM; it recorded cleanup-complete and exit 0 and released its settings lease. Both ownership paths were absent before a new npm start. PID 81058 acquired both settings and pricing ownership. The formal service remains on 127.0.0.1:3333.

The .env hash stayed `86115a871701c9aef95f4286923ba2dffa377f560ccbf6661b85f67b5a442268`; settings revision was unchanged and September usage stayed 587597633 Tokens. Both Provider pricing services report writable=true. The Codex archive is valid. The prior Claude publication/archive error remains a separate condition; this action did not repair its pricing records. Lifecycle is available with no journal error. Evidence is `pricing-lock-recovered.json` in the chat visualization directory.

## Terminal behavior and limits

Read-only inspection of the installed Codex application, version 26.930.21537, found these terminal backend paths in its packaged main module:

- Normal terminal termination calls node-pty kill without a signal; the packaged Unix backend defaults to SIGHUP.
- Terminal backend disposal with process-tree cleanup on macOS kills descendants and the terminal with SIGKILL. Terminal action restart also requests process-tree cleanup.

These are installed-code facts, not proof that the historical button press used one particular path. The historical owner has no handled shutdown record. No Codex application files were modified, and no real UI stop was clicked for the formal server.

An isolated copied dashboard under npm start in a real pseudo-terminal received Ctrl+C. It recorded SIGINT, a coalesced SIGINT, cleanup-complete and exit 0; both ownership paths were absent. The outer interactive shell subsequently blocked during harness shutdown, so this probe does not claim a successful terminal-close UI check. The harness was interrupted and all fixture processes and files were removed. Bounded evidence is `terminal-stop-probe.json`.

`node tests/process-lifecycle-http.mjs --skip-deadline` passed: all three handled signals release ownership; admitted work drains before release; a directly forced SIGKILL leaves ownership and the last listening record; native fatal paths retain ownership as selected. The unchanged 30-second deadline was not repeated. The tests use isolated processes and blocked upstream fetches.

[Node signal documentation](https://nodejs.org/api/process.html#signal-events) confirms that SIGKILL cannot have a listener. An exit handler or more asynchronous cleanup cannot run after that signal. The current dashboard already handles SIGINT, SIGTERM and SIGHUP. Normal completion releases ownership, while forced termination, fatal failure or incomplete cleanup retain the selected manual recovery boundary.

## Required policy decision

The existing Q37/Q39/Q58 decisions require manual recovery, including when a same-machine owner is confirmed absent. To remove routine unlock commands after forced stops, select a new recovery policy rather than claiming an uncatchable signal can be cleaned up:

1. Startup-only automatic recovery of a verified absent same-machine owner, using the existing guarded generation retirement. Active, foreign, malformed, permission-denied or uncertain ownership remains read-only. Startup writer selection remains fixed; running readers do not take over. Preserve atomic save, publication and restart validation.
2. Keep manual recovery and add an explicit graceful stop workflow. This helps ordinary stops but still needs recovery after an external SIGKILL.
3. Evaluate operating-system-managed locking as a separate portability and dependency decision. It can avoid directory-lease persistence but cannot guarantee an interrupted write completed.

No automatic recovery, new stop command, dependency, service manager or global configuration was added in this investigation.

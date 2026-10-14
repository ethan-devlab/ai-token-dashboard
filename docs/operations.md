# Operations and recovery

[Documentation index](README.md) · [Security](security.md) · [API](api-v2.md)

## Choose the next action

| Symptom | Action |
| --- | --- |
| Settings are local only | Open localhost, 127.0.0.1 or [::1] on the dashboard host. LAN connections cannot access settings |
| Settings or pricing is read-only | Stop the former writer, then restart. A running reader does not acquire ownership through Reload |
| A forced stop left a lock | Restart. Startup recovers only a valid same-machine owner whose PID is confirmed absent |
| Ownership is still blocked | Inspect the failure. Active, foreign, damaged, busy or uncertain locks are not recovered automatically or forced open |
| Costs are unknown | Check pricing publication/archive status. A writer can repair; a reader can load an already valid publication |
| Login-plan usage is expired/rejected | Update the login in the provider CLI, then use Check again |
| Export version conflicts | Review the reloaded dashboard and press Download again |

## Settings and pricing writers

Each app directory has independent settings and pricing ownership. One startup writer saves .env; one pricing writer manages both Provider stores. Other processes can analyze/export data and read permitted settings, but cannot perform those writes. Ownership is fixed until restart.

Startup checks owner metadata and PID absence, then repeats the check inside guarded retirement before competing for a new generation. Active or reused PIDs, another machine, malformed records, permission failures, busy guards and unknown states remain blocked. Recovery coordinates cooperating dashboard processes, not independent editors. Stop the writer before external .env or pricing-file edits.

Explicit recovery remains available when its guard can verify absence:

```sh
node server.mjs --unlock-settings
node server.mjs --unlock-pricing
```

Run the applicable command from the app directory, then restart. Commands refuse active or uncertain ownership, have no force option, and do not scan, fetch rates or start a server. Do not delete an active lock. See [startup recovery evidence](archive/validation/startup-owner-recovery-validation.md).

## Stop and restart

SIGINT (Ctrl+C), SIGTERM and SIGHUP stop new work and active downloads. The server waits up to 30 seconds for admitted startup, requests, parsing and pricing work before releasing its generations. Repeated signals do not restart cleanup or extend the deadline. Failed listen also releases owned generations.

Cleanup failure or timeout exits nonzero and can retain locks. Fatal exceptions keep Node's crash behavior; SIGKILL cannot run cleanup or record a final event. The next startup still applies restricted absent-owner recovery. A responsive event loop is required for the timeout; power-loss durability is not guaranteed. No Service/Tray or service manager is installed.

Private .lifecycle records contain UTC time, local PID/run identity and fixed events with restricted signals, codes and reasons. They contain no request data, paths, credentials or raw errors/stacks. Retention is permanent until explicit manual cleanup. A journal failure stops further recording for that run but keeps analysis available; Diagnostics exposes only availability, a safe code and last successful record time. Restart creates a new record.

## Refresh and publish prices

- With valid current pricing, the writer checks each Provider's fixed official source at most once per UTC day. Update model prices performs an explicit refresh. A failed/invalid source retains previously verified rates.
- Codex and Claude have separate public-price publications, archives and refresh state. Provider operations run in order; old attempt metadata cannot overwrite a newer basis.
- New rates activate only after archive and publication succeed. Existing version-1 publications remain supported if the complete basis agrees with a valid archive.
- Costs, including historical events, use the current retained basis. Every new cost response or export preparation verifies that basis again; already admitted downloads keep their data.
- Invalid storage keeps Tokens available and costs unknown. Invalid check metadata makes the check time unknown and adds a warning without invalidating verified rates.
- Load published rates verifies and loads the latest committed publication into the full dashboard. A reader retains an older basis only while it remains valid. There is no history switcher.

Current publications are .pricing-cache.json and .claude-pricing-cache.json. Complete bases and check metadata remain under .pricing-archive/<provider> without automatic deletion. JSON/Markdown exports include complete rules, rates, multipliers and revision; CSV references revision and availability.

## Repair pricing storage

Only a genuinely empty Provider store is initialized from bundled rates. Missing/damaged existing publication state does not select a historical archive automatically.

Repair pricing archive is writer-only. It uses complete previously verified data or newly fetched and validated rates, quarantines damaged files without discarding their bytes, and never replaces a valid basis. An interrupted repair leaves a .repairing marker; affected costs remain unknown until an explicit writer action completes publication. A verified former first-archive time can be retained; otherwise the recreated basis records its actual new archive time.

Archives, quarantine and repair markers are permanently retained. Process interruption/restart has focused evidence; this is not a power-loss guarantee, historical billing ledger or tamper-proof record. See [pricing recovery evidence](archive/validation/pricing-ownership-recovery-validation.md).

## Login-plan quota

The panel is available on a loopback bind. It reads existing CLI credentials server-side and sends only required authorization/account context to the provider's fixed official endpoint. Tokens, identifiers, email and credential paths never enter browser responses, Diagnostics or logs. The dashboard does not refresh OAuth or write Claude credentials.

Results are cached for 60 seconds; Check again bypasses the cache. A transient failure can retain a confirmed same-login result as stale. Reset windows whose previous values no longer apply become unknown. Expired/rejected login or changed credentials clears former quota; update the CLI login and retry. Unsupported service responses do not affect local JSONL analytics.

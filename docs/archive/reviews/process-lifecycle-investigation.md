# Dashboard process lifecycle investigation

Date: 2026-10-03 (Asia/Taipei). Source checkpoint: 4b7d857. Scope: inspect startup/shutdown and available records, reproduce one bounded exit path, then request a product decision. No shutdown handler, startup configuration or automatic lock recovery policy was changed.

## Established local facts

The earlier settings investigation found both owner records pointing to absent PID 69544. The user-started reader PID 72927 ran node server.mjs under npm start from a VS Code integrated zsh terminal. Its parent chain was npm PID 72912, shell PID 29453 and VS Code. Restricted recovery and normal restart restored settings and pricing writer access, as recorded in [recovery validation](../validation/settings-ownership-validation.md#2026-10-03-stale-owner-recovery-and-settings-spacing).

The replacement listener PID 73255 runs node server.mjs under npm PID 73241, Codex CLI PID 69710 and the desktop app PID 69663. Standard input is /dev/null; stdout/stderr are pipes rather than an application-owned persistent log. This is a tool-started process, not an independently managed startup service.

The current desktop app and Codex CLI started on 2026-10-02 at 12:29:09 and 12:29:15, respectively. The old owner was created at 12:25:22 that day. The machine's boot time was 2026-09-21 21:29:49, so this incident did not involve a machine reboot. The app restart is relevant chronology, not proof that it sent a particular termination signal to the old server.

No repository-owned launcher or service manager exists; package.json starts node server.mjs directly. No matching project reference was found in /Library/LaunchAgents; ~/Library/LaunchAgents does not exist. This is not an exhaustive inventory of all possible external startup tools. Native Service/Tray product support remains outside this scope.

## Available records and limits

- The old execution session 3540 was no longer available. Its final exit status and stderr could not be retrieved.
- Two selected project npm start debug records for local startup at October 2 11:42 and October 3 00:06 reported exit 0. Neither supplied a verifiable termination record for owner PID 69544; those clean exits do not explain this incident.
- No selected node/npm/Codex diagnostic report filename for October 2–3 was found in ~/Library/Logs/DiagnosticReports. Absence of a report does not exclude a kill, runtime exception or interrupted cleanup.
- A focused unified-log query for PID 69544 and termination evidence between 12:25 and 12:32 on October 2 returned no termination matches. It does not establish what happened later. Broad raw system/network records were not saved as project evidence.

The exact old exit time, signal, caller and any cleanup error remain unknown. Do not report a confirmed Codex kill, SIGHUP, SIGKILL or application crash for PID 69544.

## Source and isolated reproduction

server.mjs handles SIGINT and SIGTERM by closing exports and HTTP connections. The close event initiates provider/pricing cleanup and releases the owned settings and pricing generations. There is no SIGHUP handler or application-owned persistent lifecycle record. SIGKILL cannot be handled; it retains the selected explicit recovery boundary.

A disposable copy of server/public/package.json used synthetic missing-data paths, AUTO_REFRESH=0, empty update configuration, isolated credential roots and intercepted external fetches. Each child reported writable=true before its selected signal. The actual results were:

| Signal / continuation | Child exit | Settings lock | Pricing lock | Result |
| --- | --- | --- | --- | --- |
| SIGTERM | code 0, no terminating signal | Removed | Removed | Normal cleanup completed |
| SIGHUP | terminated by SIGHUP | Retained | Retained | No graceful handler ran |
| Restart after SIGHUP | Service started | Still retained | Still retained | Settings writable=false, writeReason=occupied |

The SIGHUP path reproduces the observed lock/read-only pattern. It does not identify the cause of the historical incident. All probe children and copied files were removed; the formal listener was not signalled during this investigation. Prior [ownership checks](../validation/settings-ownership-validation.md) already cover SIGKILL/manual recovery and live-owner refusal.

## Next decision

1. Recommended bounded change: retain npm start and the existing startup-only writer policy; add graceful SIGHUP handling plus minimal persistent lifecycle evidence. Select record content, retention, failure behavior and graceful-stop bounds before implementation. This can improve the reproduced signal path and future diagnosis; it cannot make SIGKILL or power loss clean.
2. Separate startup design: use a macOS LaunchAgent to decouple the dashboard from the desktop app and terminal. Review concrete configuration, start/stop and logging before installation. Persistent startup and any restart policy need explicit authorization; a manager does not remove the selected stale-lock safeguards.
3. Operational documentation only: keep current handlers, stop through SIGINT/SIGTERM, and retain restricted manual recovery after abnormal exits. This adds no protection for the reproduced SIGHUP path.

These are decision candidates, not authorization to install a service or start another implementation. No automatic stale-lock deletion or takeover is proposed. The exact historical termination remains unverified.

# Status and limits

[Documentation index](README.md) · [Historical evidence](archive/README.md)

## Supported behavior

The desktop dashboard analyzes local Codex and Claude logs, including separate Claude subagent executions. It provides timezone-aware queries, observation-level model filters, current-basis costs, guarded pagination/detail and streamed exports. Refresh builds a candidate snapshot and retains the prior complete snapshot on hard failure. Settings and pricing ownership are independent and fixed at process startup.

Normal SIGINT, SIGTERM and SIGHUP shutdown drains admitted work and releases ownership. Forced termination cannot run cleanup; the next startup recovers only a valid same-machine lock with a confirmed absent PID. Active, foreign, damaged, busy or uncertain ownership remains read-only. Readers do not promote themselves while running.

## What has been verified

| Surface | Evidence and limits |
| --- | --- |
| Accounting, model filters, calendar boundaries and refresh | [Phase records](archive/README.md#validation-records) use bounded synthetic cases; they do not certify every real log variant |
| Downloads and unsaved settings | [Browser validation](archive/validation/browser-download-settings-validation.md) includes desktop native downloads, cancellation and leave behavior |
| Startup ownership recovery | [Unit, multiprocess and desktop checks](archive/validation/startup-owner-recovery-validation.md) cover confirmed absent owners, competition and refusal boundaries |
| Pricing publication and repair | [Interrupted publication checks](archive/validation/pricing-ownership-recovery-validation.md) cover archive/cache/quarantine phases; power-loss durability is not established |
| Query/export performance | [Measured acceptance](archive/validation/pricing-ownership-recovery-validation.md) uses 150000 observations; timing/RSS are local workload measurements, not a capacity or hardware guarantee |
| CI on 2026-10-14 | [Run 38540223112](https://github.com/ethan-devlab/ai-token-dashboard/actions/runs/38540223112) passed Ubuntu Node 18 syntax/server and Windows Node 22 client/HTTP contract checks for 6cf50ce. [Correction record](archive/validation/windows-contract-ci-validation.md) describes the preceding local checks |

These records overlap; do not add their counts as a new complete test run. A prior formal 3333 restart is a historical observation, not the current service state or a released-artifact guarantee.

## Remaining boundaries

- Windows CI does not certify all ownership, permission, watcher or storage-failure paths. Other Node/OS combinations need focused checks.
- Independent editors are outside the cooperative writer lease. Stop the writer before external .env or pricing-file edits. Shared/hostile filesystems and malicious same-user processes are outside the verified boundary.
- Pricing archives are not historical billing ledgers or tamper-proof records. Invalid publication/basis keeps costs unknown; interrupted repair requires an explicit writer action.
- Live quota and pricing endpoints may change. Synthetic responses establish normalization and failure behavior, not permanent upstream compatibility.
- Watcher hints and admitted fingerprint checks do not provide a filesystem-wide atomic snapshot or guaranteed delivery of every OS event.
- Arbitrary dataset sizes, true memory peaks, general concurrent load, second-device LAN access, forced colors and assistive technology need further validation.
- No authentication, supported HTTPS tunnel/proxy trust, Service/Tray product, mobile/tablet UI, history-rate switcher or download resume is provided.

The [archived issue register](archive/reviews/functional-status-inventory.md) retains original issue IDs, policy decisions and detailed gaps. Its older rollout/PID claims are historical.

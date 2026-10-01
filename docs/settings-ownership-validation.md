# Settings ownership and read-only credentials validation

Date: 2026-10-01 (Asia/Taipei). Branch: main. Policy baseline: 16a78b6. Runtime: Node v26.0.0 on macOS. Q34–Q39 are implemented.

## Delivered behavior

Claude credential management belongs to the CLI. The dashboard no longer requests OAuth refresh or writes the shared credential file. Valid access tokens query only the fixed usage endpoint. Known expiry is checked before cache reuse and requests; expired or rejected login clears prior quota and reports auth-expired. Missing expiry can be checked by the endpoint. Valid near-expiry tokens are not proactively rotated. Digest checks still reject externally replaced credentials. Same-login transient failures retain explicit stale quota with the selected reset masking. Local JSONL analysis remains available.

Each loopback dashboard attempts settings ownership at startup. server/settings-owner.mjs resolves parent-directory aliases and creates an exclusive .env.settings-lock directory with private owner metadata. Existing ownership, unsafe paths or failed acquisition make settings read-only. Owner metadata never enters HTTP responses. A lost generation disables writes; required form revisions and serialized exclusive temporary writes remain. Ownership checks run inside each queued save, before preparing and before replacing the file. A second process can query, export and read settings, but cannot save. Reload does not acquire ownership; restart is required.

Settings GET adds writable and writeReason. Non-owner POST returns 409 SETTINGS_READ_ONLY after the existing same-origin and body checks. The UI disables editing/saving without marking a loaded read-only form busy or blocking Back. Lost ownership preserves edits, focuses the error and scrolls it into view. Its dirty text no longer instructs a read-only user to save. Reload asks before discarding edits. No layout or synchronization policy changed.

Normal SIGINT/SIGTERM waits for HTTP close before releasing ownership. Failed listen cleans up the lease. Under an exclusive operation guard, retirement moves the owned directory to a unique private path; cleanup uses that path, so it cannot delete a new acquisition. Normal release briefly retries a busy guard but never steals uncertain state. Abnormal exit leaves the lease for explicit recovery.

node server.mjs --unlock-settings runs before configuration/pricing initialization, Provider scanning or listening. It accepts no extra arguments. It requires valid same-host metadata and an absent PID; active processes, permission errors, foreign/malformed metadata, existing operation guards and unexpected contents are refused. No force mode or automatic recovery is provided. PID reuse can conservatively block recovery. The command removes only the guarded stale generation. Restart a read-only process after recovery.

## Executed checks

- node --test tests/settings-owner.test.mjs — eight checks passed after the release change. Covers one winner through directory aliases, fixed read-only lifecycle, active-owner refusal, normal release during refused unlock, explicit stale recovery, malformed/oversized/foreign/busy/unexpected state, injected EPERM, lost generation, concurrent recovery with a new acquisition, and unsafe settings symlink/hard-link refusal. A later node --test --test-name-pattern='invalid explicit recovery' tests/settings-owner.test.mjs passed one additional command check: extra/attached recovery arguments exit one without starting a server, creating runtime state or fetching. Nine distinct cases ran; no nine-case aggregate run is claimed.
- node --test tests/phase5-reliability.test.mjs — eight checks passed after read-only changes. Covers CLI replacement, near-expiry stale quota, cache expiry and no OAuth retry on 401/403. The later node --test --test-name-pattern='ownership loss' tests/phase5-reliability.test.mjs passed one additional check: old .env bytes survived and the prepared temporary file was removed. Nine distinct cases ran; no nine-case aggregate run is claimed.
- node --test --test-name-pattern='account usage|settings' tests/server-services.test.mjs — five checks passed, including expired Claude zero-request/unchanged-file behavior.
- node tests/settings-owner-http.mjs --serve — copied application routes and multiple actual child processes passed. A second run after the shutdown release change also passed; counts are not added. Both intercepted every external fetch.
- node tests/manual-cross-process-write-audit.mjs — current diagnostic confirms expired credentials cause zero requests/writes; a child replacement during usage stays byte-identical while old quota is rejected. The raw settings writer still reproduces an uncooperative edit after its final revision check. Exit zero is diagnostic completion, not a claim that this remaining boundary is fixed.
- Changed-file syntax, local documentation links and git diff --check passed.

The first race hook missed macOS's canonical /private/var spelling. The hook was changed to realpath; the final eight-case run passed. A browser getByLabel lookup had no match; the observed Provider ID and a fresh DOM snapshot supplied the actual selectors. These were fixture/selector issues, not product defects.

## Actual HTTP and process scenarios

Two servers share one .env at distinct ports. Exactly one reports writable=true. The other returns 409 SETTINGS_READ_ONLY on a same-origin save and still serves a 10-Token query and JSON export. Missing Origin returns 403. The owner's successful save is readable from the second process; a stale revision then returns 409.

Expired Claude credentials return no windows without invoking mock fetch. Valid credentials return 60% remaining; 503 retains stale data; 401 clears it. Credential bytes remain unchanged and no OAuth endpoint call is recorded. Other fetches fail locally.

SIGTERM removes the owner lease; the existing read-only process stays read-only. A new owner that cannot listen on an occupied port exits one and releases its lease. SIGKILL leaves a lock; new startup does not steal it. Explicit recovery exits zero without fetches and removes it, but does not promote a running read-only instance. Restart restores one writer. Recovery of a live owner exits one and leaves metadata unchanged.

## Root desktop evidence

Desktop only, 1160 × 761, direct in-app browser:

- English and Traditional Chinese read-only settings show MAX_FILES=999 and disabled inputs/Save. Reload preserves read-only state. Form aria-busy=false and Back aria-disabled=false; Back returns to analysis.
- Claude expiry guidance states that the CLI must update login and the dashboard does not refresh credentials. Local analysis still shows 20 Tokens and its Session/plot. A synthetic CLI file update followed by Check again restores 60% remaining.
- An owning page edits 999 to 998. Replacing only its disposable ownership generation then pressing Save preserves 998 and disables saving. Keep editing preserves it; explicit Discard edits and reload restores 999 and clean status, still read-only.
- Final focus evidence: activeElement.id=settingsNotice, notice top=182, retained value=998, aria-busy=false and visible read-only dirty guidance. Final captured browser error logs were empty.

Proof files under /Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/: settings-owner-readonly-en.png, settings-owner-readonly-zh.png, claude-cli-only-zh.png and settings-owner-lost-edits.png. The last file records the final focused notice. Test tabs were closed. Both disposable directories and all four listeners from the two runs were verified removed. No real credentials, settings or production process were changed.

## Remaining boundaries

Ownership coordinates dashboard instances on a trusted local filesystem. It cannot prevent an independent editor from changing .env after its last revision check; stop the writer before external edits. Unsafe symlink/hard-linked settings disable saves. Malicious lock replacement, duplicate hostnames/shared network filesystems, power loss and Windows behavior are not certified. A failed acquisition, interrupted guard or cleanup can leave uncertain state that recovery deliberately refuses; no force deletion is implied.

Pricing metadata/cache pointers remain separate R02 scope. No broad accounting/contract suite, other Node versions, live Provider call, packaged artifact, production restart, push or release was run. The source contract harness can fetch/write source caches and remains skipped; copied routes provide bounded HTTP evidence.

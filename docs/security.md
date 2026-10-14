# Security model

[Documentation index](README.md) · [Configuration](configuration.md) · [API](api-v2.md)

## Local data and external requests

The dashboard defaults to loopback and rejects non-loopback binding without `ALLOW_REMOTE=1`. Paths are redacted server-side unless loopback `EXPOSE_FULL_PATHS=1` is explicitly set. Codex and Claude JSONL conversation content, prompts, responses, tool results, attachments, and command output never reach browser routes or exports. Provider availability never returns configured paths, and opaque session keys are provider-bound.

Static/API routes retain same-origin CSP, nosniff, traversal rejection, Host/Origin checks, body limits, and CSV formula escaping. External requests are limited to explicit GitHub release checks, provider-specific official pricing refreshes, and loopback-only login-plan usage checks against fixed official provider endpoints. They contain no session, workspace, CWD, prompt, response, or local usage data.

## Host and browser source

The common request gate validates one Host authority, its effective port and an origin-form request target before route handlers. API GET requests reject a present mismatched/null/duplicate Origin and present Sec-Fetch-Site other than same-origin or none. Missing source headers remain valid for direct local tools and native navigation. Every POST requires an exact same-origin HTTP Origin; present Fetch Metadata must be same-origin. Duplicate or conflicting source evidence is refused. Static links can open the UI under the Host gate; the UI then makes same-origin API requests. No CORS permission is added. Manual update checks use body-free POST; GET returns 405 without contacting GitHub.

Forwarded headers do not grant access or change the expected origin. Local processes can forge request headers; these checks are browser source restrictions, not user authentication. A local proxy can rewrite headers and does not prove that its visitor is local. Tunnel compatibility, proxy trust and hostile same-user-process isolation are outside this scope. Existing opt-in LAN bind and private API/full-path restrictions remain. See the [confirmed policy](archive/plans/local-host-origin-plan.md) and [isolated HTTP and desktop evidence](archive/validation/local-host-origin-validation.md).

## Credentials

Login-plan usage reads only the existing CLI credential fields required by the provider. Credentials stay server-side and never enter browser responses, diagnostics, or logs. Manual usage recheck requires same-origin validation, results are briefly cached, and remote bind mode disables the endpoint. The dashboard does not request OAuth refresh or write Claude credentials. Expired/rejected login clears former quota and requires a CLI update. File digests gate cache reuse and publication after a login replacement.

## Settings and writer ownership

Settings writes require loopback access, same-origin bounded requests, current revisions and the owned startup generation. Additional dashboard instances have read-only settings. Startup automatically recovers only a valid same-machine owner whose PID is confirmed absent, then competes for a new generation. The absence check runs again under the retirement guard. Explicit recovery retains the same guard; active, foreign, malformed, busy, permission-denied or unknown state is refused. Running readers do not take over. Retirement guards and generation checks prevent cooperating recovery from deleting a new owner. Ownership does not exclude independent editors; stop the writer before external .env edits. Shared network filesystems and malicious lock replacement are outside the verified local-filesystem boundary.

Settings require both real socket endpoints and the validated URL to be loopback. A wildcard bind can therefore use localhost/127.0.0.1/[::1] for local administration; LAN connections cannot read or save settings. Diagnostics and login-plan usage remain disabled on a non-loopback bind. Full paths still require a loopback bind.

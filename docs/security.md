# Security model

The dashboard defaults to loopback and rejects non-loopback binding without `ALLOW_REMOTE=1`. Paths are redacted server-side unless loopback `EXPOSE_FULL_PATHS=1` is explicitly set. Codex and Claude JSONL conversation content, prompts, responses, tool results, attachments, and command output never reach browser routes or exports. Provider availability never returns configured paths, and opaque session keys are provider-bound.

Static/API routes retain same-origin CSP, nosniff, traversal rejection, Host/Origin checks, body limits, and CSV formula escaping. External requests are limited to explicit GitHub release checks and provider-specific official pricing refreshes. They contain no session, workspace, CWD, prompt, or usage data.

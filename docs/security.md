# Security model

The dashboard defaults to loopback and rejects non-loopback binding without `ALLOW_REMOTE=1`. Paths are redacted server-side unless loopback `EXPOSE_FULL_PATHS=1` is explicitly set. Codex and Claude JSONL conversation content, prompts, responses, tool results, attachments, and command output never reach browser routes or exports. Provider availability never returns configured paths, and opaque session keys are provider-bound.

Static/API routes retain same-origin CSP, nosniff, traversal rejection, Host/Origin checks, body limits, and CSV formula escaping. External requests are limited to explicit GitHub release checks, provider-specific official pricing refreshes, and loopback-only login-plan usage checks against fixed official provider endpoints. They contain no session, workspace, CWD, prompt, response, or local usage data.

Login-plan usage reads only the existing CLI credential fields required by the provider. Credentials stay server-side and never enter browser responses, diagnostics, or logs. Manual refresh requires same-origin validation, results are briefly cached, and remote bind mode disables the endpoint. Claude OAuth rotation is written atomically to its credential file; a failed safe write returns an unavailable status instead of exposing or continuing with an unsaved rotated token.

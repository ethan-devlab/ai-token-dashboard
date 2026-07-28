# Repository Operating Rules

These rules are mandatory for work in this repository and override broader defaults when they conflict.

## Specifications and Safety

- Follow the documented architecture, security, API, database, frontend, and testing requirements.
- Prefer existing specifications and decisions. Do not redesign work that has already been decided.
- If documentation conflicts or is incomplete, continue with a safe, reasonable assumption and record that assumption in the final report.
- Do not weaken localhost, Service, Tray, secret-handling, or logging security requirements for convenience.
- Clearly label unfinished functionality as unsupported, disabled, or deferred to a later phase. Never use fake data to present it as complete.

## Development and Validation

- Do not use test-driven development (TDD). Implement the required change first, then add or run only the focused checks needed to validate it.
- Use the narrowest useful validation for each change. Do not run broad test suites, repeated builds, exhaustive matrices, or other high-token validation unless the user explicitly asks or the change makes that scope necessary.
- Never claim a validation passed unless it was actually run. If the environment blocks validation, report the concrete error and a Windows-local command that reproduces the check.
- Do not introduce mobile or tablet UI work. Product UI and visual QA are desktop-only unless the user explicitly changes this scope.

## Visual QA

- Never delegate visual QA to subagents or spawn visual-review agents. Perform any required visual QA directly.
- Keep visual QA desktop-only. Do not capture, test, review, or report mobile/tablet layouts.

## Phase Discipline

- Before starting development for the next phase, commit the completed work from the current phase.
- Confirm the intended phase files are staged and the commit succeeds before beginning the next phase.

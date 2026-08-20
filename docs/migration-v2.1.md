# v2.0 to v2.1 migration

The product name is now Local AI Token Dashboard. The package and repository name remain `codex-token-dashboard`.

- Existing API calls without `provider` still select Codex.
- Add `CLAUDE_SESSIONS_DIR` only when the default `~/.claude/projects` path is not correct.
- The provider dropdown stores its last selection locally. A `provider` URL parameter takes precedence.
- Existing local budgets migrate once to Codex. Claude budgets are separate.
- Claude subagent sessions are included by default and can be excluded with `executionType=main`.
- Claude cost is an Anthropic API-equivalent token estimate. It is not a Pro or Max subscription bill and excludes non-token tool fees.

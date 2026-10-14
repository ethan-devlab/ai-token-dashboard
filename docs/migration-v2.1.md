# v2.0 to v2.1 migration

The product name is now Local AI Token Dashboard. The package and repository name remain `codex-token-dashboard`.

- Existing API calls without `provider` still select Codex.
- Add `CLAUDE_SESSIONS_DIR` only when the default `~/.claude/projects` path is not correct.
- The provider dropdown stores its last selection locally. A `provider` URL parameter takes precedence.
- Existing local budgets migrate once to Codex. Claude budgets are separate.
- Claude subagent sessions are included by default and can be excluded with `executionType=main`.
- Claude cost is an Anthropic API-equivalent token estimate. It is not a Pro or Max subscription bill and excludes non-token tool fees.

## Clients using earlier v2.1 source

| Surface | Current client action |
| --- | --- |
| Update checks | Use body-free same-origin POST /api/update. GET returns 405 without checking GitHub |
| Settings | GET the current revision, then save with quoted If-Match and exact Origin. Missing versions return 428; stale versions return 409 |
| CSV readers | Count only recordType=data. Empty results retain one recordType=metadata row with blank measurements |
| Paging/detail/export | Use displayed projection and clock guards; a conflict requires a full reload and a new download action |
| Downloads | Use native prepared streaming. No fixed 32 MiB cap or Range resume is provided |
| Startup ownership | Restart can recover a verified absent same-machine owner. Running readers remain read-only; uncertain locks remain blocked |
| Application version | GET /api/providers adds version from the running package; existing providers remains unchanged |

See [API](api-v2.md), [operations](operations.md) and [security](security.md) for full semantics. These source compatibility notes do not imply that every change was published as a tagged release.

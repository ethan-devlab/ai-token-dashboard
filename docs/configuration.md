# Configuration

[Documentation index](README.md) · [Network boundaries](security.md) · [Recovery](operations.md)

`.env` is ignored by Git. `UPDATE_REPOSITORY` is read only from this file; other launch values may be temporarily overridden through the process environment. The **Settings** link opens `/settings.html`: it validates and atomically writes only the documented `.env` keys, preserves unrelated lines, and requires a dashboard restart before saved values take effect. Settings require a loopback connection and a local loopback URL. This permits local administration through `localhost`, `127.0.0.1` or `[::1]` even with a wildcard bind; remote connections cannot read or edit settings.

Settings edits stay on the current page until Save succeeds. Unsaved changes are marked. Returning to the dashboard offers **Keep editing** or **Discard and return**; browser exit/reload registers its native warning while changes are unsaved. A failed save retains edits. No draft is stored in local storage.

| Setting | Default | Notes |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Non-loopback values require `ALLOW_REMOTE=1`; remote mode has no authentication. |
| `PORT` | `3333` | 1–65535. |
| `CODEX_SESSIONS_DIR` | platform Codex sessions path | Local `.jsonl` and `.jsonl.zst` root. Compressed files count toward `MAX_FILES`. |
| `CLAUDE_SESSIONS_DIR` | `~/.claude/projects` | Local Claude Code project JSONL root. A missing directory makes Claude unavailable without preventing server startup. |
| `MAX_FILES` | `10000` | Maximum discovered session files. |
| `DETAIL_OBSERVATION_LIMIT` | `2000` | 1–100000 observations per Session detail response. Editable in Settings or `.env`. Parsing and totals remain complete. |
| `PARSE_CONCURRENCY` | `min(4, availableParallelism)` | 1–16 bounded parser workers. |
| `EXPOSE_FULL_PATHS` | `0` | Only allowed with a loopback host. |
| `AUTO_REFRESH` | `0` | Uses a debounced filesystem hint; manual refresh remains available. |
| `AUTO_REFRESH_DEBOUNCE_MS` | `1500` | Coalescing delay for the optional watcher. |
| `UPDATE_REPOSITORY` | `ethan-devlab/ai-token-dashboard` | Canonical `owner/repo` for user-triggered release checks. An explicit blank value disables checks; a custom value selects another repository. |

Month input accepts `YYYY-M` and `YYYY-MM`; the browser stores valid values as `YYYY-MM`. Model prices support name search and natural numeric version order within each naming family. This order does not indicate release dates.

Both provider directory settings expand a leading `~`, `~/`, or `~\` to the home directory of the user running Node.js. This works without shell expansion in `.env` on Windows, Linux, and macOS. Absolute paths and ordinary relative paths retain their existing behavior. Named-user expansion (`~other`), environment-variable interpolation, and a tilde inside a path are not expanded. Settings saves preserve home shorthand; expansion happens at startup. All changes require a server restart.

The default targets [ethan-devlab/ai-token-dashboard](https://github.com/ethan-devlab/ai-token-dashboard). An explicit existing .env value continues to take precedence; a blank or custom repository is not replaced automatically when upgrading.

With `ALLOW_REMOTE=1`, wildcard binds (`0.0.0.0` or `::`) accept the actual destination IP and configured port in the Host header, plus loopback aliases for loopback destinations. External domain names and forwarded headers do not grant access. Settings remain available to local loopback connections; LAN connections cannot access them. Diagnostics and login-plan APIs remain disabled with non-loopback binds; full paths require a loopback bind. HTTPS tunnel compatibility is not supported. See [wildcard local settings validation](archive/validation/wildcard-local-settings-validation.md) and [month, pricing and remote validation](archive/validation/month-pricing-remote-validation.md).

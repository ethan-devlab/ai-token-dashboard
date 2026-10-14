# Documentation

Use the topic guides for current behavior. Dated plans, audits, local incidents and test evidence are kept in the [archive](archive/README.md).

## Using the dashboard

| Guide | Answers |
| --- | --- |
| [Dashboard guide](usage.md) | Providers, periods, charts, Sessions, costs and exports |
| [Configuration](configuration.md) | Every .env setting, defaults and network access |
| [Operations and recovery](operations.md) | Restart, writer ownership, quota login and pricing repair |
| [Security model](security.md) | Local data, credentials, Host/Origin and LAN boundaries |

## Maintaining integrations

| Reference | Answers |
| --- | --- |
| [API reference](api-v2.md) | Routes, query fields, response semantics, errors and download lifecycle |
| [Architecture](architecture.md) | Server/provider/browser responsibilities and persistent storage |
| [Development and releases](development.md) | Focused checks, CI, documentation maintenance and release artifacts |
| [Status and limits](status.md) | Supported behavior, evidence coverage and known gaps |
| [v3 upgrade](migration-v3.md) | Runtime requirement, compressed history, historical estimates and nullable costs |
| [v1 to v2 migration](migration-v2.md) | Aggregation, timezone and lazy detail changes |
| [v2.0 to v2.1 migration](migration-v2.1.md) | Provider isolation and later client compatibility changes |

## Authority and history

The implementation and current references define behavior. Archived records establish what was decided or tested at a specific checkpoint; they can contain superseded policies. Read their dates and limits before using them. A packaged application version is separate from a usage snapshot or pricing-basis revision.

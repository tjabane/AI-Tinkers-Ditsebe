# Ditsebe - WhatsApp community assistant

Ditsebe captures residential WhatsApp conversations into SQLite, answers explicit questions using recent group context, and imports older conversations into a separate archive for review.

## Documentation

- [Solution and architecture](docs/solution.md): problem, capabilities, components, storage, and limitations.
- [Data flow](docs/data-flow.md): diagrams for capture, LLM replies, manual sends, imports, and privacy boundaries.
- [Operations and API reference](docs/operations.md): setup, configuration, commands, routes, and troubleshooting.

## Quick start

Requires Bun. Run from the repository root:

```powershell
bun install
Copy-Item .env.example .env
bun run start
```

Copy the environment file only if creating a new configuration. When `pairing_required` appears, open `.wa-auth/pairing-qr.png` and scan it using WhatsApp's linked-device flow. Credentials persist across restarts. The Baileys integration is an unofficial WhatsApp Web client; use a spare account for the demo.

Open http://localhost:3000/health for status and http://localhost:3000/archive for imported history. The API binds to localhost and has no authentication.

For generated replies, set `OPENAI_API_KEY` and `AGENT_GROUP_ID` in `.env`, restart, and send from another account in that group:

```text
!ditsebe What has the group discussed?
```

Capture and manual sends work without an API key. Imported archives are separate from the assistant's recent live-message context.

## Current features

- Live normalization, SQLite persistence, reconnect handling, and optional redacted webhooks.
- Explicit group questions with serialized LLM replies and replay suppression.
- Local API for reads, group sends, quoted replies, and manual private follow-ups.
- History/export archive imports, local image OCR, PDF extraction, coverage reports, and source-linked review annotations.
- Best-effort redaction and structured runtime diagnostics.

Provider registration, bookings, live web search, automatic lead creation, and autonomous private follow-ups are not implemented.

## Workspaces and checks

| Workspace | Responsibility |
| --- | --- |
| `packages/whatsapp` | Connection, normalization, history requests, media download, sending. |
| `packages/api` | SQLite, redaction, HTTP API, archive reports/viewer. |
| `packages/agent` | Application wiring, sinks, LLM orchestration, imports. |

```powershell
bun run dev
bun run start:api
bun run typecheck
bun test packages/agent/tests packages/api/tests
```

Run full app and API-only mode separately because they share a port. Original messages, imported files, and credentials remain sensitive local data. SQLite is not encrypted and redaction is best effort; tell participants what the application captures before community use.

Later service requests in the demo group now receive a quoted recommendation
from stored cases in that same group. Private feedback is included only after
the author replies YES to a separate permission question. NO keeps it private.
Permission questions and recommendation sends have persistent duplicate guards.
Prior group recommendations may still be shared without private feedback.

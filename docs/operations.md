# Operations and API reference

## Setup

Run from the repository root with Bun installed:

```powershell
bun install
Copy-Item .env.example .env
bun run start
```

Copy `.env.example` only when creating a new configuration. On `pairing_required`, open `.wa-auth/pairing-qr.png` and scan it with WhatsApp's linked-device flow. Credentials persist across restarts. Baileys is an unofficial WhatsApp Web client; use a spare account for the demo.

Open http://localhost:3000/health for status and http://localhost:3000/archive for archived imports. Configure an API key and the target group, restart, and send `!ditsebe What has the group discussed?` from another account in that group. Capture and manual sends work without an API key.

| Command | Purpose |
| --- | --- |
| `bun run start` / `bun run dev` | Full app, normal / watch mode. |
| `bun run start:api` / `bun run dev:api` | Stored-data API without WhatsApp or LLM. |
| `bun run echo` | Development webhook receiver. |
| `bun run import:export "path/to/_chat.txt" "Group name" DMY` | Import an extracted export; use `MDY` for month-first dates. |
| `bun run typecheck` | TypeScript check. |
| `bun test packages/agent/tests packages/api/tests` | Offline tests. |
| `bun run test:llm` | Live provider smoke script; makes an external request. |

Run API-only mode and the full app separately because they share a port.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port; host is fixed to `127.0.0.1`. |
| `DB_PATH` | `./data/messages.db` | SQLite file. |
| `WA_AUTH_DIR` | `./.wa-auth` | Credentials and pairing QR. |
| `GROUPS_ONLY` | `true` | Filter direct messages, with the manual-follow-up exception described in the data-flow guide. |
| `CAPTURE_OWN` | `false` | Capture linked-account messages; assistant replies are explicitly saved too. |
| `WEBHOOK_URL` | Empty | Optional redacted live-message receiver. |
| `WEBHOOK_TOKEN` | Empty | Optional receiver bearer token. |
| `OPENAI_API_KEY` | Empty | Required for generated replies. |
| `OPENAI_MODEL` | `gpt-5.5` | Model name configured by this implementation. |
| `LLM_ENABLED` | `true` | Enable assistant when a key is present. |
| `AGENT_GROUP_ID` | `120363431475712196@g.us` | Assistant group and manual group-send destination. |

Boolean values use the literal string `true`. Protect credentials and imported community data.

## HTTP API

Base URL: `http://localhost:3000`. The API is unauthenticated and binds to localhost. JSON requests use `Content-Type: application/json`.

| Method and route | Contract |
| --- | --- |
| `GET /health` | Liveness, live counts, uptime, WhatsApp state, LLM flags/latest request, latest import summary. |
| `GET /chats` | Pseudonymous chat IDs, filtered names, counts, and last activity. |
| `GET /messages` | Optional `chatId`, `limit` (default 50, capped at 500), `since` (inclusive epoch milliseconds). Newest first; chat filter accepts returned aliases or internal IDs. |
| `POST /messages/send` | `text`, optional `quotedMessageId`; sends to configured group. |
| `POST /messages/private` | `text`, `sourceMessageId`; sends to original author of a stored message in configured group. |
| `GET /archive` | Archive HTML viewer. |
| `GET /imports` | Import reports with counts, dates, duplicates, types, attachment outcomes, and review counts. |
| `POST /imports` | `groupName`; case-insensitive exact unique group name. Starts or returns selected history import. |
| `POST /imports/continue` | `id`; requests next page using oldest usable archive anchor. |
| `GET /archive/messages` | `runId`, optional nonnegative integer `offset` and `disposition`; up to 100 rows, oldest first. |

Dispositions are `useful`, `context`, `needs_review`, `low_value`, and `unreviewed`. Annotation writes are available through local `markArchive()` code, not an HTTP endpoint.

Send text must be nonblank and at most 10,000 characters. Sends return 201 on success, 400 for invalid input, 404 for missing source/quote, 503 for unavailable transport, or 502 on send failure. A 201 is not a delivery receipt; check WhatsApp before retrying uncertain sends.

Imports return 202 when accepted, not when complete. Input errors can return 400, unavailable callbacks 503, and conflicts/failures 409. Read `/imports` for outcomes. Unknown routes return 404 and unsupported methods 405.

## Examples

POST examples perform real sends/imports if executed against the full app.

```powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/chats
Invoke-RestMethod -Method Post -Uri http://localhost:3000/messages/send -ContentType 'application/json' -Body '{"text":"Hello from Ditsebe"}'
Invoke-RestMethod -Method Post -Uri http://localhost:3000/messages/private -ContentType 'application/json' -Body '{"text":"May I ask about your recommendation?","sourceMessageId":"SOURCE_MESSAGE_ID"}'
Invoke-RestMethod -Method Post -Uri http://localhost:3000/imports -ContentType 'application/json' -Body '{"groupName":"Manhattan Heights"}'
Invoke-RestMethod -Method Post -Uri http://localhost:3000/imports/continue -ContentType 'application/json' -Body '{"id":"RUN_ID"}'
```

To quote a group message, add `quotedMessageId` to `/messages/send` JSON.

## Review and troubleshooting

After importing, select the run in `/archive`. Compare date coverage and counts with expectations; inspect duplicates, skipped records, and extraction statuses. Review source context before relying on annotations. Importing never automatically publishes, replies, or creates leads.

| Symptom | Check |
| --- | --- |
| Healthy API but no WhatsApp | `ok` means API liveness only; inspect `whatsapp.connected` and pairing events. |
| No assistant reply | Check LLM enabled/configured/active flags, target group, command prefix, and sender account. |
| Generation failure | Inspect phase/status and `llm.last_request`; submit a new question after resolving the issue. |
| Waiting for anchor | Keep connected until a message arrives in the selected group, or import an export. |
| Partial/no history | Inspect coverage, request another page, or use an export. Completeness is not guaranteed. |
| Attachment failure | Check supported type/size and include media in exports. WhatsApp attachments can expire. |
| Port conflict | Run full/API-only modes separately or configure another port. |
| Webhook failure | Check receiver/token. No automatic retries are implemented. |

Logs are JSON lines with safe status/timing fields and process-local references. `/health` reports a null last LLM request until one runs in the current process.

Original data is unencrypted and redaction is best effort. Tell community participants what is captured. Use a SQLite-consistent backup procedure and protect imported files and pairing credentials. The database salt determines stable aliases. Automated retention, encryption, remote authentication, and backup scheduling are not implemented.

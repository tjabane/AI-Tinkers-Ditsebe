# hack.ditsebe — WhatsApp group capture agent

An agent that sits in WhatsApp groups (estate, complex, neighbourhood) and captures
every message into a database and/or a REST endpoint.

**Phase 1 (built):** read all group messages → SQLite + webhook → readable REST API.
**Phase 2 (next):** an LLM reads the captured messages and replies in the group or DMs
individuals. The seam for this is `fanOut()` in `src/sinks.ts` — a reply handler is just
another sink.

## Run it

```sh
bun install
bun run dev
```

Scan the QR with the WhatsApp account the agent should use (a spare number, not your
personal one — this is a full WhatsApp Web session). Pairing is saved to `.wa-auth/`,
so restarts do not ask again. Then add that account to a group and talk in it: every
message is printed, stored and pushed.

## Configuration

Copy `.env.example` to `.env`. Everything has a working default; the only one you are
likely to set is `WEBHOOK_URL`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEBHOOK_URL` | _(none)_ | POST every message here as JSON. Blank = SQLite only. |
| `WEBHOOK_TOKEN` | _(none)_ | Sent as `Authorization: Bearer …`. |
| `DB_PATH` | `./data/messages.db` | SQLite file. |
| `WA_AUTH_DIR` | `./.wa-auth` | Pairing credentials. Delete to re-pair. |
| `PORT` | `3000` | Local read API. |
| `GROUPS_ONLY` | `true` | Ignore direct messages. |
| `CAPTURE_OWN` | `false` | Also capture the agent's own outgoing messages. |

## Read API

| Route | Description |
| --- | --- |
| `GET /health` | Liveness plus message/chat/sender counts. |
| `GET /chats` | Every group seen, with message counts and last activity. |
| `GET /messages?chatId=&limit=&since=` | Captured messages, newest first. |

`since` is epoch milliseconds, `limit` caps at 500.

## Webhook payload

```json
{
  "id": "3EB0…",
  "chatId": "27831234567-1600000000@g.us",
  "chatName": "Ditsebe Estate",
  "isGroup": true,
  "senderId": "27831234567@s.whatsapp.net",
  "senderName": "Thabo",
  "fromMe": false,
  "type": "conversation",
  "text": "Anyone else's water off?",
  "quotedMessageId": null,
  "timestamp": 1757664000000
}
```

To see this without a backend, run the echo receiver in a second terminal:

```sh
bun run echo
# then, in the first terminal:
WEBHOOK_URL=http://localhost:4000/hook bun run dev
```

## Layout

| File | Role |
| --- | --- |
| `src/wa.ts` | Baileys socket: pairing, reconnect, group names, message events. |
| `src/normalize.ts` | Flattens a Baileys message into a `CapturedMessage`. |
| `src/sinks.ts` | Fan-out to SQLite, console and webhook. Add sinks here. |
| `src/db.ts` | Schema and queries. |
| `src/api.ts` | Read-only REST API. |

## Notes

- The full Baileys payload is kept in the `raw` column, so fields not parsed yet can be
  backfilled without recapturing.
- Messages are keyed on `(chat_id, id)`, so replays and reconnects do not duplicate rows.
- Webhook failures are logged but never block capture.
- Media is recorded by type and caption; the binaries are not downloaded.
- People in these groups have not consented to a bot logging them — for anything beyond
  the demo, tell the group the agent is there and what it keeps.

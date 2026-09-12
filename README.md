# hack.ditsebe — WhatsApp group agent

A WhatsApp agent that joins residential group chats — estate, complex and
neighbourhood groups — and turns them into structured, queryable data, so that
software can eventually take part in the conversation.

## The problem

A neighbourhood WhatsApp group is where a community actually coordinates: a burst
water pipe, a suspicious car on the corner, load-shedding times, a levy dispute, a
plumber somebody can vouch for. All of it is real, useful, local knowledge — and all
of it is trapped in an unsearchable scroll of messages on individual phones. Nobody
can query it, nothing is tracked to resolution, and the same three questions get
asked every week.

## The approach

The agent is a WhatsApp account like any other. You add it to a group and, from that
moment, it sees everything the group sees. It connects through
[Baileys](https://github.com/WhiskeySockets/Baileys), which speaks the WhatsApp Web
protocol directly — no Business API, no per-message fees, no approved template
messages, and it works with ordinary community groups rather than only with numbers
that have messaged a business first.

That choice is what makes the project possible in a hackathon, and it is also the main
caveat: this is an unofficial client, so it belongs on a spare number, not a personal
or business-critical one.

## Phases

### Phase 1 — capture *(built)*

Get every group message out of WhatsApp and into somewhere queryable. This is the
foundation: an LLM can only be useful about a group it has read.

- Pairs to a WhatsApp account by QR and keeps the session across restarts
- Listens to every message in every group the account belongs to
- Flattens each one — group, sender, text, media type, reply-to, timestamp — into a
  single record, keeping the raw payload alongside it
- Writes to SQLite and, optionally, POSTs to any REST endpoint
- Serves a read-only API over the store

Deliberately not in scope: downloading media binaries, and backfilling months of
history on connect. Capture starts when the agent joins the group.

### Phase 2 — respond *(next)*

An LLM reads the captured conversation and takes part in it:

- **In the group** — answers questions the group has already answered before, surfaces
  the relevant earlier thread, summarises what was decided
- **Individually** — messages a specific resident directly, for anything that should
  not be said in front of forty neighbours

The seam is already in place. `fanOut()` in `packages/agent/src/sinks.ts` hands every captured message
to a list of sinks; a reply handler is just another sink, with `sock.sendMessage()` for
the outbound half. What phase 2 adds on top is the judgement: deciding when the agent
should speak at all, and pulling the right slice of history into the prompt.

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

This Bun monorepo contains three workspaces:

| Workspace | Responsibility |
| --- | --- |
| `packages/whatsapp` | Pairing, reconnect, normalization and captured-message types. Delivers messages through an injected callback. |
| `packages/api` | SQLite storage, queries and the read-only HTTP API. |
| `packages/agent` | Coordinates WhatsApp, API, storage, console and webhook sinks. Future response logic belongs here. |

The agent imports `@ditsebe/api` and `@ditsebe/whatsapp` using workspace dependencies.
The API imports only the captured-message type from WhatsApp. WhatsApp does not depend on the API or agent.

Run from the repository root so the root `.env`, `data/` and `.wa-auth/` continue to work:

```sh
bun run dev          # full app, watch mode
bun run start        # full app
bun run start:api    # API only, without WhatsApp pairing
bun run dev:api      # API only, watch mode
bun run typecheck    # all workspaces
bun run echo         # development webhook receiver
```

Workspace start/dev scripts also launch from the repository root. Run the standalone
API and full app separately, since both use the same port. LLM responses remain future work.

## Notes

- The full Baileys payload is kept in the `raw` column, so fields not parsed yet can be
  backfilled without recapturing.
- Messages are keyed on `(chat_id, id)`, so replays and reconnects do not duplicate rows.
- Webhook failures are logged but never block capture.
- Media is recorded by type and caption; the binaries are not downloaded.
- People in these groups have not consented to a bot logging them — for anything beyond
  the demo, tell the group the agent is there and what it keeps.

## Send to Hackathon dev test

With the full app running and WhatsApp connected, post text to the local API.
The destination is fixed to Hackathon dev test (`120363431475712196@g.us`).

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/messages/send -ContentType 'application/json' -Body '{"text":"Hello from Ditsebe"}'
```

A successful response is HTTP 201 with the WhatsApp message ID and chat ID; it
is not a recipient delivery receipt. Invalid input returns 400, disconnected or
API-only mode returns 503, and send failures return 502. Check the group before
retrying a failed request to avoid duplicate messages. Outgoing capture still
depends on CAPTURE_OWN.

To reply to a captured message, include `quotedMessageId` alongside `text` in the
POST body. The message must exist in the target group; otherwise the API returns 404.

## LLM group assistant

Set OPENAI_API_KEY in the root .env and restart with bun run start.
OPENAI_MODEL defaults to gpt-5.5 and can be changed. LLM_ENABLED=false disables replies.
AGENT_GROUP_ID defaults to Hackathon dev test and also sets the manual send destination.

From another WhatsApp account, send: `!ditsebe What has the group discussed?`
The agent uses up to 40 recent messages from that group and sends a quoted reply.
Replies are saved even when CAPTURE_OWN=false, so follow-up questions have context.
Ordinary messages and messages from the linked account do not trigger the LLM.
The API key is required only for LLM replies; capture and manual sends work without it.

Requests have a 45-second timeout. Failures are logged and not automatically resent;
send a new question to retry. Replies are serialized and replayed message IDs are
skipped. A crash between sending and saving can still cause a duplicate on replay.
Private follow-ups, provider registration, live web search and service workflows are
not implemented yet. Run `bun test packages/agent/tests packages/api/tests` for offline checks.

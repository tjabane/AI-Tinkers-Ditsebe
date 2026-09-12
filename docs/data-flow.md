# Data flow

## Live capture

```mermaid
flowchart TD
    W[WhatsApp event] --> T{Live notify?}
    T -- No --> H[Selected archive history queue]
    T -- Yes --> N[Normalize message]
    N --> F{Pass capture filters?}
    F -- No --> X[Ignore]
    F -- Yes --> S[Enqueue staging if selected import group]
    S --> P[Await sink fan-out]
    P --> DB[(Live messages)]
    P --> LOG[Structured log]
    P --> WH[Optional redacted webhook]
    P --> A[Enqueue eligible assistant question]
```

Normalization drops status broadcasts and protocol noise, extracts text/captions and quote IDs, and converts timestamps to milliseconds. Internal records contain `id`, `chatId`, `chatName`, `isGroup`, `senderId`, `senderName`, `fromMe`, `type`, `text`, `quotedMessageId`, `timestamp`, and `raw`.

`GROUPS_ONLY=true` excludes direct messages except incoming replies from recipients contacted through manual private sending in the current process. `CAPTURE_OWN=false` excludes linked-account messages. Sink handlers run concurrently with individual error handling; the callback awaits their completion before invoking the assistant.

The webhook receives a reduced payload, illustrated below. It excludes raw payloads and original chat/sender identifiers; an optional bearer token authenticates the POST.

```json
{
  "id": "example-message-id",
  "chat": "Group-a1b2c3d4e5f6",
  "sender": "Resident-123456abcdef",
  "text": "The water is back on.",
  "timestamp": 1789200000000,
  "type": "conversation"
}
```

## Group question and reply

```mermaid
sequenceDiagram
    participant R as Resident
    participant W as WhatsApp adapter
    participant A as Assistant queue
    participant D as SQLite live messages
    participant L as OpenAI
    R->>W: !ditsebe question
    W->>D: Save through capture sink
    W->>A: Check group, sender, trigger, replay
    A->>D: Read latest 40 messages
    D-->>A: Newest-first rows
    A->>A: Exclude current question, reverse, redact
    A->>L: Instructions, question, history
    L-->>A: Generated answer
    A->>A: Validate and redact output
    A->>W: Send quoted reply
    W-->>A: Sent ID
    A->>D: Save reply with source question link
```

Only incoming `!ditsebe` commands in `AGENT_GROUP_ID` qualify. A bare command returns usage text without a model call when the assistant is enabled. The assistant requires `LLM_ENABLED=true` and an API key.

Context is read when the queued job starts: up to 40 rows, excluding the current question, then reversed into chronological order. This may leave 39 rows and can include messages received while the question waited. Archive records and attachment extraction results are not included.

History text is capped at 2,000 characters per message and the question at 6,000. Sender labels are pseudonymous; phone/contact patterns are filtered. Timestamps, message IDs, and quote links accompany the text. The Responses request uses `store: false`, a 45-second timeout, zero SDK retries, and a 2,000-token output limit. This is request configuration, not a blanket provider-retention guarantee.

A completed, nonempty answer is capped at 10,000 characters and redacted before sending. The reply is saved directly even with own-message capture disabled. That direct save does not invoke webhook fan-out. Failures are logged by phase without stopping later jobs, and sends are not automatically retried.

## Manual sending

```mermaid
flowchart LR
    O[Local operator] --> API[Validate request]
    API --> G[Configured group]
    API --> P[Resolve source-message author]
    D[(Stored raw message)] --> P
    D --> Q[Optional quote context]
    Q --> G
    G --> W[WhatsApp send]
    P --> W
    W --> R[Return sent ID or failure]
```

`POST /messages/send` sends to the configured group with optional quote context. `POST /messages/private` resolves `sourceMessageId` in that group's live store and derives the recipient from the original participant field. Neither route accepts an arbitrary destination.

Private sending registers the recipient in memory so subsequent incoming direct messages can pass the group-only capture filter until restart. These messages can be stored and webhooked but do not trigger the group assistant. Manual sends are not explicitly saved by the API; outgoing capture depends on adapter events and filters. A successful send response is not a recipient delivery receipt.

## Archive imports

```mermaid
flowchart TD
    B[Start history import] --> G[Resolve unique group and create run]
    G --> L[Seed from stored live messages]
    L --> A{Anchor available?}
    A -- No --> WAIT[Wait for incoming message]
    WAIT --> REQ[Request up to 100 older messages]
    A -- Yes --> REQ
    REQ --> H[History events for selected group]
    E[Export text and media] --> PARSE[Parse dates and fingerprint records]
    H --> ST[Deduplicate and stage]
    PARSE --> ST
    ST --> M[Download or copy attachments]
    M --> OCR[Local PDF extraction / image OCR]
    OCR --> DB[(Archive tables and files)]
    ST --> DB
    DB --> UI[Redacted viewer and coverage reports]
    UI --> CONT[Operator requests another page]
    CONT --> REQ
```

History events only enter archive processing. Live messages for the selected group are also staged while continuing through normal capture. Import processing does not call the assistant, send replies, or invoke webhooks.

Continuation uses the oldest staged record with a usable WhatsApp key. Repeated anchors are suppressed in memory. After 45 seconds without a response, the run can report `no_history_received`; late history can still arrive. Coverage is always subject to review.

The export CLI preserves the original text, parses English Android/iOS formats with explicit `DMY` or `MDY` dates and UTC+02:00, and fingerprints messages for repeat-import deduplication. Exports do not preserve reliable reply IDs or own-message identity. Attachment paths must resolve inside the export directory.

Files are limited to 25 MB. Images use local English OCR. PDFs use text extraction with OCR for empty-text pages, up to 100 pages. OCR assets may download on first use. Statuses distinguish pending, downloaded, extracted, partial, missing, unsupported, and failed outcomes. Counts and extraction success do not prove complete coverage or accurate OCR.

Review annotations retain source messages. `useful` means worth retaining, not verified/current, and does not activate any workflow.

## Privacy boundaries

| Destination | Data |
| --- | --- |
| Local database/files | Original identifiers, text and raw payloads; imported media, extracted text, and pseudonym salt. |
| HTTP reads | Pseudonymous group/sender labels and filtered text. Raw payloads and attachments are not served. Group-send success still returns the actual destination chat ID. |
| OpenAI | Redacted question and recent live context, pseudonyms, timestamps, message IDs, and quote links. |
| Webhook | Reduced redacted live-message record shown above. |
| Logs | UTC time, event, safe counts/status/timing, and process-local anonymous references. No message bodies, raw payloads, exception text, or secrets. |
| WhatsApp outbound | Redacted generated answer or manually supplied text. Manual text is sent as supplied. |

Stable aliases use HMAC with a database-stored salt; log references use a separate per-process salt. Filtering targets phone-like values, WhatsApp identifiers, and contact links. Names in prose, addresses, OCR errors, and unusual formats can remain identifying. Redaction does not encrypt stored originals.

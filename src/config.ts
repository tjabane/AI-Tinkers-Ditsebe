export const config = {
  /** Where Baileys persists its pairing credentials. Delete this folder to re-pair. */
  authDir: process.env.WA_AUTH_DIR ?? "./.wa-auth",
  /** SQLite file holding the captured messages. */
  dbPath: process.env.DB_PATH ?? "./data/messages.db",
  /** Optional REST endpoint every captured message is POSTed to. */
  webhookUrl: process.env.WEBHOOK_URL ?? "",
  webhookToken: process.env.WEBHOOK_TOKEN ?? "",
  /** Port for the local read API. */
  apiPort: Number(process.env.PORT ?? 3000),
  /** Only capture group chats (ignore DMs). */
  groupsOnly: (process.env.GROUPS_ONLY ?? "true") === "true",
  /** Capture our own outgoing messages too. */
  captureOwn: (process.env.CAPTURE_OWN ?? "false") === "true",
};

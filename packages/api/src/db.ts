import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "./config.ts";
import type { CapturedMessage } from "@ditsebe/whatsapp";

if (config.dbPath !== ":memory:") {
  mkdirSync(dirname(resolve(config.dbPath)), { recursive: true });
}

export const db = new Database(config.dbPath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    chat_name TEXT,
    is_group INTEGER NOT NULL,
    sender_id TEXT,
    sender_name TEXT,
    from_me INTEGER NOT NULL,
    type TEXT NOT NULL,
    text TEXT,
    quoted_message_id TEXT,
    timestamp INTEGER NOT NULL,
    raw TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, timestamp DESC);
`);

const insert = db.query(`
  INSERT INTO messages (
    id, chat_id, chat_name, is_group, sender_id, sender_name,
    from_me, type, text, quoted_message_id, timestamp, raw, captured_at
  ) VALUES (
    $id, $chatId, $chatName, $isGroup, $senderId, $senderName,
    $fromMe, $type, $text, $quotedMessageId, $timestamp, $raw, $capturedAt
  )
  ON CONFLICT (chat_id, id) DO UPDATE SET
    chat_name = COALESCE(excluded.chat_name, messages.chat_name),
    sender_name = COALESCE(excluded.sender_name, messages.sender_name),
    text = COALESCE(excluded.text, messages.text)
`);

export function saveMessage(msg: CapturedMessage): void {
  insert.run({
    $id: msg.id,
    $chatId: msg.chatId,
    $chatName: msg.chatName,
    $isGroup: msg.isGroup ? 1 : 0,
    $senderId: msg.senderId,
    $senderName: msg.senderName,
    $fromMe: msg.fromMe ? 1 : 0,
    $type: msg.type,
    $text: msg.text,
    $quotedMessageId: msg.quotedMessageId,
    $timestamp: msg.timestamp,
    $raw: JSON.stringify(msg.raw),
    $capturedAt: Date.now(),
  });
}

export type MessageRow = {
  id: string;
  chat_id: string;
  chat_name: string | null;
  is_group: number;
  sender_id: string | null;
  sender_name: string | null;
  from_me: number;
  type: string;
  text: string | null;
  quoted_message_id: string | null;
  timestamp: number;
};

const COLUMNS =
  "id, chat_id, chat_name, is_group, sender_id, sender_name, from_me, type, text, quoted_message_id, timestamp";

export function listMessages(opts: { chatId?: string; limit: number; since?: number }): MessageRow[] {
  const clauses: string[] = [];
  const params: Record<string, string | number> = { $limit: opts.limit };
  if (opts.chatId) {
    clauses.push("chat_id = $chatId");
    params.$chatId = opts.chatId;
  }
  if (opts.since !== undefined) {
    clauses.push("timestamp >= $since");
    params.$since = opts.since;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .query(`SELECT ${COLUMNS} FROM messages ${where} ORDER BY timestamp DESC LIMIT $limit`)
    .all(params) as MessageRow[];
}

export function listChats(): Array<{
  chat_id: string;
  chat_name: string | null;
  is_group: number;
  message_count: number;
  last_message_at: number;
}> {
  return db
    .query(`
      SELECT chat_id, chat_name, is_group,
             COUNT(*) AS message_count,
             MAX(timestamp) AS last_message_at
      FROM messages
      GROUP BY chat_id
      ORDER BY last_message_at DESC
    `)
    .all() as never;
}

export function stats() {
  const row = db
    .query(
      "SELECT COUNT(*) AS messages, COUNT(DISTINCT chat_id) AS chats, COUNT(DISTINCT sender_id) AS senders FROM messages",
    )
    .get() as { messages: number; chats: number; senders: number };
  return row;
}

/** Retrieve the original payload to preserve WhatsApp reply context. */
export function getRawMessage(chatId: string, id: string) {
  const row = db.query("SELECT raw FROM messages WHERE chat_id = ? AND id = ?").get(chatId, id) as { raw: string } | null;
  return row ? JSON.parse(row.raw) : null;
}

export function hasReply(chatId: string, messageId: string): boolean {
  return db.query("SELECT 1 FROM messages WHERE chat_id = ? AND quoted_message_id = ? AND from_me = 1 LIMIT 1").get(chatId, messageId) !== null;
}

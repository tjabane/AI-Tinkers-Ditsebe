import { log, logRef } from "@ditsebe/whatsapp/logging";
import { db } from "./db.ts";
import { privateAlias, redact } from "./privacy.ts";
import type { CapturedMessage } from "@ditsebe/whatsapp";

db.exec(`
CREATE TABLE IF NOT EXISTS import_runs (
 id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, chat_name TEXT NOT NULL,
 source TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
 received INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0,
 skipped INTEGER NOT NULL DEFAULT 0, note TEXT
);
CREATE TABLE IF NOT EXISTS archive_messages (
 chat_id TEXT NOT NULL, id TEXT NOT NULL, sender TEXT NOT NULL,
 timestamp INTEGER NOT NULL, type TEXT NOT NULL, text TEXT, quoted_id TEXT,
 raw TEXT NOT NULL, attachment_path TEXT, attachment_status TEXT NOT NULL DEFAULT 'none',
 extracted_text TEXT, PRIMARY KEY(chat_id,id)
);
CREATE TABLE IF NOT EXISTS import_items (
 run_id TEXT NOT NULL, chat_id TEXT NOT NULL, message_id TEXT NOT NULL,
 PRIMARY KEY(run_id,chat_id,message_id)
);
CREATE TABLE IF NOT EXISTS archive_reviews (
 chat_id TEXT NOT NULL, message_id TEXT NOT NULL,
 disposition TEXT NOT NULL, category TEXT NOT NULL, topic TEXT NOT NULL,
 summary TEXT NOT NULL, caveat TEXT NOT NULL, reviewed_at INTEGER NOT NULL,
 PRIMARY KEY(chat_id,message_id)
);
`);

export type ArchiveReview = {
  messageId: string;
  disposition: "useful" | "context" | "needs_review" | "low_value";
  category: string;
  topic: string;
  summary: string;
  caveat: string;
};

/** Review annotations do not modify source messages or enable agent actions. */
export function markArchive(runId: string, reviews: ArchiveReview[]) {
  db.transaction(() => {
    for (const review of reviews) {
      if (!["useful", "context", "needs_review", "low_value"].includes(review.disposition)) throw new Error("Invalid review disposition");
      const source = db.query("SELECT chat_id FROM import_items WHERE run_id=? AND message_id=?").get(runId, review.messageId) as { chat_id: string } | null;
      if (!source) throw new Error("Review source is not in this import");
      db.query(`INSERT INTO archive_reviews VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(chat_id,message_id) DO UPDATE SET disposition=excluded.disposition,
        category=excluded.category,topic=excluded.topic,summary=excluded.summary,
        caveat=excluded.caveat,reviewed_at=excluded.reviewed_at`)
        .run(source.chat_id, review.messageId, review.disposition, redact(review.category),
          redact(review.topic), redact(review.summary), redact(review.caveat), Date.now());
    }
  })();
}

export function createImport(chatId: string, chatName: string, source: string): string {
  const id = crypto.randomUUID();
  db.query("INSERT INTO import_runs(id,chat_id,chat_name,source,status,created_at) VALUES(?,?,?,?,?,?)")
    .run(id, chatId, chatName, source, "staging", Date.now());
  return id;
}
export function updateImport(id: string, status: string, note: string | null = null) {
  db.query("UPDATE import_runs SET status=?,note=? WHERE id=?").run(status, note, id);
  const counts = db.query("SELECT received,duplicates FROM import_runs WHERE id=?").get(id) as { received: number; duplicates: number } | null;
  log(/failed|no_history/.test(status) ? "WARN" : "INFO", "import", "status_changed", { ref: logRef(id), status, count: counts?.received, duplicates: counts?.duplicates });
}
export function skipImport(id: string, count = 1) {
  db.query("UPDATE import_runs SET skipped=skipped+? WHERE id=?").run(count, id);
}
export function stageMessage(runId: string, msg: CapturedMessage): boolean {
  return db.transaction(() => {
    const run = db.query("SELECT chat_id FROM import_runs WHERE id=?").get(runId) as { chat_id: string } | null;
    if (!run || run.chat_id !== msg.chatId) throw new Error("Import group mismatch");
    const result = db.query(`INSERT OR IGNORE INTO archive_messages
      (chat_id,id,sender,timestamp,type,text,quoted_id,raw) VALUES(?,?,?,?,?,?,?,?)`)
      .run(msg.chatId, msg.id, privateAlias(msg.chatId + ":" + (msg.senderId ?? msg.senderName ?? "unknown")),
        msg.timestamp, msg.type, msg.text, msg.quotedMessageId, JSON.stringify(msg.raw));
    db.query("INSERT OR IGNORE INTO import_items VALUES(?,?,?)").run(runId, msg.chatId, msg.id);
    db.query("UPDATE import_runs SET received=received+1,duplicates=duplicates+? WHERE id=?")
      .run(result.changes ? 0 : 1, runId);
    return result.changes > 0;
  })();
}
export function setAttachment(chatId: string, id: string, status: string, path: string | null = null, text: string | null = null) {
  if (status !== "pending" && status !== "downloaded") log(/failed|missing|needs_ocr/.test(status) ? "WARN" : "INFO", "import", "attachment_processed", { ref: logRef(chatId + id), status });
  db.query("UPDATE archive_messages SET attachment_status=?,attachment_path=?,extracted_text=? WHERE chat_id=? AND id=?")
    .run(status, path, text, chatId, id);
}
export function importReport() {
  const runs = db.query(`SELECT r.*, COUNT(i.message_id) AS messages,
    MIN(m.timestamp) AS first_message, MAX(m.timestamp) AS last_message
    FROM import_runs r LEFT JOIN import_items i ON i.run_id=r.id
    LEFT JOIN archive_messages m ON m.chat_id=i.chat_id AND m.id=i.message_id
    GROUP BY r.id ORDER BY r.created_at DESC`).all() as Array<Record<string, any>>;
  return runs.map(({ chat_id, chat_name, ...run }) => ({ ...run, id: String(run.id), status: String(run.status), messages: Number(run.messages), duplicates: Number(run.duplicates),
    chat: privateAlias(chat_id, "Group"), name: redact(chat_name),
    note: run.note ? redact(run.note) : null,
    attachments: db.query(`SELECT m.attachment_status AS status,COUNT(*) AS count
      FROM archive_messages m JOIN import_items i ON i.chat_id=m.chat_id AND i.message_id=m.id
      WHERE i.run_id=? GROUP BY m.attachment_status`).all(run.id),
    types: db.query(`SELECT m.type,COUNT(*) AS count FROM archive_messages m
      JOIN import_items i ON i.chat_id=m.chat_id AND i.message_id=m.id WHERE i.run_id=? GROUP BY m.type`).all(run.id),
    review: db.query(`SELECT COALESCE(r.disposition,'unreviewed') AS disposition,COUNT(*) AS count
      FROM import_items i LEFT JOIN archive_reviews r ON r.chat_id=i.chat_id AND r.message_id=i.message_id
      WHERE i.run_id=? GROUP BY COALESCE(r.disposition,'unreviewed')`).all(run.id),
  }));
}
export function archiveMessages(runId: string, limit = 100, offset = 0, disposition?: string): Array<Record<string, any>> {
  const rows = db.query(`SELECT m.id,m.sender,m.timestamp,m.type,m.text,m.quoted_id,m.attachment_status,m.extracted_text,
    COALESCE(r.disposition,'unreviewed') AS disposition,r.category,r.topic,r.summary,r.caveat,r.reviewed_at
    FROM archive_messages m JOIN import_items i ON i.chat_id=m.chat_id AND i.message_id=m.id
    LEFT JOIN archive_reviews r ON r.chat_id=m.chat_id AND r.message_id=m.id
    WHERE i.run_id=? AND (? IS NULL OR COALESCE(r.disposition,'unreviewed')=?)
    ORDER BY m.timestamp,m.id LIMIT ? OFFSET ?`).all(runId, disposition ?? null, disposition ?? null, limit, offset) as Array<Record<string, any>>;
  return rows.map(row => ({ ...row, text: row.text === null ? null : redact(row.text),
    extracted_text: row.extracted_text === null ? null : redact(row.extracted_text) }));
}

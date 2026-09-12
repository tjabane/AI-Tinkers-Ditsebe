import { createHmac, randomBytes } from "node:crypto";
import { db } from "./db.ts";

db.exec("CREATE TABLE IF NOT EXISTS private_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
db.query("INSERT OR IGNORE INTO private_settings VALUES ('redaction_salt', ?)").run(randomBytes(32).toString("hex"));
const salt = (db.query("SELECT value FROM private_settings WHERE key = 'redaction_salt'").get() as { value: string }).value;

export function privateAlias(value: string, kind = "Resident"): string {
  return kind + "-" + createHmac("sha256", salt).update(value).digest("hex").slice(0, 12);
}

/** Conservative phone/JID redaction, not a guarantee of complete anonymisation. */
export function redact(value: string): string {
  return value
    .replace(/[\w.+:-]+@(?:s\.whatsapp\.net|lid|g\.us)/gi, "[private identifier]")
    .replace(/(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?\+?\d+/gi, "[private contact]")
    .replace(/\b\d{4}-\d{2}-\d{2}\b|(?<!\w)\+?\d[\d ()\u00a0.\-]{5,}\d(?!\w)/g, match => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(match)) return match;
      return match.replace(/\D/g, "").length >= 7 ? "[phone redacted]" : match;
    });
}

export function publicMessage(row: { id: string; chat_id: string; sender_id: string | null; sender_name: string | null; text: string | null; [key: string]: unknown }) {
  const { sender_id, sender_name, ...rest } = row;
  return { ...rest, chat_id: privateAlias(row.chat_id, "Group"),
    chat_name: typeof row.chat_name === "string" ? redact(row.chat_name) : null,
    sender: privateAlias(row.chat_id + ":" + (sender_id ?? sender_name ?? "unknown")),
    text: row.text === null ? null : redact(row.text) };
}

import { createHash } from "node:crypto";
import type { CapturedMessage } from "@ditsebe/whatsapp";

/** Android/iOS English text exports. Date order is explicit; unsupported lines are counted. */
export function parseExport(text: string, chatId: string, chatName: string, order: "DMY" | "MDY") {
  const messages: CapturedMessage[] = [];
  let skipped = 0;
  const occurrences = new Map<string, number>();
  const lines = text.replace(/\r\n/g, "\n").replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, "").split("\n");
  for (const line of lines) {
    const match = line.match(/^\[?(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?\]?\s*(?:-\s*)?(.*)$/i);
    if (!match) {
      if (/^\[?\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}/.test(line)) { skipped++; continue; }
      if (messages.length && line) messages[messages.length - 1]!.text += "\n" + line;
      else if (line.trim()) skipped++;
      continue;
    }
    let year = Number(match[3]); if (year < 100) year += 2000;
    const month = Number(order === "DMY" ? match[2] : match[1]);
    const day = Number(order === "DMY" ? match[1] : match[2]);
    let hour = Number(match[4]);
    if (match[7]) hour = hour % 12 + (match[7].toUpperCase() === "PM" ? 12 : 0);
    const minute = Number(match[5]); const second = Number(match[6] ?? 0);
    const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) { skipped++; continue; }
    const body = match[8]!;
    const separator = body.indexOf(": ");
    const sender = separator >= 0 ? body.slice(0, separator) : "System";
    const content = separator >= 0 ? body.slice(separator + 2) : body;
    messages.push({ id: "", chatId, chatName, isGroup: true, senderId: null,
      senderName: sender, fromMe: false, type: separator < 0 ? "system" : "exportText",
      text: content, quotedMessageId: null, timestamp: local.getTime() - 2 * 60 * 60 * 1000, raw: {} });
  }
  for (const message of messages) {
    const fingerprint = JSON.stringify([chatId, message.timestamp, message.senderName, message.text]);
    const ordinal = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, ordinal + 1);
    message.id = "export-" + createHash("sha256").update(fingerprint + ordinal).digest("hex");
    message.raw = { source: "text-export", sender: message.senderName, text: message.text };
  }
  return { messages, skipped };
}

export function exportAttachment(text: string): string | undefined {
  return text.match(/<attached:\s*([^>]+)>/i)?.[1]?.trim()
    ?? text.match(/^(.+?)\s*\(file attached\)/i)?.[1]?.trim();
}

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createImport, stageMessage, updateImport, setAttachment, skipImport, db } from "@ditsebe/api";
import { findGroup, requestHistory, downloadAttachment, normalizeMessage } from "@ditsebe/whatsapp";
import type { CapturedMessage } from "@ditsebe/whatsapp";
import { extractAttachment } from "./attachments.ts";

const previous = db.query("SELECT id,chat_id,chat_name FROM import_runs WHERE source='baileys-history' ORDER BY created_at DESC LIMIT 1").get() as { id: string; chat_id: string; chat_name: string } | null;
let selected: { id: string; chatId: string; name: string; anchorRequested: boolean } | undefined = previous
  ? { id: previous.id, chatId: previous.chat_id, name: previous.chat_name, anchorRequested: true } : undefined;
let queue = Promise.resolve();
const requestedAnchors = new Set<string>();

async function stage(run: NonNullable<typeof selected>, message: CapturedMessage) {
  if (!stageMessage(run.id, message)) return;
  if (!/imageMessage|documentMessage|documentWithCaptionMessage/.test(message.type)) {
    if (/audioMessage|videoMessage|stickerMessage|albumMessage/.test(message.type)) setAttachment(message.chatId, message.id, "unsupported");
    return;
  }
  setAttachment(message.chatId, message.id, "pending");
  let path: string | null = null;
  try {
    const attachment = await downloadAttachment(message.raw);
    if (!attachment) { setAttachment(message.chatId, message.id, "unsupported"); return; }
    const dir = resolve("data/imports", run.id);
    await mkdir(dir, { recursive: true });
    path = resolve(dir, createHash("sha256").update(message.chatId + message.id).digest("hex") + attachment.extension);
    await writeFile(path, attachment.bytes);
    setAttachment(message.chatId, message.id, "downloaded", path);
    const result = await extractAttachment(path, attachment.kind);
    setAttachment(message.chatId, message.id, result.status, path, result.text);
  } catch {
    setAttachment(message.chatId, message.id, path ? "extraction_failed" : "download_failed", path);
  }
}

export async function beginHistoryImport(groupName: string) {
  if (selected) {
    if (selected.name.trim().toLowerCase() === groupName.trim().toLowerCase()) return { id: selected.id, status: "existing_import" };
    throw new Error("A different group import is already active");
  }
  const group = await findGroup(groupName);
  const id = createImport(group.id, group.subject, "baileys-history");
  selected = { id, chatId: group.id, name: group.subject, anchorRequested: false };
  const run = selected;
  // Seed the archive using previously captured messages without invoking fanOut or the LLM.
  const stored = db.query("SELECT raw FROM messages WHERE chat_id=? ORDER BY timestamp").all(group.id) as { raw: string }[];
  let oldest: CapturedMessage | undefined;
  for (const row of stored) {
    const msg = normalizeMessage(JSON.parse(row.raw), group.subject);
    if (msg) { oldest ??= msg; queue = queue.then(() => stage(run, msg)).catch(() => { skipImport(run.id); }); }
  }
  if (oldest) await fetchOlder(run, oldest);
  else updateImport(id, "waiting_for_anchor", "No stored message for this group. Waiting for a new message as a history anchor; a group export can also be imported.");
  return { id, status: oldest ? "requested" : "waiting_for_anchor" };
}

async function fetchOlder(run: NonNullable<typeof selected>, anchor: CapturedMessage) {
  if (requestedAnchors.has(anchor.id)) {
    updateImport(run.id, "no_older_anchor", "The oldest available message has already been requested. No complete-history guarantee; a group export may provide additional records.");
    return;
  }
  requestedAnchors.add(anchor.id);
  run.anchorRequested = true;
  try {
    await requestHistory(anchor.raw, anchor.timestamp);
    updateImport(run.id, "requested", "Requested up to 100 older messages. This is not confirmation of complete history.");
    setTimeout(() => {
      const row = db.query("SELECT status FROM import_runs WHERE id=?").get(run.id) as { status: string };
      if (row.status === "requested") updateImport(run.id, "no_history_received", "No older-history response within 45 seconds. A late response may still arrive. Use a WhatsApp export for broader coverage.");
    }, 45000).unref();
  } catch {
    updateImport(run.id, "request_failed", "WhatsApp history request failed. Captured messages remain staged; use a group export.");
  }
}

export async function continueHistoryImport(id: string) {
  if (!selected) {
    const row = db.query("SELECT id,chat_id,chat_name FROM import_runs WHERE id=? AND source='baileys-history'").get(id) as { id: string; chat_id: string; chat_name: string } | null;
    if (!row) throw new Error("History import not found");
    selected = { id: row.id, chatId: row.chat_id, name: row.chat_name, anchorRequested: true };
  }
  if (selected.id !== id) throw new Error("A different import is active");
  await queue;
  const row = db.query("SELECT raw FROM archive_messages WHERE chat_id=? AND json_extract(raw,'$.key.id') IS NOT NULL ORDER BY timestamp LIMIT 1").get(selected.chatId) as { raw: string } | null;
  if (!row) throw new Error("No history anchor available yet");
  const anchor = normalizeMessage(JSON.parse(row.raw), selected.name);
  if (!anchor) throw new Error("History anchor cannot be decoded");
  await fetchOlder(selected, anchor);
  return { id };
}

export function stageIncoming(message: CapturedMessage) {
  const run = selected;
  if (!run || message.chatId !== run.chatId) return;
  queue = queue.then(async () => {
    await stage(run, message);
    if (!run.anchorRequested) await fetchOlder(run, message);
  }).catch(() => { skipImport(run.id); });
}

export function receiveHistory(messages: unknown[]) {
  const run = selected;
  if (!run) return;
  queue = queue.then(async () => {
    let matched = 0;
    for (const raw of messages) {
      const msg = normalizeMessage(raw as Parameters<typeof normalizeMessage>[0], run.name);
      if (!msg || msg.chatId !== run.chatId) continue;
      matched++;
      await stage(run, msg);
    }
    if (matched) updateImport(run.id, "partial_history_received", "Received available history. Full archive coverage is not verified; review dates and counts.");
  }).catch(() => { updateImport(run.id, "processing_failed", "History processing failed. Review staged records and attachment statuses."); });
}

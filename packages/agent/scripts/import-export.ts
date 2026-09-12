import { readFile, mkdir, copyFile, realpath, stat } from "node:fs/promises";
import { resolve, dirname, extname, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { createImport, stageMessage, setAttachment, updateImport, skipImport, db, importReport } from "@ditsebe/api";
import { parseExport, exportAttachment } from "../src/export-parser.ts";
import { extractAttachment, closeExtractor } from "../src/attachments.ts";

const [file, groupName, dateOrder] = process.argv.slice(2);
if (!file || !groupName || (dateOrder !== "DMY" && dateOrder !== "MDY")) {
  throw new Error('Usage: bun run import:export "path/to/_chat.txt" "Manhattan Heights" DMY (timestamps interpreted as South Africa UTC+02:00)');
}
const filePath = await realpath(file);
const exportDir = dirname(filePath);
const existing = db.query("SELECT DISTINCT chat_id FROM import_runs WHERE lower(trim(chat_name))=lower(trim(?))").all(groupName) as { chat_id: string }[];
if (existing.length > 1) throw new Error("Ambiguous group name");
const chatId = existing[0]?.chat_id ?? "export-" + createHash("sha256").update(groupName.trim().toLowerCase()).digest("hex");
const runId = createImport(chatId, groupName, "text-export");
try {
  const parsed = parseExport(await readFile(filePath, "utf8"), chatId, groupName, dateOrder);
  skipImport(runId, parsed.skipped);
  const destination = resolve("data/imports", runId);
  await mkdir(destination, { recursive: true });
  await copyFile(filePath, resolve(destination, "original-export.txt"));
  for (const message of parsed.messages) {
    if (!stageMessage(runId, message)) continue;
    const attachment = exportAttachment(message.text ?? "");
    if (!attachment) {
      if (/media omitted|image omitted|document omitted|audio omitted|video omitted/i.test(message.text ?? "")) setAttachment(chatId, message.id, "missing");
      continue;
    }
    let localPath: string | null = null;
    try {
      const source = await realpath(resolve(exportDir, attachment));
      const rel = relative(exportDir, source);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Attachment outside export folder");
      if ((await stat(source)).size > 25 * 1024 * 1024) { setAttachment(chatId, message.id, "too_large"); continue; }
      const extension = extname(source).toLowerCase();
      localPath = resolve(destination, message.id + extension);
      await copyFile(source, localPath);
      const kind = extension === ".pdf" ? "pdf" : [".jpg", ".jpeg", ".png", ".webp"].includes(extension) ? "image" : null;
      if (!kind) { setAttachment(chatId, message.id, "unsupported", localPath); continue; }
      setAttachment(chatId, message.id, "downloaded", localPath);
      const result = await extractAttachment(localPath, kind);
      setAttachment(chatId, message.id, result.status, localPath, result.text);
    } catch { setAttachment(chatId, message.id, localPath ? "extraction_failed" : "missing_or_invalid", localPath); }
  }
  updateImport(runId, parsed.messages.length ? "export_processed" : "no_messages_parsed", "Text export processed with " + dateOrder + " dates and UTC+02:00. Reply links and own-message identity are not provided by text exports. Inspect skipped lines and attachment statuses; export and Baileys records cannot be reliably deduplicated against one another.");
} catch (error) {
  updateImport(runId, "failed", "Export processing failed; any staged records have been retained.");
  throw error;
} finally { await closeExtractor(); }
console.log(JSON.stringify(importReport().find(run => run.id === runId), null, 2));

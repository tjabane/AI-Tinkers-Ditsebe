import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  normalizeMessageContent,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { toFile } from "qrcode";
import { resolve } from "node:path";
import { config } from "./config.ts";
import { normalizeMessage } from "./normalize.ts";
import type { CapturedMessage } from "./types.ts";

// Baileys is chatty at info level; only surface real problems.
const logger = {
  level: "error",
  child: () => logger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (...args: unknown[]) => console.error(...args),
  fatal: (...args: unknown[]) => console.error(...args),
} as never;

/** Group subjects, so stored messages carry the group's name and not just its jid. */
const groupNames = new Map<string, string>();
let activeSocket: WASocket | undefined;

export function isWhatsAppConnected(): boolean {
  return activeSocket !== undefined;
}

export async function sendTextMessage(chatId: string, text: string, quoted?: WAMessage) {
  const socket = activeSocket;
  if (!socket) throw new Error("WhatsApp is not connected");
  if (!chatId.endsWith("@g.us")) throw new Error("A group chat ID is required");
  if (!text.trim()) throw new Error("Message text must not be empty");
  const sent = await socket.sendMessage(chatId, { text }, quoted ? { quoted } : undefined);
  if (!sent?.key.id) throw new Error("WhatsApp did not return a message ID");
  return { id: sent.key.id, chatId };
}

async function groupName(sock: WASocket, jid: string): Promise<string | null> {
  const cached = groupNames.get(jid);
  if (cached) return cached;
  try {
    const meta = await sock.groupMetadata(jid);
    if (meta.subject) {
      groupNames.set(jid, meta.subject);
      return meta.subject;
    }
  } catch {
    // Metadata can fail transiently right after connect; the jid alone is fine.
  }
  return null;
}

export async function startWhatsApp(onMessage: (msg: CapturedMessage) => void | Promise<void>, onHistory?: (messages: WAMessage[]) => void): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    // Pulling full history on every connect slows the demo down and is not needed:
    // we capture from the moment the agent joins.
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);
  if (onHistory) sock.ev.on("messaging-history.set", ({ messages }) => onHistory(messages));

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan this QR with the WhatsApp account the agent should use:\n");
      qrcode.generate(qr, { small: true });
      const qrPath = resolve(config.authDir, "pairing-qr.png");
      try {
        await toFile(qrPath, qr, { width: 600, margin: 4 });
        console.log(`Pairing QR saved to ${qrPath} (refresh the image when the code changes)`);
      } catch (err) {
        console.error("Could not save pairing QR:", err);
      }
    }

    if (connection === "open") {
      activeSocket = sock;
      console.log(`\n✅ connected as ${sock.user?.name ?? sock.user?.id}`);
      try {
        const groups = await sock.groupFetchAllParticipating();
        for (const [jid, meta] of Object.entries(groups)) {
          if (meta.subject) groupNames.set(jid, meta.subject);
        }
        console.log(`   listening in ${Object.keys(groups).length} group(s)`);
      } catch (err) {
        console.error("could not prefetch group list:", err);
      }
    }

    if (connection === "close") {
      if (activeSocket === sock) activeSocket = undefined;
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
        ?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.error(
          `\n❌ logged out. Delete ${config.authDir} and restart to pair again.`,
        );
        return;
      }
      console.warn(`connection closed (${statusCode ?? "unknown"}) — reconnecting in 3s`);
      setTimeout(() => {
        startWhatsApp(onMessage, onHistory).catch((err) => console.error("reconnect failed:", err));
      }, 3000);
    }
  });

  sock.ev.on("groups.update", (updates) => {
    for (const update of updates) {
      if (update.id && update.subject) groupNames.set(update.id, update.subject);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    // "notify" is live traffic; "append" is history backfill we do not want here.
    if (type !== "notify") { onHistory?.(messages); return; }

    for (const raw of messages) {
      const chatId = raw.key.remoteJid;
      if (!chatId) continue;

      const name = chatId.endsWith("@g.us") ? await groupName(sock, chatId) : null;
      const msg = normalizeMessage(raw, name);
      if (!msg) continue;
      if (config.groupsOnly && !msg.isGroup) continue;
      if (!config.captureOwn && msg.fromMe) continue;

      await onMessage(msg);
    }
  });

  return sock;
}

export async function findGroup(name: string) {
  if (!activeSocket) throw new Error("WhatsApp is not connected");
  const groups = Object.values(await activeSocket.groupFetchAllParticipating());
  const matches = groups.filter(group => group.subject.trim().toLowerCase() === name.trim().toLowerCase());
  if (matches.length !== 1) throw new Error(matches.length ? "More than one group has that name" : "Group not found on the linked account");
  return matches[0]!;
}
export async function requestHistory(raw: unknown, timestampMs: number) {
  if (!activeSocket) throw new Error("WhatsApp is not connected");
  const message = raw as WAMessage;
  return activeSocket.fetchMessageHistory(100, message.key, timestampMs);
}
export async function downloadAttachment(raw: unknown) {
  if (!activeSocket) throw new Error("WhatsApp is not connected");
  const message = raw as WAMessage;
  const content = normalizeMessageContent(message.message);
  const image = content?.imageMessage;
  const document = content?.documentMessage ?? content?.documentWithCaptionMessage?.message?.documentMessage;
  const kind = image ? "image" as const : document?.mimetype === "application/pdf" ? "pdf" as const : undefined;
  if (!kind) return null;
  if (Number((image ?? document)?.fileLength ?? 0) > 25 * 1024 * 1024) throw new Error("Attachment exceeds 25 MB");
  const bytes = await downloadMediaMessage(message, "buffer", {}, { logger, reuploadRequest: activeSocket.updateMediaMessage });
  if (bytes.length > 25 * 1024 * 1024) throw new Error("Attachment exceeds 25 MB");
  return { bytes, kind, extension: kind === "pdf" ? ".pdf" : ".jpg" };
}

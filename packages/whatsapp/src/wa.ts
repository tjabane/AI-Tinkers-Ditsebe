import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
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

export async function startWhatsApp(onMessage: (msg: CapturedMessage) => void | Promise<void>): Promise<WASocket> {
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

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan this QR with the WhatsApp account the agent should use:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
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
        startWhatsApp(onMessage).catch((err) => console.error("reconnect failed:", err));
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
    if (type !== "notify") return;

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

import { log, errorFields } from "@ditsebe/whatsapp/logging";
import { importReport, archiveMessages } from "./archive.ts";
import { publicMessage, redact, privateAlias } from "./privacy.ts";
import { config } from "./config.ts";
import { getRawMessage, listChats, listMessages, stats } from "./db.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type SendMessageOptions = {
  sendPrivate?: (sourceMessageId: string, text: string) => Promise<{ id: string; chatId: string }>;
  health?: () => { llm: { enabled: boolean; configured: boolean; active: boolean; model: string; last_request: { status: string; at: string; duration_ms?: number } | null } };
  continueImport?: (id: string) => Promise<unknown>;
  beginImport?: (groupName: string) => Promise<unknown>;
  targetChatId?: string;
  isConnected: () => boolean;
  send: (text: string, quotedMessageId?: string) => Promise<{ id: string; chatId: string }>;
};

/** Captured-message reads and an optional outbound group-message handler. */
export function startApi(outbound?: SendMessageOptions) {
  const started = Date.now();
  const server = Bun.serve({
    port: config.apiPort,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/imports/continue" && req.method === "POST") {
        if (!outbound?.continueImport) return json({ error: "History import unavailable" }, 503);
        try {
          const body = await req.json();
          if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string") return json({ error: "id is required" }, 400);
          return json(await outbound.continueImport(body.id), 202);
        } catch { return json({ error: "Unable to continue import" }, 409); }
      }

      if (url.pathname === "/imports" && req.method === "POST") {
        if (!outbound?.beginImport) return json({ error: "History import unavailable" }, 503);
        let body;
        try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        if (!body || typeof body !== "object" || !("groupName" in body) || typeof body.groupName !== "string" || !body.groupName.trim()) return json({ error: "groupName is required" }, 400);
        try { return json(await outbound.beginImport(body.groupName), 202); }
        catch (err) { return json({ error: redact(err instanceof Error ? err.message : "Import failed") }, 409); }
      }
      if (url.pathname === "/messages/send" || url.pathname === "/messages/private") {
        if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
        let body: unknown;
        try { body = await req.json(); }
        catch { return json({ error: "Invalid JSON body" }, 400); }
        if (!body || typeof body !== "object" || !("text" in body) ||
            typeof body.text !== "string" || !body.text.trim() || body.text.length > 10000) {
          return json({ error: "text must be a non-empty string of at most 10000 characters" }, 400);
        }
        if (url.pathname === "/messages/private") {
          if (!("sourceMessageId" in body) || typeof body.sourceMessageId !== "string") return json({ error: "sourceMessageId is required" }, 400);
          if (!outbound?.targetChatId || !getRawMessage(outbound.targetChatId, body.sourceMessageId)) return json({ error: "Original message not found in demo group" }, 404);
          if (!outbound.sendPrivate || !outbound.isConnected()) return json({ error: "WhatsApp sending is unavailable" }, 503);
          try { const sent = await outbound.sendPrivate(body.sourceMessageId, body.text); return json({ id: sent.id, recipient: privateAlias(sent.chatId) }, 201); }
          catch (error) { log("ERROR", "api", "private_send_failed", errorFields(error)); return json({ error: "Private send failed; check before retrying" }, 502); }
        }
        const quotedMessageId = "quotedMessageId" in body ? body.quotedMessageId : undefined;
        if (quotedMessageId !== undefined && (typeof quotedMessageId !== "string" || !quotedMessageId.trim())) {
          return json({ error: "quotedMessageId must be a non-empty string" }, 400);
        }
        if (typeof quotedMessageId === "string" && (!outbound?.targetChatId || !getRawMessage(outbound.targetChatId, quotedMessageId))) {
          return json({ error: "Quoted message not found in the target group" }, 404);
        }
        if (!outbound || !outbound.isConnected()) {
          return json({ error: "WhatsApp sending is unavailable" }, 503);
        }
        try { return json(await outbound.send(body.text, quotedMessageId), 201); }
        catch (err) {
          log("ERROR", "api", "send_failed", errorFields(err));
          return json({ error: "Sending failed; delivery may be uncertain. Check the group before retrying." }, 502);
        }
      }

      if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

      if (url.pathname === "/archive") return new Response(Bun.file(new URL("./archive.html", import.meta.url)), { headers: { "content-type": "text/html; charset=utf-8" } });
      if (url.pathname === "/imports") return json(importReport());
      if (url.pathname === "/archive/messages") {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (!Number.isSafeInteger(offset) || offset < 0) return json({ error: "Invalid offset" }, 400);
        const disposition = url.searchParams.get("disposition") ?? undefined;
        if (disposition && !["useful", "context", "needs_review", "low_value", "unreviewed"].includes(disposition)) return json({ error: "Invalid review filter" }, 400);
        return json(archiveMessages(url.searchParams.get("runId") ?? "", 100, offset, disposition));
      }
      if (url.pathname === "/health") {
        const latest = importReport()[0];
        return json({ ok: true, ...stats(), uptime_seconds: Math.floor((Date.now() - started) / 1000),
          whatsapp: { connected: outbound?.isConnected() ?? false },
          llm: outbound?.health?.().llm ?? { enabled: false, configured: false, active: false, model: null, last_request: null },
          latest_import: latest ? { status: latest.status, messages: latest.messages, duplicates: latest.duplicates, attachments: latest.attachments } : null,
        });
      }

      if (url.pathname === "/chats") {
        return json(listChats().map(chat => ({ ...chat, chat_id: privateAlias(chat.chat_id, "Group"), chat_name: chat.chat_name ? redact(chat.chat_name) : null })));
      }

      if (url.pathname === "/messages") {
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 500);
        const requestedChat = url.searchParams.get("chatId") ?? undefined;
        const chatId = listChats().find(chat => privateAlias(chat.chat_id, "Group") === requestedChat)?.chat_id ?? requestedChat;
        const sinceParam = url.searchParams.get("since");
        const since = sinceParam ? Number(sinceParam) : undefined;
        if (!Number.isSafeInteger(limit) || limit < 1 || (since !== undefined && !Number.isFinite(since))) return json({ error: "Invalid query" }, 400);
        return json(listMessages({ chatId, limit, since }).map(row => publicMessage(row)));
      }

      return json({ error: "not found" }, 404);
    },
  });

  log("INFO", "api", "listening", { port: server.port });
  return server;
}

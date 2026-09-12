import { config } from "./config.ts";
import { getRawMessage, listChats, listMessages, stats } from "./db.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type SendMessageOptions = {
  targetChatId?: string;
  isConnected: () => boolean;
  send: (text: string, quotedMessageId?: string) => Promise<{ id: string; chatId: string }>;
};

/** Captured-message reads and an optional outbound group-message handler. */
export function startApi(outbound?: SendMessageOptions) {
  const server = Bun.serve({
    port: config.apiPort,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/messages/send") {
        if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
        let body: unknown;
        try { body = await req.json(); }
        catch { return json({ error: "Invalid JSON body" }, 400); }
        if (!body || typeof body !== "object" || !("text" in body) ||
            typeof body.text !== "string" || !body.text.trim() || body.text.length > 10000) {
          return json({ error: "text must be a non-empty string of at most 10000 characters" }, 400);
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
          console.error("WhatsApp send failed:", err);
          return json({ error: "Sending failed; delivery may be uncertain. Check the group before retrying." }, 502);
        }
      }

      if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

      if (url.pathname === "/health") {
        return json({ ok: true, ...stats() });
      }

      if (url.pathname === "/chats") {
        return json(listChats());
      }

      if (url.pathname === "/messages") {
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 500);
        const chatId = url.searchParams.get("chatId") ?? undefined;
        const sinceParam = url.searchParams.get("since");
        const since = sinceParam ? Number(sinceParam) : undefined;
        return json(listMessages({ chatId, limit, since }));
      }

      return json({ error: "not found" }, 404);
    },
  });

  console.log(`REST API on http://localhost:${server.port} (/health, /chats, /messages)`);
  return server;
}

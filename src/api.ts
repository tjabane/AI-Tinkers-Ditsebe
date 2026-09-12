import { config } from "./config.ts";
import { listChats, listMessages, stats } from "./db.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Read-only API over the captured messages, so downstream services (and the
 *  phase-2 LLM) have something to pull from. */
export function startApi() {
  const server = Bun.serve({
    port: config.apiPort,
    fetch(req) {
      const url = new URL(req.url);

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

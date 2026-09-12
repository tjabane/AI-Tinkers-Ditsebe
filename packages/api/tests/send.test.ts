import { test, expect } from "bun:test";
process.env.DB_PATH = ":memory:";
process.env.PORT = "0";
const { startApi } = await import("../src/api.ts");

test("send endpoint validates input and handles connection and delivery failures", async () => {
  let connected = true;
  let fail = false;
  const sent: string[] = [];
  const server = startApi({
    isConnected: () => connected,
    send: async (text) => {
      if (fail) throw new Error("simulated failure");
      sent.push(text);
      return { id: "test-id", chatId: "test@g.us" };
    },
  });
  const post = (body: string) => fetch(new URL("/messages/send", server.url), { method: "POST", body });
  try {
    for (const body of ["invalid", "null", '{}', '{"text":" "}', '{"text":123}', JSON.stringify({ text: "x".repeat(10001) })]) {
      expect((await post(body)).status).toBe(400);
    }
    expect((await post('{"text":"reply","quotedMessageId":123}')).status).toBe(400);
    expect((await post('{"text":"reply","quotedMessageId":"missing"}')).status).toBe(404);
    expect(sent).toEqual([]);
    const response = await post(JSON.stringify({ text: "Hello" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "test-id", chatId: "test@g.us" });
    expect(sent).toEqual(["Hello"]);
    connected = false;
    expect((await post('{"text":"offline"}')).status).toBe(503);
    connected = true;
    fail = true;
    expect((await post('{"text":"failure"}')).status).toBe(502);
    expect(sent).toEqual(["Hello"]);
    expect((await fetch(new URL("/messages/send", server.url))).status).toBe(405);
  } finally { await server.stop(true); }
});

test("standalone API cannot send", async () => {
  const server = startApi();
  try {
    const response = await fetch(new URL("/messages/send", server.url), { method: "POST", body: '{"text":"Hello"}' });
    expect(response.status).toBe(503);
  } finally { await server.stop(true); }
});

import { test, expect, spyOn } from "bun:test";
import { log, logRef, errorFields } from "@ditsebe/whatsapp/logging";
process.env.DB_PATH = ":memory:";
process.env.PORT = "0";
const { startApi } = await import("../src/api.ts");
type Health = { whatsapp: { connected: boolean }; llm: { configured: boolean; active: boolean; last_request: unknown }; uptime_seconds: number };

test("logs metadata without exception messages, unknown fields or secrets", () => {
  const output = spyOn(console, "error").mockImplementation(() => {});
  try {
    const error = Object.assign(new Error("sk-private-key phone +27821234567"), { status: 401 });
    log("ERROR", "agent", "generation_failed", { ref: logRef("private-message"), ...errorFields(error), model: "sk-private-key" });
    const line = output.mock.calls[0]![0] as string;
    expect(JSON.parse(line)).toMatchObject({ component: "agent", event: "generation_failed", status: 401, error_type: "Error" });
    expect(line).not.toContain("sk-private-key");
    expect(line).not.toContain("27821234567");
    expect(line).not.toContain("private-message");
  } finally { output.mockRestore(); }
});

test("health reports connection and LLM state without treating configuration as readiness", async () => {
  let connected = false;
  const server = startApi({ isConnected: () => connected, send: async () => ({ id: "test", chatId: "test" }),
    health: () => ({ llm: { enabled: true, configured: true, active: true, model: "demo-model", last_request: null } }) });
  try {
    const first = await (await fetch(new URL("/health", server.url))).json() as Health;
    expect(first.whatsapp.connected).toBe(false);
    expect(first.llm).toMatchObject({ configured: true, active: true, last_request: null });
    expect(first.uptime_seconds).toBeGreaterThanOrEqual(0);
    connected = true;
    expect(((await (await fetch(new URL("/health", server.url))).json()) as Health).whatsapp.connected).toBe(true);
  } finally { await server.stop(true); }
  const standalone = startApi();
  try {
    const health = await (await fetch(new URL("/health", standalone.url))).json() as Health;
    expect(health.llm.active).toBe(false);
    expect(health.whatsapp.connected).toBe(false);
  } finally { await standalone.stop(true); }
});

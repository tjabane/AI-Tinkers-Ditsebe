import { test, expect } from "bun:test";
process.env.DB_PATH = ":memory:";
process.env.PORT = "0";
const { createImport, stageMessage, archiveMessages, importReport, setAttachment, markArchive } = await import("../src/archive.ts");
const { redact, privateAlias } = await import("../src/privacy.ts");
const { startApi } = await import("../src/api.ts");
const { stats } = await import("../src/db.ts");

test("redacts phones, contact links and WhatsApp IDs while preserving times", () => {
  const result = redact("Call +27 82 123 4567 or 0786 54 88 17. https://wa.me/27821234567 27821234567@s.whatsapp.net. Outage 2026-09-12 08:00–10:00");
  expect(result).not.toContain("27821234567");
  expect(result).not.toContain("0786");
  expect(result).toContain("2026-09-12");
  expect(result).toContain("08:00–10:00");
  expect(privateAlias("resident")).toBe(privateAlias("resident"));
  expect(privateAlias("group1:resident")).not.toBe(privateAlias("group2:resident"));
});

test("review marks preserve sources, filter correctly and reject unrelated messages", () => {
  const id = createImport("review@g.us", "Review test", "test");
  stageMessage(id, { id: "review-source", chatId: "review@g.us", chatName: "Review test", isGroup: true,
    senderId: "private", senderName: "Private", fromMe: false, type: "conversation",
    text: "Power is back", timestamp: 100, quotedMessageId: null, raw: {} });
  const review = { messageId: "review-source", disposition: "useful" as const, category: "power_restoration",
    topic: "Historical outage", summary: "Resident reports restoration", caveat: "Historical, unverified report" };
  markArchive(id, [review]);
  markArchive(id, [review]);
  expect(archiveMessages(id, 100, 0, "useful")).toHaveLength(1);
  expect(archiveMessages(id, 100, 0, "needs_review")).toHaveLength(0);
  expect(archiveMessages(id)[0]).toMatchObject({ text: "Power is back", summary: review.summary, disposition: "useful" });
  expect(() => markArchive(id, [{ ...review, summary: "Should roll back" }, { ...review, messageId: "not-in-import" }])).toThrow("not in this import");
  expect(archiveMessages(id)[0]?.summary).toBe(review.summary);
});

test("staging is isolated, deduplicated, group-scoped and redacted at the API", async () => {
  const before = stats().messages;
  const id = createImport("private-group@g.us", "Test group", "test");
  const message = { id: "archive-test", chatId: "private-group@g.us", chatName: "Test", isGroup: true,
    senderId: "27821234567@s.whatsapp.net", senderName: "Private Name", fromMe: false,
    type: "imageMessage", text: "Call 082 123 4567", timestamp: 100, quotedMessageId: "previous", raw: { secret: "27821234567" } };
  expect(stageMessage(id, message)).toBe(true);
  expect(stageMessage(id, message)).toBe(false);
  expect(() => stageMessage(id, { ...message, chatId: "other" })).toThrow("group mismatch");
  setAttachment(message.chatId, message.id, "extracted", "private/path.png", "Phone: 0821234567");
  expect(stats().messages).toBe(before);
  const rows = archiveMessages(id);
  expect(rows).toHaveLength(1);
  const encoded = JSON.stringify(rows);
  for (const secret of ["0821234567", "082 123 4567", "Private Name", "private/path", "27821234567", "secret"]) expect(encoded).not.toContain(secret);
  expect(importReport().find(run => run.id === id)).toMatchObject({ duplicates: 1, messages: 1 });
  const server = startApi();
  try {
    const response = await fetch(new URL("/archive/messages?runId=" + id, server.url));
    expect(await response.json()).toEqual(rows);
    expect((await fetch(new URL("/archive", server.url))).status).toBe(200);
    expect((await fetch(new URL("/archive/messages?offset=-1", server.url))).status).toBe(400);
  } finally { await server.stop(true); }
});

import { expect, test } from "bun:test";
import { createAgent, type AgentDependencies } from "../src/agent.ts";
import type { CapturedMessage } from "@ditsebe/whatsapp";
import type { ReplyInput } from "../src/llm.ts";

const message: CapturedMessage = {
  id: "question", chatId: "demo@g.us", chatName: "Demo", isGroup: true,
  senderId: "resident", senderName: "Sam", fromMe: false, type: "conversation",
  text: "!ditsebe Who was recommended?", quotedMessageId: null, timestamp: 10, raw: {},
};

function setup(overrides: Partial<AgentDependencies> = {}) {
  const sent: string[] = [];
  const saved: CapturedMessage[] = [];
  const inputs: ReplyInput[] = [];
  const handler = createAgent({
    targetChatId: message.chatId,
    history: () => [], hasReply: () => false,
    generate: async input => { inputs.push(input); return "Sam recommended Alex."; },
    send: async (original, text) => {
      expect(original.id).toBeTruthy();
      sent.push(text);
      return { id: "reply-" + original.id, chatId: original.chatId };
    },
    save: reply => { saved.push(reply); },
    ...overrides,
  });
  return { handler, sent, saved, inputs };
}

test("ignores own messages, other groups and ordinary conversation", async () => {
  const t = setup();
  await t.handler({ ...message, fromMe: true });
  await t.handler({ ...message, chatId: "other@g.us" });
  await t.handler({ ...message, text: "Hello" });
  await t.handler({ ...message, text: "!ditsebeExtra hello" });
  expect(t.inputs).toHaveLength(0);
  expect(t.sent).toHaveLength(0);
});

test("answers once, quotes the trigger and saves outgoing context", async () => {
  const t = setup();
  await Promise.all([t.handler(message), t.handler(message)]);
  expect(t.inputs[0]?.question).toBe("Who was recommended?");
  expect(t.sent).toHaveLength(1);
  expect(t.saved[0]).toMatchObject({ fromMe: true, quotedMessageId: message.id, senderName: "Ditsebe" });
});

test("skips questions with a previously saved reply", async () => {
  const t = setup({ hasReply: () => true });
  await t.handler(message);
  expect(t.sent).toHaveLength(0);
});

test("bare trigger gives usage without calling the model", async () => {
  const t = setup();
  await t.handler({ ...message, text: "!ditsebe" });
  expect(t.inputs).toHaveLength(0);
  expect(t.sent[0]).toContain("Ask me a question");
});

test("model failure sends nothing and does not block the next question", async () => {
  let calls = 0;
  const t = setup({ generate: async () => {
    if (++calls === 1) throw new Error("model unavailable");
    return "Recovered";
  } });
  await expect(t.handler(message)).rejects.toThrow("model unavailable");
  expect(t.sent).toHaveLength(0);
  await t.handler({ ...message, id: "next" });
  expect(t.sent).toEqual(["Recovered"]);
});

test("uncertain send failure is not retried on replay", async () => {
  let sends = 0;
  const t = setup({ send: async () => { sends++; throw new Error("connection lost"); } });
  await expect(t.handler(message)).rejects.toThrow("connection lost");
  await t.handler(message);
  expect(sends).toBe(1);
  expect(t.saved).toHaveLength(0);
});

test("reads only the target group's history and orders it chronologically", async () => {
  const row = (id: string) => ({
    id, chat_id: message.chatId, chat_name: "Demo", is_group: 1,
    sender_id: "sam", sender_name: "Sam", from_me: 0, type: "conversation",
    text: id, quoted_message_id: null, timestamp: 1,
  });
  const t = setup({ history: chatId => {
    expect(chatId).toBe(message.chatId);
    return [row(message.id), row("newer"), row("older")];
  } });
  await t.handler(message);
  expect(t.inputs[0]?.history.map(row => row.id)).toEqual(["older", "newer"]);
});

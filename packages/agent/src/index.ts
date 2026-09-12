import { startApi, getRawMessage, listMessages, saveMessage, hasReply } from "@ditsebe/api";
import { config } from "./config.ts";
import { startWhatsApp, sendTextMessage, isWhatsAppConnected } from "@ditsebe/whatsapp";

import { beginHistoryImport, continueHistoryImport, receiveHistory, stageIncoming } from "./importer.ts";
import { fanOut } from "./sinks.ts";
import { createAgent } from "./agent.ts";
import { createReplyGenerator } from "./llm.ts";

console.log("ditsebe — WhatsApp group capture agent");
console.log(`  db:      ${process.env.DB_PATH ?? "./data/messages.db"}`);
console.log(`  webhook: ${config.webhookUrl || "(none)"}`);
console.log(`  scope:   ${(process.env.GROUPS_ONLY ?? "true") === "true" ? "groups only" : "groups + DMs"}`);

startApi({
  continueImport: continueHistoryImport,
  beginImport: beginHistoryImport,
  targetChatId: config.targetChatId,
  isConnected: isWhatsAppConnected,
  send: (text, quotedMessageId) => sendTextMessage(config.targetChatId, text,
    quotedMessageId ? getRawMessage(config.targetChatId, quotedMessageId) : undefined),
});
const apiKey = process.env.OPENAI_API_KEY;
const agent = config.llmEnabled && apiKey ? createAgent({
  targetChatId: config.targetChatId,
  history: (chatId) => listMessages({ chatId, limit: 40 }),
  hasReply,
  generate: createReplyGenerator(apiKey, config.model),
  send: (message, text) => sendTextMessage(message.chatId, text, getRawMessage(message.chatId, message.id)),
  save: saveMessage,
}) : undefined;
console.log(agent ? "LLM enabled: " + config.model + " (trigger: !ditsebe)" : "LLM disabled: set OPENAI_API_KEY and LLM_ENABLED=true");
await startWhatsApp(async (message) => {
  stageIncoming(message);
  await fanOut(message);
  if (agent) void agent(message).catch((err) => {
    console.error("Agent reply failed:", err instanceof Error ? err.message : "Unknown error");
  });
}, receiveHistory);

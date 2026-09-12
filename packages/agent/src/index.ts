import { log } from "@ditsebe/whatsapp/logging";
import { startApi, getRawMessage, listMessages, saveMessage, hasReply } from "@ditsebe/api";
import { config } from "./config.ts";
import { startWhatsApp, sendTextMessage, isWhatsAppConnected } from "@ditsebe/whatsapp";

import { beginHistoryImport, continueHistoryImport, receiveHistory, stageIncoming } from "./importer.ts";
import { fanOut } from "./sinks.ts";
import { createAgent } from "./agent.ts";
import { createReplyGenerator, getLlmStatus } from "./llm.ts";

log("INFO", "app", "starting", { webhook_enabled: Boolean(config.webhookUrl), groups_only: (process.env.GROUPS_ONLY ?? "true") === "true" });

startApi({
  health: () => ({ llm: { enabled: config.llmEnabled, configured: Boolean(process.env.OPENAI_API_KEY), active: Boolean(agent), model: config.model, last_request: getLlmStatus() } }),
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
log(agent ? "INFO" : "WARN", "agent", agent ? "enabled" : "disabled", { model: config.model, enabled: config.llmEnabled, configured: Boolean(apiKey) });
await startWhatsApp(async (message) => {
  stageIncoming(message);
  await fanOut(message);
  if (agent) void agent(message).catch(() => {}); // The agent logs the failed phase without private payloads.
}, receiveHistory);

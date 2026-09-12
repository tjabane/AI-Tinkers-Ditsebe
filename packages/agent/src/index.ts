import { log } from "@ditsebe/whatsapp/logging";
import { startApi, getRawMessage, listMessages, saveMessage, hasReply } from "@ditsebe/api";
import { config } from "./config.ts";
import { startWhatsApp, sendTextMessage, sendPrivateReply, trackPrivateRecipient, isWhatsAppConnected } from "@ditsebe/whatsapp";

import { beginHistoryImport, continueHistoryImport, receiveHistory, stageIncoming } from "./importer.ts";
import { fanOut } from "./sinks.ts";
import { serviceCases } from "@ditsebe/api/services";
import { createServiceDetector } from "./service-detector.ts";
import { createServiceWorkflow } from "./service-workflow.ts";
import { createAgent } from "./agent.ts";
import { createReplyGenerator, getLlmStatus } from "./llm.ts";

log("INFO", "app", "starting", { webhook_enabled: Boolean(config.webhookUrl), groups_only: (process.env.GROUPS_ONLY ?? "true") === "true" });

startApi({
  health: () => ({ llm: { enabled: config.llmEnabled, configured: Boolean(process.env.OPENAI_API_KEY), active: Boolean(agent), model: config.model, last_request: getLlmStatus() } }),
  continueImport: continueHistoryImport,
  beginImport: beginHistoryImport,
  targetChatId: config.targetChatId,
  sendPrivate: (sourceMessageId, text) => sendPrivateReply(getRawMessage(config.targetChatId, sourceMessageId), text),
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
const serviceWorkflow = config.llmEnabled && apiKey ? createServiceWorkflow({
  groupId: config.targetChatId,
  sendGroup: async (message, text) => {
    const sent = await sendTextMessage(message.chatId, text, getRawMessage(message.chatId, message.id));
    saveMessage({ ...message, id: sent.id, fromMe: true, senderId: null, senderName: "Ditsebe",
      type: "conversation", text, quotedMessageId: message.id, timestamp: Date.now(),
      raw: { key: { id: sent.id, remoteJid: sent.chatId, fromMe: true }, message: { conversation: text } } });
    return sent;
  },
  detect: createServiceDetector(apiKey, config.model),
  send: (requestId, text) => sendPrivateReply(getRawMessage(config.targetChatId, requestId), text),
}) : undefined;
for (const item of serviceCases(config.targetChatId)) {
  if (item.followup_status !== "waiting") trackPrivateRecipient(getRawMessage(item.chat_id, item.request_id));
}
if (serviceWorkflow) {
  const ready = setInterval(() => {
    if (!isWhatsAppConnected()) return;
    clearInterval(ready);
    void serviceWorkflow.askPendingPermissions().catch(() => log("ERROR", "agent", "permission_request_failed"));
  }, 1000);
  ready.unref();
}
log(serviceWorkflow ? "INFO" : "WARN", "agent", "automatic_followups", { enabled: Boolean(serviceWorkflow) });
await startWhatsApp(async (message) => {
  stageIncoming(message);
  await fanOut(message);
  if (serviceWorkflow) void serviceWorkflow(message).catch(() => {});
  if (agent) void agent(message).catch(() => {}); // The agent logs the failed phase without private payloads.
}, receiveHistory);

import { startApi, getRawMessage } from "@ditsebe/api";
import { config } from "./config.ts";
import { startWhatsApp, sendTextMessage, isWhatsAppConnected } from "@ditsebe/whatsapp";

import { fanOut } from "./sinks.ts";

console.log("ditsebe — WhatsApp group capture agent");
console.log(`  db:      ${process.env.DB_PATH ?? "./data/messages.db"}`);
console.log(`  webhook: ${config.webhookUrl || "(none)"}`);
console.log(`  scope:   ${(process.env.GROUPS_ONLY ?? "true") === "true" ? "groups only" : "groups + DMs"}`);

startApi({
  targetChatId: "120363431475712196@g.us",
  isConnected: isWhatsAppConnected,
  send: (text, quotedMessageId) => sendTextMessage("120363431475712196@g.us", text,
    quotedMessageId ? getRawMessage("120363431475712196@g.us", quotedMessageId) : undefined),
});
await startWhatsApp(fanOut);

import { startApi } from "@ditsebe/api";
import { config } from "./config.ts";
import { startWhatsApp } from "@ditsebe/whatsapp";

import { fanOut } from "./sinks.ts";

console.log("ditsebe — WhatsApp group capture agent");
console.log(`  db:      ${process.env.DB_PATH ?? "./data/messages.db"}`);
console.log(`  webhook: ${config.webhookUrl || "(none)"}`);
console.log(`  scope:   ${(process.env.GROUPS_ONLY ?? "true") === "true" ? "groups only" : "groups + DMs"}`);

startApi();
await startWhatsApp(fanOut);

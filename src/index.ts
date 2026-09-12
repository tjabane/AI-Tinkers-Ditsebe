import { startApi } from "./api.ts";
import { config } from "./config.ts";
import { startWhatsApp } from "./wa.ts";

console.log("ditsebe — WhatsApp group capture agent");
console.log(`  db:      ${config.dbPath}`);
console.log(`  webhook: ${config.webhookUrl || "(none)"}`);
console.log(`  scope:   ${config.groupsOnly ? "groups only" : "groups + DMs"}`);

startApi();
await startWhatsApp();

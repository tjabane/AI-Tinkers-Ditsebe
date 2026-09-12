import { log, logRef, errorFields } from "@ditsebe/whatsapp/logging";
import { config } from "./config.ts";
import { saveMessage, redact, privateAlias } from "@ditsebe/api";
import type { CapturedMessage } from "@ditsebe/whatsapp";

/** Anything that wants a copy of every captured message. */
export type Sink = {
  name: string;
  handle: (msg: CapturedMessage) => void | Promise<void>;
};

const sqliteSink: Sink = {
  name: "sqlite",
  handle: (msg) => saveMessage(msg),
};

/** Ships each message to a REST endpoint. Fire-and-forget: a failed POST never
 *  blocks capture, it only logs. */
const webhookSink: Sink = {
  name: "webhook",
  handle: async (msg) => {
    const res = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.webhookToken ? { authorization: `Bearer ${config.webhookToken}` } : {}),
      },
      // The raw payload is big and noisy; the webhook gets the flat record.
      body: JSON.stringify({ id: msg.id, chat: privateAlias(msg.chatId, "Group"), sender: privateAlias(msg.chatId + ":" + (msg.senderId ?? msg.senderName ?? "unknown")), text: msg.text ? redact(msg.text) : null, timestamp: msg.timestamp, type: msg.type }),
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  },
};

const consoleSink: Sink = {
  name: "console",
  handle: (msg) => {
    log("INFO", "agent", "message_captured", { ref: logRef(msg.chatId + ":" + msg.id) });
  },
};

export const sinks: Sink[] = [
  sqliteSink,
  consoleSink,
  ...(config.webhookUrl ? [webhookSink] : []),
];

export async function fanOut(msg: CapturedMessage): Promise<void> {
  await Promise.all(
    sinks.map(async (sink) => {
      try {
        await sink.handle(msg);
      } catch (err) {
        log("ERROR", "agent", "sink_failed", { ref: logRef(msg.chatId + ":" + msg.id), sink: sink.name, ...errorFields(err) });
      }
    }),
  );
}

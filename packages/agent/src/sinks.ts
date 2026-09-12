import { config } from "./config.ts";
import { saveMessage } from "@ditsebe/api";
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
      body: JSON.stringify({ ...msg, raw: undefined }),
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  },
};

const consoleSink: Sink = {
  name: "console",
  handle: (msg) => {
    const who = msg.senderName ?? msg.senderId ?? "unknown";
    const where = msg.chatName ?? msg.chatId;
    const body = msg.text ?? `<${msg.type}>`;
    console.log(`[${where}] ${who}: ${body}`);
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
        console.error(`sink "${sink.name}" failed for message ${msg.id}:`, err);
      }
    }),
  );
}

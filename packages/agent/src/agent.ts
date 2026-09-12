import type { CapturedMessage } from "@ditsebe/whatsapp";
import type { MessageRow } from "@ditsebe/api";
import type { ReplyInput } from "./llm.ts";

export type AgentDependencies = {
  targetChatId: string;
  history: (chatId: string) => MessageRow[];
  hasReply: (chatId: string, messageId: string) => boolean;
  generate: (input: ReplyInput) => Promise<string>;
  send: (message: CapturedMessage, text: string) => Promise<{ id: string; chatId: string }>;
  save: (message: CapturedMessage) => void;
};

/** Serializes replies while callers continue capturing new messages. */
export function createAgent(deps: AgentDependencies) {
  let queue = Promise.resolve();
  const seen = new Set<string>();
  return (message: CapturedMessage): Promise<void> => {
    const match = message.text?.trim().match(/^!ditsebe(?:\s+([\s\S]*))?$/i);
    if (message.fromMe || message.chatId !== deps.targetChatId || !match) return Promise.resolve();
    const key = message.chatId + ":" + message.id;
    if (seen.has(key) || deps.hasReply(message.chatId, message.id)) return Promise.resolve();
    seen.add(key);
    if (seen.size > 2000) seen.delete(seen.values().next().value!);
    const work = queue.then(async () => {
      const history = deps.history(message.chatId).filter(row => row.id !== message.id).reverse();
      const text = match[1]?.trim()
        ? await deps.generate({ question: match[1].trim(), history })
        : "Ask me a question, for example: !ditsebe What has the group discussed?";
      if (!text.trim()) throw new Error("Empty agent response");
      const sent = await deps.send(message, text);
      deps.save({
        ...message, id: sent.id, fromMe: true, senderId: null, senderName: "Ditsebe",
        text, type: "conversation", timestamp: Date.now(), quotedMessageId: message.id,
        raw: { key: { id: sent.id, remoteJid: sent.chatId, fromMe: true },
          message: { extendedTextMessage: { text, contextInfo: { stanzaId: message.id } } } },
      });
      console.log("Agent replied to message " + message.id);
    });
    // A failed job must not stop subsequent questions. Never automatically retry sends.
    queue = work.catch(() => {});
    return work;
  };
}

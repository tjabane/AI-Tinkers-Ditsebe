import {
  getContentType,
  isJidGroup,
  jidNormalizedUser,
  normalizeMessageContent,
  type WAMessage,
  type WAMessageContent,
} from "@whiskeysockets/baileys";
import type { CapturedMessage } from "./types.ts";

/** Pull human-readable text out of whatever message variant arrived. */
function extractText(content: WAMessageContent | undefined): string | null {
  if (!content) return null;
  const text =
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    content.buttonsResponseMessage?.selectedDisplayText ??
    content.listResponseMessage?.title ??
    content.templateButtonReplyMessage?.selectedDisplayText ??
    content.reactionMessage?.text ??
    null;
  return text?.trim() ? text : null;
}

/** The message this one replies to, so threads can be reconstructed downstream. */
function extractQuotedId(content: WAMessageContent | undefined): string | null {
  if (!content) return null;
  for (const value of Object.values(content)) {
    const stanzaId = (value as { contextInfo?: { stanzaId?: string | null } })?.contextInfo?.stanzaId;
    if (stanzaId) return stanzaId;
  }
  return null;
}

/**
 * Flatten a Baileys message. Returns null for protocol noise (key exchanges,
 * receipts and similar) that carries nothing worth storing.
 */
export function normalizeMessage(msg: WAMessage, chatName: string | null): CapturedMessage | null {
  const chatId = msg.key.remoteJid;
  if (!chatId || chatId === "status@broadcast") return null;

  const content = normalizeMessageContent(msg.message);
  const type = getContentType(content);
  if (!type || type === "protocolMessage" || type === "senderKeyDistributionMessage") return null;

  const isGroup = Boolean(isJidGroup(chatId));
  const rawSender = isGroup
    ? msg.key.participant ?? (msg.key as { participantAlt?: string }).participantAlt
    : chatId;

  // WhatsApp timestamps are seconds; Long values arrive from protobuf.
  const seconds = Number(msg.messageTimestamp ?? 0);

  return {
    id: msg.key.id ?? crypto.randomUUID(),
    chatId,
    chatName,
    isGroup,
    senderId: rawSender ? jidNormalizedUser(rawSender) : null,
    senderName: msg.pushName ?? null,
    fromMe: Boolean(msg.key.fromMe),
    type,
    text: extractText(content),
    quotedMessageId: extractQuotedId(content),
    timestamp: seconds > 0 ? seconds * 1000 : Date.now(),
    raw: msg,
  };
}

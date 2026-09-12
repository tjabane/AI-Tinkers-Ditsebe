/** A WhatsApp message flattened into the shape we store and ship to the API. */
export type CapturedMessage = {
  /** WhatsApp message id — unique per chat, used for dedupe. */
  id: string;
  /** Chat jid: a group (…@g.us) or a person (…@s.whatsapp.net). */
  chatId: string;
  chatName: string | null;
  isGroup: boolean;
  /** Sender jid. In groups this is the participant, not the chat. */
  senderId: string | null;
  /** The sender's WhatsApp display name, when WhatsApp gives us one. */
  senderName: string | null;
  fromMe: boolean;
  /** Message kind: conversation, imageMessage, etc. */
  type: string;
  /** Text body, or the caption for media. Null when there is no text at all. */
  text: string | null;
  /** Id of the message this one replies to, if any. */
  quotedMessageId: string | null;
  /** Message time in epoch milliseconds. */
  timestamp: number;
  /** Full Baileys payload, kept so we can backfill fields we did not parse yet. */
  raw: unknown;
};

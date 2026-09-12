import { db } from "./db.ts";

db.exec(`CREATE TABLE IF NOT EXISTS service_cases (
 request_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, requester_id TEXT NOT NULL,
 category TEXT NOT NULL, provider TEXT, recommendation_id TEXT, used_message_id TEXT,
 followup_status TEXT NOT NULL DEFAULT 'waiting', followup_id TEXT, feedback TEXT,
 feedback_message_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS service_events (
 chat_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(chat_id,message_id)
);
CREATE TABLE IF NOT EXISTS feedback_permissions (
 request_id TEXT PRIMARY KEY, status TEXT NOT NULL, question_id TEXT, response_id TEXT
);
CREATE TABLE IF NOT EXISTS service_suggestions (
 request_id TEXT PRIMARY KEY, source_request_id TEXT NOT NULL, status TEXT NOT NULL, message_id TEXT
);`);

export type ServiceCase = { request_id: string; chat_id: string; requester_id: string; category: string;
 provider: string | null; recommendation_id: string | null; used_message_id: string | null;
 followup_status: string; followup_id: string | null; feedback: string | null; feedback_message_id: string | null };

export function serviceCases(chatId: string): ServiceCase[] {
  return db.query("SELECT * FROM service_cases WHERE chat_id=? ORDER BY created_at DESC LIMIT 30").all(chatId) as ServiceCase[];
}
export function serviceEventSeen(chatId: string, id: string): boolean {
  return !!db.query("SELECT 1 FROM service_events WHERE chat_id=? AND message_id=?").get(chatId, id);
}
export function markServiceEvent(chatId: string, id: string) {
  db.query("INSERT OR IGNORE INTO service_events VALUES(?,?)").run(chatId, id);
}
export function recordRequest(id: string, chatId: string, requester: string, category: string, at: number) {
  db.query("INSERT OR IGNORE INTO service_cases(request_id,chat_id,requester_id,category,created_at) VALUES(?,?,?,?,?)")
    .run(id, chatId, requester, category, at);
}
export function recordRecommendation(id: string, provider: string, messageId: string) {
  db.query("UPDATE service_cases SET provider=?,recommendation_id=? WHERE request_id=? AND followup_status='waiting'")
    .run(provider, messageId, id);
}
export function claimFollowup(id: string, usedMessageId: string): boolean {
  return db.query("UPDATE service_cases SET used_message_id=?,followup_status='sending' WHERE request_id=? AND followup_status='waiting' AND provider IS NOT NULL")
    .run(usedMessageId, id).changes > 0;
}
export function finishFollowup(id: string, messageId: string | null) {
  db.query("UPDATE service_cases SET followup_status=?,followup_id=? WHERE request_id=?")
    .run(messageId ? "sent" : "send_uncertain", messageId, id);
}
export function pendingFeedback(recipient: string): ServiceCase[] {
  return db.query("SELECT * FROM service_cases WHERE requester_id=? AND followup_status='sent' ORDER BY created_at DESC").all(recipient) as ServiceCase[];
}
export function saveFeedback(id: string, text: string, messageId: string) {
  db.query("UPDATE service_cases SET feedback=?,feedback_message_id=?,followup_status='answered' WHERE request_id=? AND followup_status='sent'")
    .run(text, messageId, id);
}
export function feedbackRecipients(): string[] {
  return (db.query("SELECT DISTINCT requester_id FROM service_cases WHERE followup_status IN ('sent','sending','send_uncertain')").all() as { requester_id: string }[]).map(row => row.requester_id);
}

export function claimPermission(requestId: string): boolean {
  return db.query("INSERT OR IGNORE INTO feedback_permissions(request_id,status) VALUES(?,'sending')").run(requestId).changes > 0;
}
export function permissionSent(requestId: string, messageId: string | null) {
  db.query("UPDATE feedback_permissions SET status=?,question_id=? WHERE request_id=?")
    .run(messageId ? "asked" : "uncertain", messageId, requestId);
}
export function pendingPermissions(recipient: string) {
  return db.query(`SELECT c.*,p.question_id FROM service_cases c JOIN feedback_permissions p ON p.request_id=c.request_id
    WHERE c.requester_id=? AND p.status='asked'`).all(recipient) as Array<ServiceCase & { question_id: string }>;
}
export function answerPermission(requestId: string, granted: boolean, responseId: string) {
  db.query("UPDATE feedback_permissions SET status=?,response_id=? WHERE request_id=? AND status='asked'")
    .run(granted ? "granted" : "declined", responseId, requestId);
}
export function shareableFeedback(requestId: string): boolean {
  return !!db.query("SELECT 1 FROM feedback_permissions WHERE request_id=? AND status='granted'").get(requestId);
}
export function claimSuggestion(requestId: string, sourceRequestId: string): boolean {
  return db.query("INSERT OR IGNORE INTO service_suggestions(request_id,source_request_id,status) VALUES(?,?,'sending')")
    .run(requestId, sourceRequestId).changes > 0;
}
export function suggestionSent(requestId: string, messageId: string | null) {
  db.query("UPDATE service_suggestions SET status=?,message_id=? WHERE request_id=?").run(messageId ? "sent" : "uncertain", messageId, requestId);
}
export function serviceCategory(value: string): string {
  const text = value.toLowerCase().trim();
  if (/real estate|estate agent|property agent|realtor/.test(text)) return "real estate";
  if (/plumb|geyser/.test(text)) return "plumbing";
  return text;
}

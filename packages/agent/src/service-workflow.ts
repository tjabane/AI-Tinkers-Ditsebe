import type { CapturedMessage } from "@ditsebe/whatsapp";
import { listMessages, redact } from "@ditsebe/api";
import { serviceCases, serviceEventSeen, markServiceEvent, recordRequest, recordRecommendation,
  claimFollowup, finishFollowup, pendingFeedback, saveFeedback,
  claimPermission, permissionSent, pendingPermissions, answerPermission, shareableFeedback,
  claimSuggestion, suggestionSent, serviceCategory, type ServiceCase } from "@ditsebe/api/services";
import type { createServiceDetector } from "./service-detector.ts";
import { log, logRef, errorFields } from "@ditsebe/whatsapp/logging";

export function createServiceWorkflow(options: {
  groupId: string;
  detect: ReturnType<typeof createServiceDetector>;
  send: (requestId: string, text: string) => Promise<{ id: string }>;
  sendGroup?: (message: CapturedMessage, text: string) => Promise<{ id: string }>;
}) {
  let queue = Promise.resolve();
  async function askPermission(item: ServiceCase) {
    if (!item.feedback || !claimPermission(item.request_id)) return;
    try {
      const sent = await options.send(item.request_id,
        `Thanks for your feedback about ${item.provider}. May I share your feedback anonymously in this group when someone asks for a recommendation? Reply YES or NO to this message. Your contact details will stay private.`);
      permissionSent(item.request_id, sent.id);
    } catch (error) { permissionSent(item.request_id, null); throw error; }
  }
  const handle = (message: CapturedMessage): Promise<void> => {
    if (message.fromMe || !message.text?.trim()) return Promise.resolve();
    if (message.isGroup && (message.chatId !== options.groupId || /^!ditsebe\b/i.test(message.text))) return Promise.resolve();
    const work = queue.then(async () => {
      if (serviceEventSeen(message.chatId, message.id)) return;
      if (!message.isGroup) {
        const permissions = pendingPermissions(message.chatId).filter(c => c.chat_id === options.groupId);
        const answer = message.text!.trim().toLowerCase().replace(/[.!]+$/, "");
        const permission = permissions.filter(c => message.quotedMessageId ? c.question_id === message.quotedMessageId : permissions.length === 1);
        if (permission.length === 1 && ["yes", "no"].includes(answer)) {
          answerPermission(permission[0]!.request_id, answer === "yes", message.id);
          markServiceEvent(message.chatId, message.id);
          log("INFO", "agent", "feedback_permission_recorded", { enabled: answer === "yes" });
          return;
        }
        const pending = pendingFeedback(message.chatId);
        const matching = pending.filter(c => c.chat_id === options.groupId &&
          (message.quotedMessageId ? c.followup_id === message.quotedMessageId : pending.length === 1));
        if (matching.length === 1) {
          saveFeedback(matching[0]!.request_id, redact(message.text!), message.id);
          markServiceEvent(message.chatId, message.id);
          log("INFO", "agent", "service_feedback_saved", { ref: logRef(matching[0]!.request_id) });
          await askPermission({ ...matching[0]!, feedback: redact(message.text!) });
        }
        return;
      }
      const cases = serviceCases(options.groupId);
      const started = performance.now();
      const event = await options.detect(message, listMessages({ chatId: options.groupId, limit: 40 }), cases);
      log("INFO", "agent", "service_event_detected", { status: event.kind, ref: logRef(message.id), duration_ms: Math.round(performance.now() - started) });
      if (event.kind === "request" && message.senderId) {
        recordRequest(message.id, message.chatId, message.senderId, redact(event.category ?? "service").slice(0, 100), message.timestamp);
        const candidates = cases.filter(c => c.provider && c.recommendation_id && c.request_id !== message.id &&
          c.requester_id !== message.senderId && serviceCategory(c.category) === serviceCategory(event.category ?? ""));
        candidates.sort((a, b) => Number(shareableFeedback(b.request_id)) - Number(shareableFeedback(a.request_id)));
        const previous = candidates[0];
        if (previous && options.sendGroup && claimSuggestion(message.id, previous.request_id)) {
          const feedback = previous.feedback && shareableFeedback(previous.request_id)
            ? ` A resident later gave this feedback, shared with their permission: "${redact(previous.feedback).slice(0, 800)}"`
            : " This is a previous group recommendation, not a verified service guarantee.";
          try {
            const sent = await options.sendGroup(message, `${previous.provider} was previously recommended in this group for ${previous.category}.${feedback}`);
            suggestionSent(message.id, sent.id);
            recordRecommendation(message.id, previous.provider!, sent.id);
          } catch (error) { suggestionSent(message.id, null); throw error; }
        }
      } else {
        const related = cases.find(c => c.request_id === event.request_id);
        if (related && event.kind === "recommendation" && event.provider?.trim()) {
          recordRecommendation(related.request_id, redact(event.provider).slice(0, 100), message.id);
        }
        if (related && event.kind === "service_used" && related.requester_id === message.senderId && related.provider &&
            event.provider?.trim().toLowerCase() === related.provider.trim().toLowerCase() && claimFollowup(related.request_id, message.id)) {
          // Persist the claim BEFORE sending. Ambiguous send failures are never retried automatically.
          try {
            const sent = await options.send(related.request_id,
              `Hi! It's Ditsebe, following up on your request for a ${related.category}. How was ${related.provider}'s service? What went well, and was there anything that could have been better?`);
            finishFollowup(related.request_id, sent.id);
            log("INFO", "agent", "service_followup_sent", { ref: logRef(related.request_id) });
          } catch (error) {
            finishFollowup(related.request_id, null);
            throw error;
          }
        }
      }
      markServiceEvent(message.chatId, message.id);
    });
    queue = work.catch(error => log("ERROR", "agent", "service_workflow_failed", errorFields(error)));
    return work;
  };
  return Object.assign(handle, { askPendingPermissions: async () => {
    for (const item of serviceCases(options.groupId)) {
      if (item.followup_status === "answered") await askPermission(item);
    }
  } });
}

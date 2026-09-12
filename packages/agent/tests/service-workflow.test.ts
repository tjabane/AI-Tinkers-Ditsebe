import { test, expect } from "bun:test";
process.env.DB_PATH = ":memory:";
process.env.PORT = "0";
const { createServiceWorkflow } = await import("../src/service-workflow.ts");
const { serviceCases } = await import("@ditsebe/api/services");
import type { CapturedMessage } from "@ditsebe/whatsapp";
import type { ServiceEvent } from "../src/service-detector.ts";

function message(group: string, id: string, sender = "requester"): CapturedMessage {
  return { id, chatId: group, chatName: "Demo", senderId: sender, senderName: null,
    fromMe: false, isGroup: true, text: id, type: "conversation", quotedMessageId: null, timestamp: Date.now(), raw: {} };
}
function detector(requestId: string) {
  return async (m: CapturedMessage): Promise<ServiceEvent> => ({
    kind: m.text === "request" ? "request" : m.text === "recommendation" ? "recommendation" : "service_used",
    request_id: requestId, provider: "Christy", category: "real estate agent",
  });
}

test("automatically follows up once with the requester and stores private feedback after restart", async () => {
  const group = "automatic-test@g.us";
  let sends = 0;
  const options = { groupId: group, detect: detector("request"), send: async (id: string, text: string) => {
    sends++; expect(id).toBe("request"); expect(text).toContain("Christy"); return { id: "dm-question" };
  } };
  const handle = createServiceWorkflow(options);
  await handle(message(group, "request"));
  await handle(message(group, "recommendation", "neighbour"));
  expect(sends).toBe(0);
  await handle(message(group, "neighbour-used", "neighbour"));
  expect(sends).toBe(0);
  await Promise.all([handle(message(group, "requester-used")), handle(message(group, "requester-used"))]);
  expect(sends).toBe(1);
  const restarted = createServiceWorkflow(options);
  await restarted(message(group, "another-positive-comment"));
  expect(sends).toBe(1);
  await restarted({ ...message("requester", "private-feedback"), isGroup: false, quotedMessageId: "dm-question", text: "Helpful and punctual" });
  expect(serviceCases(group)[0]).toMatchObject({ followup_status: "answered", feedback: "Helpful and punctual", feedback_message_id: "private-feedback" });
});

test("uncertain send failure is not automatically retried", async () => {
  const group = "uncertain-test@g.us";
  const request = { ...message(group, "request-2"), text: "request" };
  let sends = 0;
  const handle = createServiceWorkflow({ groupId: group, detect: detector(request.id), send: async () => { sends++; throw Error("send uncertainty"); } });
  await handle(request);
  await handle({ ...message(group, "recommendation-2", "neighbour"), text: "recommendation" });
  await expect(handle(message(group, "used-2"))).rejects.toThrow("send uncertainty");
  await handle(message(group, "used-2"));
  expect(sends).toBe(1);
  expect(serviceCases(group)[0]?.followup_status).toBe("send_uncertain");
});

test("ignores other groups and own messages", async () => {
  let calls = 0;
  const handle = createServiceWorkflow({ groupId: "only@g.us", detect: async () => { calls++; return { kind: "none", request_id: null, provider: null, category: null }; }, send: async () => { throw Error("should not send"); } });
  await handle(message("other@g.us", "request"));
  await handle({ ...message("only@g.us", "request"), fromMe: true });
  expect(calls).toBe(0);
});

test("later requester receives history, but private feedback only after permission", async () => {
  const store = await import("@ditsebe/api/services");
  const group = "recommend-again@g.us";
  store.recordRequest("original-estate", group, "original-resident", "real estate agent", 1);
  store.recordRecommendation("original-estate", "Christy", "neighbour-recommendation");
  store.claimFollowup("original-estate", "used");
  store.finishFollowup("original-estate", "feedback-question");
  store.saveFeedback("original-estate", "Patient and professional", "private-response");
  const replies: string[] = [];
  let permissionQuestions = 0;
  const handle = createServiceWorkflow({ groupId: group,
    detect: async () => ({ kind: "request", category: "estate agent", provider: null, request_id: null }),
    send: async () => { permissionQuestions++; return { id: "permission-question" }; },
    sendGroup: async (_, text) => { replies.push(text); return { id: "suggestion-" + replies.length }; },
  });
  await handle.askPendingPermissions();
  await handle.askPendingPermissions();
  expect(permissionQuestions).toBe(1);
  await handle(message(group, "new-request-a", "third-resident"));
  expect(replies[0]).toContain("Christy");
  expect(replies[0]).not.toContain("Patient and professional");
  await handle({ ...message("original-resident", "permission-yes"), isGroup: false, text: "YES", quotedMessageId: "permission-question" });
  await handle(message(group, "new-request-b", "fourth-resident"));
  expect(replies[1]).toContain("Patient and professional");
  expect(replies[1]).toContain("with their permission");
  await handle(message(group, "new-request-b", "fourth-resident"));
  expect(replies).toHaveLength(2);
});

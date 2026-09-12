// Uses the live LLM with an isolated in-memory store and a fake WhatsApp sender.
process.env.DB_PATH = ":memory:";
const { createServiceDetector } = await import("../src/service-detector.ts");
const { createServiceWorkflow } = await import("../src/service-workflow.ts");
const { serviceCases } = await import("@ditsebe/api/services");
if (!process.env.OPENAI_API_KEY) throw Error("OPENAI_API_KEY is required");
let sends = 0;
const groupId = "smoke@g.us";
const handle = createServiceWorkflow({ groupId,
  detect: createServiceDetector(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL ?? "gpt-5.5"),
  send: async (requestId, text) => {
    if (requestId !== "request" || !text.includes("Christy")) throw Error("Incorrect follow-up target/provider");
    sends++; return { id: "fake-dm" };
  },
});
const base = { chatId: groupId, chatName: "Demo", senderName: null, fromMe: false,
  isGroup: true, type: "conversation", quotedMessageId: null, timestamp: Date.now(), raw: {} };
await handle({ ...base, id: "request", senderId: "requester", text: "Can anyone recommend a real estate agent?" });
await handle({ ...base, id: "recommendation", senderId: "neighbour", quotedMessageId: "request", text: "I have used Christy, she is wonderful." });
if (sends !== 0) throw Error("Follow-up sent before requester reported using the service");
const used = { ...base, id: "used", senderId: "requester", text: "Hi, Christy was great help" };
await handle(used);
await handle(used);
if (Number(sends) !== 1) throw Error("Expected one automatic follow-up");
await handle({ ...base, id: "feedback", chatId: "requester", senderId: "requester", isGroup: false,
  quotedMessageId: "fake-dm", text: "Very helpful and professional." });
if (serviceCases(groupId)[0]?.followup_status !== "answered") throw Error("Feedback was not saved");
console.log("PASS: live LLM recognised request, recommendation and service use; one mock private follow-up and feedback saved. No WhatsApp messages sent.");

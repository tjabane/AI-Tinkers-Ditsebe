export const config = {
 llmEnabled: (process.env.LLM_ENABLED ?? "true") === "true",
 model: process.env.OPENAI_MODEL ?? "gpt-5.5",
 targetChatId: process.env.AGENT_GROUP_ID ?? "120363431475712196@g.us",
 webhookUrl: process.env.WEBHOOK_URL ?? "",
 webhookToken: process.env.WEBHOOK_TOKEN ?? "",
};

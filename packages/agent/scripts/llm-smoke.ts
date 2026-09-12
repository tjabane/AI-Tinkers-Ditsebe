import { createReplyGenerator } from "../src/llm.ts";
import { config } from "../src/config.ts";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY in the root .env before running this check");
const generate = createReplyGenerator(apiKey, config.model);
const reply = await generate({
  question: "Who recommended a plumber, and what was their name?",
  history: [{
    id: "smoke-context", chat_id: "smoke@g.us", chat_name: "Test", is_group: 1,
    sender_id: "sam", sender_name: "Sam", from_me: 0, type: "conversation",
    text: "I recommend Alex the plumber. Alex repaired my geyser.",
    quoted_message_id: null, timestamp: Date.now(),
  }],
});
if (!/Resident-/i.test(reply) || !/Alex/i.test(reply)) {
  throw new Error("The live response did not identify the anonymous recommender and Alex: " + reply);
}
console.log("PASS: live LLM used supplied conversation history. No WhatsApp message was sent.");
console.log(reply);

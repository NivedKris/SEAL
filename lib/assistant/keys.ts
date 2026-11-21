import "server-only";
import { env } from "@/lib/env";

/**
 * The assistant (chat and live voice) runs on its own keys, ideally in its own Google project and
 * Groq organisation, so a long voice session can never use up the limits SEAL's claim checks need.
 * Falls back to the main keys when the assistant keys are not set.
 */
export const assistantGeminiKey = () => process.env.ASSISTANT_GEMINI_API_KEY || process.env.GOOGLE_API_KEY_2 || env.GEMINI_API_KEY;
export const assistantGroqKey = () => process.env.ASSISTANT_GROQ_API_KEY || process.env.GROQ_API_KEY2 || process.env.GROQ_API_KEY;

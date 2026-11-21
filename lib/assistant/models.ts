/**
 * Models for the assistant (Google AI Studio, the same key as the rest of SEAL). Live model IDs
 * were verified against this key by opening sessions with them.
 */
/** Voice: talks, listens and calls SEAL's tools. The second is used if the first is unavailable. */
export const LIVE_MODELS = ["gemini-3.8-live", "gemini-2.5-flash-native-audio-preview-09-2025"];
export const LIVE_VOICE = "Aoede";
/** Speech to text only (the consultation scribe). */
export const TRANSCRIBE_MODEL = "gemini-3.5-transcribe-live";
/** Typed questions run on Groq first (SEAL's main text AI). */
/** Each Groq model has its own rate limit, so the smaller one takes over when the larger is at its limit. */
export const GROQ_CHAT_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
/** Gemini fallback for typed questions. Tried in order; the next one is used when a model is busy or rate-limited. */
export const CHAT_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];
/** Per-request limit, so a busy model fails over quickly instead of hanging. */
export const CHAT_TIMEOUT_MS = 25_000;

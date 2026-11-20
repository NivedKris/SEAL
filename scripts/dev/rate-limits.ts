/** Dev check: read Groq rate-limit headers per model, and one Gemini call per fallback model. */
import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";

async function main() {
  const g = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 });
  for (const model of ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]) {
    try {
      const { response } = await g.chat.completions
        .create({ model, messages: [{ role: "user", content: "Say ok" }], max_completion_tokens: 20 })
        .withResponse();
      const h = (k: string) => response.headers.get(k);
      console.log(model, "| RPM", h("x-ratelimit-limit-requests"), "| TPM", h("x-ratelimit-limit-tokens"), "| remaining tokens", h("x-ratelimit-remaining-tokens"));
    } catch (e) {
      console.log(model, "ERROR", (e as Error).message.slice(0, 200));
    }
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  for (const model of ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"]) {
    const s = Date.now();
    try {
      const r = await Promise.race([
        ai.models.generateContent({ model, contents: "Say ok", config: { thinkingConfig: { thinkingLevel: "LOW" as never } } }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout 20s")), 20000)),
      ]);
      console.log(model, Date.now() - s, "ms", (r.text ?? "").slice(0, 20));
    } catch (e) {
      console.log(model, Date.now() - s, "ms ERROR", (e as Error).message.slice(0, 160));
    }
  }
  process.exit(0);
}
main();

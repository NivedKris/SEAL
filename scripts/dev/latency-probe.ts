/** Dev check: raw provider latency for each request mode, outside the router. */
import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";

async function t(label: string, f: () => Promise<string>) {
  const s = Date.now();
  try {
    const out = await f();
    console.log(label, Date.now() - s, "ms", JSON.stringify(out).slice(0, 80));
  } catch (e) {
    console.log(label, Date.now() - s, "ms ERROR", (e as Error).message.slice(0, 160));
  }
}

async function main() {
  const g = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 });
  const msg = [{ role: "user" as const, content: 'Reply as JSON {"answer": string}. What family is MNEC-005?' }];
  const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
  for (const model of ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]) {
    await t(`groq ${model} json_object`, async () => (await g.chat.completions.create({ model, messages: msg, response_format: { type: "json_object" }, max_completion_tokens: 800 })).choices[0].message.content ?? "");
    await t(`groq ${model} json_schema low`, async () =>
      (await g.chat.completions.create({ model, messages: msg, response_format: { type: "json_schema", json_schema: { name: "o", schema, strict: false } }, reasoning_effort: "low", max_completion_tokens: 800 })).choices[0].message.content ?? "");
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  for (const model of ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-latest"]) {
    await t(`gemini ${model} low`, async () =>
      (await ai.models.generateContent({ model, contents: msg[0].content, config: { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "LOW" as never } } })).text ?? "");
  }
}
main();

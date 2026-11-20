/** Dev check: is the Gemini embedding quota available (batch of 3, 256 dims)? */
import { GoogleGenAI } from "@google/genai";

async function main() {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  const s = Date.now();
  try {
    const texts = ["lumbar MRI refused", "HbA1c repeated early", "vitamin D screening"];
    const r = await ai.models.embedContent({
      model: "gemini-embedding-2",
      contents: texts.map((t) => ({ role: "user", parts: [{ text: t }] })),
      config: { outputDimensionality: 256, taskType: "SEMANTIC_SIMILARITY" },
    });
    console.log("ok", Date.now() - s, "ms", r.embeddings?.length, "vectors of", r.embeddings?.[0]?.values?.length);
  } catch (e) {
    console.log("ERROR", Date.now() - s, "ms", (e as Error).message.slice(0, 300));
  }
}
main();

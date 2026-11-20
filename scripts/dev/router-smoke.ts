/** Dev check: router (Groq + forced Gemini fallback), masking flag, and code-pattern matching. */
import { z } from "zod";
import { callJson, setCallSink } from "@/lib/ai/router";
import { codeMatches } from "@/lib/rules/engine";
import { SEED_RULES } from "@/lib/rules/library";

async function main() {
  const S = z.object({ answer: z.string(), confidence: z.number().min(0).max(1) });
  setCallSink((c) =>
    console.log(`  log: ${c.provider}/${c.model} ${c.status} ${c.latencyMs}ms fallback=${c.fallbackUsed} masked=${c.maskingPassed} cost=$${c.cost.toFixed(6)}`),
  );
  for (const disableGroq of [false, true]) {
    const r = await callJson({
      agent: "denialReader",
      promptVersion: "smoke-v1",
      system: "Reply in JSON {answer, confidence}.",
      user: "Patient 784-1990-1234567-1 asks: what family is MNEC-005?",
      schema: S,
      disableGroq,
    });
    console.log(disableGroq ? "gemini:" : "groq:", r.data);
  }
  const cases: [string, string, boolean][] = [
    ["72141-72158", "72148", true],
    ["72141-72158", "72159", false],
    ["E11*", "E11.65", true],
    ["M72.2*", "M72.21", true],
    ["E11.2*", "E11.65", false],
    ["97010-97799", "97110", true],
    ["0101T", "0101T", true],
    ["R94.6", "R94.6", true],
  ];
  for (const [p, c, want] of cases) if (codeMatches(p, c) !== want) throw new Error(`codeMatches(${p},${c}) != ${want}`);
  console.log("patterns ok;", SEED_RULES.length, "rules loaded");
}
main();

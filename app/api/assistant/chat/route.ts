import { GoogleGenAI, ThinkingLevel, type Content, type FunctionDeclaration } from "@google/genai";
import Groq from "groq-sdk";
import type { Db } from "mongodb";
import { z } from "zod";
import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { assistantGeminiKey, assistantGroqKey } from "@/lib/assistant/keys";
import { currentTenant } from "@/lib/tenant-server";
import { ALL_TOOLS, isWriteTool, runReadTool, systemInstruction } from "@/lib/assistant/tools";
import { CHAT_MODELS, CHAT_TIMEOUT_MS, GROQ_CHAT_MODELS } from "@/lib/assistant/models";
import type { AssistantContext } from "@/lib/assistant/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).min(1).max(40),
  context: z.object({ path: z.string(), encounterId: z.string().optional(), claimId: z.string().optional(), questionSetId: z.string().optional() }),
});

/** Typed questions: the model looks things up with SEAL's tools; any change comes back as a proposal. */
export async function POST(req: Request) {
  return handle(async () => {
    const { messages, context } = Body.parse(await req.json());
    const [d, tenant] = await Promise.all([db(), currentTenant()]);
    const system = systemInstruction(tenant.hospital, context, false);
    // Groq first (SEAL's main text AI), Gemini if Groq is unavailable.
    try {
      return await groqChat(d, system, messages, context);
    } catch (e) {
      console.warn("assistant: groq failed, trying gemini:", (e as Error).message.slice(0, 160));
    }
    const ai = new GoogleGenAI({ apiKey: assistantGeminiKey(), httpOptions: { timeout: CHAT_TIMEOUT_MS } });
    const contents: Content[] = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] }));
    const proposals: { id: string; tool: string; args: Record<string, unknown> }[] = [];
    const looked: string[] = [];
    for (let step = 0; step < 6; step++) {
      const r = await generate(ai, { contents, config: { systemInstruction: system, tools: [{ functionDeclarations: ALL_TOOLS }], temperature: 0.3, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } });
      const calls = r.functionCalls ?? [];
      if (!calls.length) return { reply: r.text ?? "", proposals, looked };
      const turn = r.candidates?.[0]?.content;
      if (turn) contents.push(turn);
      const parts: Content["parts"] = [];
      for (const fc of calls) {
        const name = fc.name ?? "";
        const args = (fc.args ?? {}) as Record<string, unknown>;
        if (isWriteTool(name)) {
          proposals.push({ id: `${Date.now()}-${proposals.length}`, tool: name, args });
          parts.push({ functionResponse: { id: fc.id, name, response: { status: "Proposed. It is on the person's screen waiting for them to accept or reject." } } });
        } else {
          looked.push(name);
          const result = await runReadTool(d, name, args, context).catch((e) => ({ error: (e as Error).message }));
          parts.push({ functionResponse: { id: fc.id, name, response: { result } } });
        }
      }
      contents.push({ role: "user", parts });
    }
    return { reply: "I looked into it but could not finish in time. Try asking a narrower question.", proposals, looked };
  });
}

/** Busy or rate-limited models fall through to the next one, so the assistant stays up. */
async function generate(ai: GoogleGenAI, req: Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">) {
  let last: unknown;
  for (const model of CHAT_MODELS) {
    try {
      return await ai.models.generateContent({ ...req, model });
    } catch (e) {
      last = e;
      if (!/\b(503|504|429|UNAVAILABLE|DEADLINE_EXCEEDED|RESOURCE_EXHAUSTED|NOT_FOUND|404|aborted|timeout|timed out)\b/i.test(String((e as Error).message ?? e))) throw e;
    }
  }
  throw last;
}

type Proposal = { id: string; tool: string; args: Record<string, unknown> };
const PROPOSED = "Proposed. It is on the person's screen waiting for them to accept or reject.";

/** Gemini's declaration format → JSON Schema for Groq (type names are lower-case there). */
function toJsonSchema(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(toJsonSchema);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === "type" && typeof v === "string" ? v.toLowerCase() : toJsonSchema(v)]));
  return x;
}
const groqTools = (decls: FunctionDeclaration[]) =>
  decls.map((f) => ({ type: "function" as const, function: { name: f.name!, description: f.description, parameters: toJsonSchema(f.parameters ?? { type: "object", properties: {} }) as Record<string, unknown> } }));

type GroqToolCall = { id: string; function: { name: string; arguments: string } };
type GroqMsg = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: GroqToolCall[]; tool_call_id?: string };

async function groqChat(d: Db, system: string, messages: { role: "user" | "assistant"; text: string }[], context: AssistantContext) {
  const groq = new Groq({ apiKey: assistantGroqKey(), maxRetries: 0, timeout: CHAT_TIMEOUT_MS });
  const msgs: GroqMsg[] = [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.text }))];
  const proposals: Proposal[] = [];
  const looked: string[] = [];
  for (let step = 0; step < 6; step++) {
    type Reply = { choices: { message: { content?: string | null; tool_calls?: GroqToolCall[] } }[] };
    let r: Reply | null = null;
    let lastErr: unknown;
    for (const model of GROQ_CHAT_MODELS) {
      try {
        r = (await groq.chat.completions.create({ model, messages: msgs, tools: groqTools(ALL_TOOLS), tool_choice: "auto", temperature: 0.3, reasoning_effort: "low" } as never)) as unknown as Reply;
        break;
      } catch (e) {
        lastErr = e;
        // rate limit or overloaded: try the next Groq model (its own limit) before giving up on Groq
        if (!/\b(429|503|rate limit|over capacity)\b/i.test(String((e as Error).message))) throw e;
      }
    }
    if (!r) throw lastErr;
    const m = r.choices[0].message;
    if (!m.tool_calls?.length) return { reply: m.content ?? "", proposals, looked, engine: "groq" };
    msgs.push({ role: "assistant", content: m.content ?? "", tool_calls: m.tool_calls });
    for (const tc of m.tool_calls) {
      const name = tc.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {}
      let content: unknown;
      if (isWriteTool(name)) {
        proposals.push({ id: `${Date.now()}-${proposals.length}`, tool: name, args });
        content = { status: PROPOSED };
      } else {
        looked.push(name);
        content = { result: await runReadTool(d, name, args, context).catch((e) => ({ error: (e as Error).message })) };
      }
      msgs.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(content).slice(0, 7000) });
    }
  }
  return { reply: "I looked into it but could not finish in time. Try a narrower question.", proposals, looked, engine: "groq" };
}

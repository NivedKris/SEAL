import "server-only";
import { GoogleGenAI, ThinkingLevel, type Content, type FunctionDeclaration } from "@google/genai";
import Groq from "groq-sdk";
import type { Db } from "mongodb";
import { assistantGeminiKey, assistantGroqKey } from "./keys";
import { CHAT_MODELS, CHAT_TIMEOUT_MS, GROQ_CHAT_MODELS } from "./models";
import { ALL_TOOLS, isScreenTool, isWriteTool, runReadTool, screenAnswer, type AssistantContext } from "./tools";
import { pathFor, type Destination } from "./sitemap";

/**
 * The typed assistant: the model looks things up with SEAL's tools and answers. Changes come back as
 * proposals (with ids); moving around SEAL comes back as screen actions the browser carries out.
 * Used by /api/assistant/chat and by the assistant test set (scripts/assistant-eval.ts).
 */
export type Proposal = { id: string; tool: string; args: Record<string, unknown> };
export type ScreenAction = { tool: string; args: Record<string, unknown> };
export type AgentResult = { reply: string; proposals: Proposal[]; actions: ScreenAction[]; looked: string[]; engine: string };
export type ChatMsg = { role: "user" | "assistant"; text: string };

const PROPOSED = "Proposed (nothing changed yet). It is on the person's screen; ask them whether to go ahead.";
let seq = 0;
const newId = () => `p${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}`;

/** What a tool call does in the typed assistant (the voice session does the same in the browser). */
async function act(d: Db, name: string, args: Record<string, unknown>, ctx: AssistantContext, out: AgentResult): Promise<unknown> {
  if (isWriteTool(name)) {
    const id = newId();
    out.proposals.push({ id, tool: name, args });
    return { status: PROPOSED, proposalId: id };
  }
  if (isScreenTool(name)) {
    if (name === "get_screen") {
      out.looked.push(name);
      return screenAnswer(ctx);
    }
    if (name === "navigate" || name === "offer_navigation") {
      const to = pathFor(args as unknown as Destination);
      if ("error" in to) return { error: to.error };
      out.actions.push({ tool: name, args: { ...args, path: to.path, label: to.label } });
      return name === "navigate" ? { status: `Opened ${to.label} on the person's screen.` } : { status: `Shown as a "Take me there" button for ${to.label}. Ask if they want to go.` };
    }
    out.actions.push({ tool: name, args });
    return { status: name === "confirm_change" ? "Carried out on screen." : name === "reject_change" ? "Dropped." : "Done on screen." };
  }
  out.looked.push(name);
  return { result: await runReadTool(d, name, args, ctx).catch((e) => ({ error: (e as Error).message })) };
}

/** Groq first (SEAL's main text AI), Gemini if Groq is unavailable. */
export async function runAgent(d: Db, system: string, messages: ChatMsg[], ctx: AssistantContext, opts: { engine?: "groq" | "gemini" } = {}): Promise<AgentResult> {
  if (opts.engine !== "gemini") {
    try {
      return await groqAgent(d, system, messages, ctx);
    } catch (e) {
      if (opts.engine === "groq") throw e;
      console.warn("assistant: groq failed, trying gemini:", (e as Error).message.slice(0, 160));
    }
  }
  return geminiAgent(d, system, messages, ctx);
}

async function geminiAgent(d: Db, system: string, messages: ChatMsg[], ctx: AssistantContext): Promise<AgentResult> {
  const ai = new GoogleGenAI({ apiKey: assistantGeminiKey(), httpOptions: { timeout: CHAT_TIMEOUT_MS } });
  const contents: Content[] = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] }));
  const out: AgentResult = { reply: "", proposals: [], actions: [], looked: [], engine: "gemini" };
  for (let step = 0; step < 6; step++) {
    const r = await generate(ai, { contents, config: { systemInstruction: system, tools: [{ functionDeclarations: ALL_TOOLS }], temperature: 0.3, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } });
    const calls = r.functionCalls ?? [];
    if (!calls.length) return { ...out, reply: r.text ?? "" };
    const turn = r.candidates?.[0]?.content;
    if (turn) contents.push(turn);
    const parts: Content["parts"] = [];
    for (const fc of calls) {
      const response = (await act(d, fc.name ?? "", (fc.args ?? {}) as Record<string, unknown>, ctx, out)) as Record<string, unknown>;
      parts.push({ functionResponse: { id: fc.id, name: fc.name, response } });
    }
    contents.push({ role: "user", parts });
  }
  return { ...out, reply: "I looked into it but could not finish in time. Try asking a narrower question." };
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

async function groqAgent(d: Db, system: string, messages: ChatMsg[], ctx: AssistantContext): Promise<AgentResult> {
  const groq = new Groq({ apiKey: assistantGroqKey(), maxRetries: 0, timeout: CHAT_TIMEOUT_MS });
  const msgs: GroqMsg[] = [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.text }))];
  const out: AgentResult = { reply: "", proposals: [], actions: [], looked: [], engine: "groq" };
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
    if (!m.tool_calls?.length) return { ...out, reply: m.content ?? "" };
    msgs.push({ role: "assistant", content: m.content ?? "", tool_calls: m.tool_calls });
    for (const tc of m.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {}
      const content = await act(d, tc.function.name, args, ctx, out);
      msgs.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(content).slice(0, 7000) });
    }
  }
  return { ...out, reply: "I looked into it but could not finish in time. Try a narrower question." };
}

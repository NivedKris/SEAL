import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AGENTS, PRICING, type AgentName, type AgentModelConfig } from "@/config/models";
import type { AiCallDoc } from "@/lib/db/schemas";
import { maskIdentifiers, maskingPassed } from "./mask";

/**
 * One router for every model call (plan §7): Groq first, Gemini on error, timeout,
 * rate limit or invalid output. Outputs are JSON validated with Zod, with one retry.
 * Every attempt sequence produces one AiCall record for AI Health.
 *
 * No `server-only` import so the seed scripts can use it too; it reads keys from
 * process.env and must never be imported by client components.
 */

export type CallOptions<T> = {
  agent: AgentName | "seedTemplateBuilder";
  promptVersion: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Override the agent config (e.g. a model switched in /admin). */
  config?: Partial<AgentModelConfig>;
  subject?: AiCallDoc["subject"];
  /** Skip Groq (used when Groq is disabled to prove the fallback). */
  disableGroq?: boolean;
};

export type CallResult<T> = { data: T; call: AiCallDoc };

export type CallSink = (call: AiCallDoc) => Promise<void> | void;
let sink: CallSink = () => {};
/** Where AiCall records go (MongoDB in the app, a file in seed scripts). */
export function setCallSink(s: CallSink) {
  sink = s;
}

let groqClient: Groq | null = null;
let geminiClient: GoogleGenAI | null = null;
const groq = () => (groqClient ??= new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 }));
const gemini = () => (geminiClient ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY }));

const cost = (model: string, tin: number, tout: number) => {
  const [i, o] = PRICING[model] ?? [0, 0];
  return (tin * i + tout * o) / 1_000_000;
};

class AttemptError extends Error {
  constructor(
    message: string,
    public kind: "error" | "timeout" | "invalid_output",
  ) {
    super(message);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new AttemptError(`timeout after ${ms} ms`, "timeout")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    throw new AttemptError("output is not valid JSON", "invalid_output");
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new AttemptError(`schema: ${r.error.issues.slice(0, 5).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, "invalid_output");
  return r.data;
}

type Attempt = { text: string; tin: number; tout: number };

/** gpt-oss models support Groq structured outputs (JSON schema); others get JSON mode. */
const supportsJsonSchema = (model: string) => model.startsWith("openai/gpt-oss");

async function groqAttempt(model: string, cfg: AgentModelConfig, system: string, user: string, jsonSchema: Record<string, unknown>): Promise<Attempt> {
  const isOss = supportsJsonSchema(model);
  try {
    const r = await withTimeout(
      groq().chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: isOss
          ? { type: "json_schema", json_schema: { name: "output", schema: jsonSchema, strict: false } }
          : { type: "json_object" },
        ...(isOss ? { reasoning_effort: effort(cfg) } : {}),
        temperature: cfg.temperature,
        max_completion_tokens: cfg.maxTokens,
      }),
      cfg.timeoutMs,
    );
    return { text: r.choices[0]?.message?.content ?? "", tin: r.usage?.prompt_tokens ?? 0, tout: r.usage?.completion_tokens ?? 0 };
  } catch (e) {
    // Groq rejects generations that fail its JSON check with a 400; treat as invalid output so we retry once.
    if (/json_validate_failed|Failed to validate JSON|did not match schema/i.test((e as Error).message))
      throw new AttemptError((e as Error).message.slice(0, 200), "invalid_output");
    throw e;
  }
}

/** Fallback calls get more time than the latency target: correctness beats speed once Groq has failed. */
const FALLBACK_TIMEOUT_FACTOR = 1.5;
const FALLBACK_MIN_TIMEOUT_MS = 20_000;
/** Per-instance memory of models that just timed out or were overloaded: try healthy ones first for 2 min. */
const unhealthy = new Map<string, number>();
const UNHEALTHY_MS = 120_000;
const isHealthy = (model: string) => Date.now() - (unhealthy.get(model) ?? 0) > UNHEALTHY_MS;
const effort = (cfg: AgentModelConfig) => cfg.reasoningEffort ?? (cfg.targetMs <= 2000 ? "low" : "medium");
/** Groq rate-limit errors say "Please try again in 1.234s"; waiting that long beats a slow fallback. */
const MAX_RATE_LIMIT_WAIT_MS = 8000;
function retryAfterMs(e: unknown): number | null {
  const m = /try again in (?:(\d+)m)?([\d.]+)(ms|s)/i.exec((e as Error).message ?? "");
  if (!m || (e as { status?: number }).status !== 429) return null;
  return (Number(m[1] ?? 0) * 60 + Number(m[2]) / (m[3] === "ms" ? 1000 : 1)) * 1000;
}

async function geminiAttempt(model: string, cfg: AgentModelConfig, system: string, user: string, jsonSchema: unknown): Promise<Attempt> {
  const r = await withTimeout(
    gemini().models.generateContent({
      model,
      contents: user,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        // Recursive schemas (e.g. the rule DSL) aren't accepted as response schemas: plain JSON, validated by Zod after.
        ...(JSON.stringify(jsonSchema).includes('"$ref"') ? {} : { responseJsonSchema: jsonSchema }),
        temperature: cfg.temperature,
        maxOutputTokens: cfg.maxTokens,
        thinkingConfig: { thinkingLevel: (effort(cfg) === "low" ? "LOW" : "MEDIUM") as never },
      },
    }),
    Math.max(FALLBACK_MIN_TIMEOUT_MS, Math.round(cfg.timeoutMs * FALLBACK_TIMEOUT_FACTOR)),
  );
  return { text: r.text ?? "", tin: r.usageMetadata?.promptTokenCount ?? 0, tout: r.usageMetadata?.candidatesTokenCount ?? 0 };
}

/** Call a model for a validated JSON object. Throws only if every provider fails. */
export async function callJson<T>(opts: CallOptions<T>): Promise<CallResult<T>> {
  const base = opts.agent === "seedTemplateBuilder" ? AGENTS.orderJustification : AGENTS[opts.agent];
  const cfg: AgentModelConfig = { ...base, ...opts.config };
  const system = maskIdentifiers(opts.system);
  const user = maskIdentifiers(opts.user);
  const masked = maskingPassed(system + user);
  const jsonSchema = z.toJSONSchema(opts.schema, { target: "draft-7", unrepresentable: "any" });
  const started = Date.now();
  let tin = 0;
  let tout = 0;
  let spend = 0;
  const errors: string[] = [];

  const plan: { provider: "groq" | "gemini"; model: string }[] = [
    ...(opts.disableGroq ? [] : [{ provider: "groq" as const, model: cfg.groqModel }]),
    ...[...cfg.geminiModels].sort((a, b) => Number(isHealthy(b)) - Number(isHealthy(a))).map((m) => ({ provider: "gemini" as const, model: m })),
  ];

  for (const [i, step] of plan.entries()) {
    // One retry with the validation error fed back, on the same model.
    let prompt = user;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const a =
          step.provider === "groq"
            ? await groqAttempt(step.model, cfg, system, prompt, jsonSchema as Record<string, unknown>)
            : await geminiAttempt(step.model, cfg, system, prompt, jsonSchema);
        tin += a.tin;
        tout += a.tout;
        spend += cost(step.model, a.tin, a.tout);
        const data = parseJson(a.text, opts.schema);
        const call: AiCallDoc = {
          _id: randomUUID(),
          agent: opts.agent,
          provider: step.provider,
          model: step.model,
          promptVersion: opts.promptVersion,
          tokensIn: tin,
          tokensOut: tout,
          cost: spend,
          latencyMs: Date.now() - started,
          status: "ok",
          fallbackUsed: i > 0 || !!opts.disableGroq,
          guardrailFlags: [],
          maskingPassed: masked,
          subject: opts.subject,
          error: errors.length ? errors.join(" | ").slice(0, 500) : undefined,
          at: new Date().toISOString(),
        };
        await sink(call);
        return { data, call };
      } catch (e) {
        const msg = `${step.provider}/${step.model}: ${(e as Error).message}`.slice(0, 300);
        errors.push(msg);
        if (step.provider === "gemini" && /timeout|503|UNAVAILABLE|overloaded|high demand/i.test(msg)) unhealthy.set(step.model, Date.now());
        if (e instanceof AttemptError && e.kind === "invalid_output" && attempt === 0) {
          prompt = `${user}\n\nYour previous answer was rejected: ${e.message}. Reply again with one JSON object that fits the schema exactly.`;
          continue;
        }
        const wait = step.provider === "groq" && attempt === 0 ? retryAfterMs(e) : null;
        if (wait !== null && wait <= MAX_RATE_LIMIT_WAIT_MS) {
          await new Promise((r) => setTimeout(r, wait + 150));
          continue;
        }
        break; // error, timeout or rate limit → next provider
      }
    }
  }

  const call: AiCallDoc = {
    _id: randomUUID(),
    agent: opts.agent,
    provider: "none",
    model: plan.map((p) => p.model).join(" → "),
    promptVersion: opts.promptVersion,
    tokensIn: tin,
    tokensOut: tout,
    cost: spend,
    latencyMs: Date.now() - started,
    status: errors.some((e) => e.includes("timeout")) ? "timeout" : errors.some((e) => e.includes("schema") || e.includes("JSON")) ? "invalid_output" : "error",
    fallbackUsed: true,
    guardrailFlags: [],
    maskingPassed: masked,
    subject: opts.subject,
    error: errors.join(" | ").slice(0, 1000),
    at: new Date().toISOString(),
  };
  await sink(call);
  throw Object.assign(new Error(`all providers failed for ${opts.agent}: ${call.error}`), { call });
}

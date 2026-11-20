/**
 * Model router settings (plan §2, §7). One entry per agent.
 * Picked from the live Groq and Gemini catalogues on 2026-11-19:
 *   Groq reasoning: openai/gpt-oss-120b   · Groq fast: openai/gpt-oss-20b
 *   Groq critic:    qwen/qwen3.8-27b      (a different model from the ones it checks)
 *   Gemini fallback: gemini-3.8-flash, then gemini-3.5-flash
 *   Embeddings:      local bge-small-en-v1.5 via transformers.js (384 dims, float32) — no API quota
 */

export const GROQ = {
  reasoning: "openai/gpt-oss-120b",
  fast: "openai/gpt-oss-20b",
  critic: "qwen/qwen3.8-27b",
} as const;

export const GEMINI = {
  fallback: ["gemini-3.8-flash", "gemini-3.5-flash"],
} as const;

/** Local embedding model (ONNX on CPU via @huggingface/transformers). Changing it means re-embedding every outcome. */
export const EMBEDDING = {
  model: "Xenova/bge-small-en-v1.5",
  dims: 384,
  dtype: "q8",
  pooling: "cls",
} as const;

export type AgentName =
  | "orderCheckerLive"
  | "orderJustification"
  | "claimJudge"
  | "questionComposer"
  | "answerIntegrator"
  | "denialReader"
  | "recoveryDrafter"
  | "ruleMiner"
  | "critic";

export type AgentModelConfig = {
  groqModel: string;
  geminiModels: readonly string[];
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  /** Latency target from plan §7, used by AI Health alerts. */
  targetMs: number;
  /** Reasoning effort (Groq gpt-oss) / thinking level (Gemini). Default: low under 2 s targets, else medium. */
  reasoningEffort?: "low" | "medium";
};

const fast = (targetMs: number, maxTokens = 1500): AgentModelConfig => ({
  groqModel: GROQ.fast,
  geminiModels: GEMINI.fallback,
  temperature: 0.1,
  maxTokens,
  timeoutMs: Math.max(targetMs * 3, 6000),
  targetMs,
});

const reasoning = (targetMs: number, maxTokens = 4000): AgentModelConfig => ({
  groqModel: GROQ.reasoning,
  geminiModels: GEMINI.fallback,
  temperature: 0.2,
  maxTokens,
  timeoutMs: Math.max(targetMs * 2, 15000),
  targetMs,
});

export const AGENTS: Record<AgentName, AgentModelConfig> = {
  orderCheckerLive: fast(1000, 2000),
  orderJustification: reasoning(6000),
  // Low effort keeps the judgement inside the 5 s target; quality checked with scripts/dev/phase4-check.ts.
  claimJudge: { ...reasoning(5000, 3000), reasoningEffort: "low" },
  questionComposer: fast(2000, 2500),
  answerIntegrator: reasoning(5000),
  denialReader: fast(2000),
  recoveryDrafter: reasoning(15000, 6000),
  ruleMiner: reasoning(30000, 6000),
  critic: { ...fast(2000), groqModel: GROQ.critic },
};

/** USD per 1M tokens [input, output]. Verify against provider pricing pages before relying on cost panels. */
export const PRICING: Record<string, [number, number]> = {
  "openai/gpt-oss-120b": [0.15, 0.6],
  "openai/gpt-oss-20b": [0.075, 0.3],
  "qwen/qwen3.8-27b": [0.29, 0.59],
  "gemini-3.8-flash": [0.3, 2.5],
  "gemini-3.5-flash": [0.3, 2.5],
};

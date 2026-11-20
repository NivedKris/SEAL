import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "mongodb";
import { AGENTS, type AgentName } from "@/config/models";
import { COLLECTIONS as C, type AiCallDoc, type SettingsDoc } from "@/lib/db/schemas";
import { callJson, setCallSink, type CallOptions, type CallResult } from "./router";

/**
 * Server-side entry for every agent call: applies /admin settings (kill switch → rules only,
 * model override), logs each call to aiCalls (AI Health reads only that log), and loads
 * versioned prompts from /prompts/<agent>/<version>.md.
 */

let sinkDb: Db | null = null;
function ensureSink(d: Db) {
  if (sinkDb === d) return;
  sinkDb = d;
  setCallSink(async (call) => {
    await d.collection<AiCallDoc>(C.aiCalls).insertOne(call);
  });
}

const promptCache = new Map<string, string>();
export function loadPrompt(dir: string, version: string): string {
  const key = `${dir}/${version}`;
  if (!promptCache.has(key)) promptCache.set(key, readFileSync(join(process.cwd(), "prompts", dir, `${version}.md`), "utf8"));
  return promptCache.get(key)!;
}

export class AgentDisabled extends Error {
  constructor(public agent: AgentName) {
    super(`${agent} is switched off in /admin (rules-only fallback)`);
  }
}

async function settings(d: Db): Promise<SettingsDoc | null> {
  return (await d.collection(C.settings).findOne({ _id: "settings" as never })) as SettingsDoc | null;
}

/** Run an agent through the router. Throws AgentDisabled when its kill switch is on. */
export async function runAgent<T>(d: Db, opts: CallOptions<T> & { agent: AgentName }): Promise<CallResult<T>> {
  ensureSink(d);
  const s = await settings(d);
  if (s?.killSwitches?.[opts.agent]) throw new AgentDisabled(opts.agent);
  const override = s?.modelOverrides?.[opts.agent];
  const disableGroq = opts.disableGroq ?? !!s?.killSwitches?.groq;
  const config = override ? { ...opts.config, groqModel: override } : opts.config;
  return callJson({ ...opts, config, disableGroq });
}

/** Record the critic's verdict and guardrail flags on an earlier call (AI Health safety panel). */
export async function annotateCall(d: Db, callId: string, patch: Partial<Pick<AiCallDoc, "criticResult" | "guardrailFlags">>) {
  await d.collection<AiCallDoc>(C.aiCalls).updateOne({ _id: callId }, { $set: patch });
}

export { AGENTS };

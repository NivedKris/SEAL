import "server-only";
import type { Db } from "mongodb";
import { z } from "zod";
import { DocConcept, type Rule } from "@/lib/rules/dsl";
import type { RuleHit } from "@/lib/rules/engine";
import { CONCEPT_TEXT } from "@/lib/rules/concepts";
import { annotateCall, loadPrompt, runAgent } from "@/lib/ai/agent";
import type { AiCallDoc } from "@/lib/db/schemas";
import type { ClaimCheckInput, SimilarClaim } from "./context";
import { norm, quoted } from "./quotes";

// ── Claim judge (plan §7) ──────────────────────────────────────────────────
export const JUDGE_PROMPT = { dir: "claim-judge", version: "v1" } as const;

export const JudgeOutput = z.object({
  documentation: z.array(
    z.object({
      ruleId: z.string(),
      activityId: z.string(),
      concept: DocConcept,
      documented: z.boolean(),
      evidence: z.string(),
    }),
  ),
  lines: z.array(
    z.object({
      activityId: z.string(),
      probability: z.number().min(0).max(1),
      reasons: z.array(z.object({ text: z.string(), ruleId: z.string().optional(), pastClaimIds: z.array(z.string()).optional() })),
    }),
  ),
  claimProbability: z.number().min(0).max(1),
  confidence: z.enum(["high", "medium", "low"]),
  summary: z.string(),
});
export type JudgeOutput = z.infer<typeof JudgeOutput>;

export type DocQuestion = { ruleId: string; activityId: string; concept: z.infer<typeof DocConcept>; meaning: string };
export type LineRuleResult = { activityId: string; code: string; hits: RuleHit[] };

const ruleSummary = (r: Rule) => ({ id: r.id, title: r.title, family: r.family, denialCode: r.denialCode, severity: r.severity, insurerNeeds: r.insurerNeeds, source: `${r.source.publisher}: ${r.source.title}` });

/** The judge's input as compact JSON (kept small: Groq allows 8k tokens a minute on this key). */
export function judgeUserPrompt(input: ClaimCheckInput, rules: LineRuleResult[], questions: DocQuestion[], similar: SimilarClaim[]): string {
  return JSON.stringify({
    claim: {
      insurer: input.bundle.payer.name,
      visitType: [2, 4, 6].includes(input.bundle.encounter.type) ? "emergency" : "outpatient",
      clinicianSpecialty: input.bundle.provider.specialty,
      patientAge: input.ctxFor(() => null).patientAge,
      diagnoses: input.diagnoses.map((x) => `${x.code} ${x.description}${x.type === "Principal" ? " (principal)" : ""}`),
      lines: input.lines.map((l) => {
        const pa = l.priorAuthId ? input.bundle.priorAuths.find((a) => a.authNo === l.priorAuthId) : undefined;
        return { activityId: l.activityId, code: l.code, label: l.label, quantity: l.quantity, priorApproval: pa ? `approved for quantity ${pa.approvedQty}` : "none on file" };
      }),
    },
    note: input.note,
    rules: rules.flatMap((l) => l.hits.map((h) => ({ activityId: l.activityId, status: h.fired === true ? "fires" : "depends_on_documentation", ...(h.missing.length ? { lookFor: h.missing } : {}), ...ruleSummary(h.rule) }))),
    documentationQuestions: questions,
    similarClaims: similar.map((s) => ({ id: s.claimId, codes: s.codes.join(" "), diagnoses: s.diagnoses.join(" "), outcome: s.firstPassRefused ? `refused: ${s.refused.join("; ")}` : "paid first time", ...(s.fixes.length ? { fix: s.fixes.join("; ") } : {}) })),
  });
}

const CODE_TOKEN = /\b([A-TV-Z]\d{2}(?:\.\d{1,4})?|\d{4}[0-9TF])\b/g;

export type GuardedJudgement = JudgeOutput & { flags: string[]; droppedReasons: number; rejectedQuotes: string[] };

/**
 * Code-enforced guardrails (plan §7): every reason cites a rule or past claim from the input;
 * "documented" answers must quote the note verbatim; no reason may mention a code that is not
 * already on the claim, in the rules or in the cited past claims.
 */
export function guardJudgement(out: JudgeOutput, input: ClaimCheckInput, rules: LineRuleResult[], questions: DocQuestion[], similar: SimilarClaim[]): GuardedJudgement {
  const flags = new Set<string>();
  const ruleIds = new Set(rules.flatMap((l) => l.hits.map((h) => h.ruleId)));
  const pastIds = new Set(similar.map((s) => s.claimId));
  const allowedCodes = new Set([...input.lines.map((l) => l.code), ...input.diagnoses.map((x) => x.code), ...similar.flatMap((s) => [...s.codes, ...s.diagnoses])]);
  for (const l of rules) for (const h of l.hits) h.rule.target.codes.forEach((c) => allowedCodes.add(c));
  const note = norm(input.note);
  const rejectedQuotes: string[] = [];
  let dropped = 0;

  const documentation = out.documentation
    .filter((a) => questions.some((q) => q.ruleId === a.ruleId && q.activityId === a.activityId && q.concept === a.concept))
    .map((a) => {
      if (a.documented && !quoted(a.evidence, note)) {
        flags.add("evidence_not_in_note");
        rejectedQuotes.push(a.evidence.slice(0, 200));
        return { ...a, documented: false, evidence: "", unverified: true };
      }
      return a;
    });
  if (questions.some((q) => !documentation.some((a) => a.ruleId === q.ruleId && a.activityId === q.activityId && a.concept === q.concept))) flags.add("documentation_answer_missing");

  const lines = input.lines.map((line) => {
    const got = out.lines.find((x) => x.activityId === line.activityId);
    if (!got) flags.add("line_missing");
    const reasons = (got?.reasons ?? []).filter((r) => {
      const cites = (r.ruleId && ruleIds.has(r.ruleId)) || (r.pastClaimIds?.length && r.pastClaimIds.every((p) => pastIds.has(p)));
      if (!cites) {
        flags.add("missing_citation");
        dropped++;
        return false;
      }
      const foreign = [...r.text.matchAll(CODE_TOKEN)].map((m) => m[1]).filter((c) => !allowedCodes.has(c));
      if (foreign.length) {
        flags.add("code_suggestion");
        dropped++;
        return false;
      }
      return true;
    });
    return { activityId: line.activityId, probability: got?.probability ?? 0.15, reasons: reasons.slice(0, 3) };
  });
  return { ...out, documentation, lines, flags: [...flags], droppedReasons: dropped, rejectedQuotes };
}

export async function runJudge(d: Db, input: ClaimCheckInput, rules: LineRuleResult[], questions: DocQuestion[], similar: SimilarClaim[]): Promise<{ judgement: GuardedJudgement; call: AiCallDoc; user: string }> {
  const user = judgeUserPrompt(input, rules, questions, similar);
  const { data, call } = await runAgent(d, {
    agent: "claimJudge",
    promptVersion: `${JUDGE_PROMPT.dir}/${JUDGE_PROMPT.version}`,
    system: loadPrompt(JUDGE_PROMPT.dir, JUDGE_PROMPT.version),
    user,
    schema: JudgeOutput,
    subject: { claimId: input.claim._id, encounterId: input.claim.encounterId },
  });
  const judgement = guardJudgement(data, input, rules, questions, similar);
  if (judgement.flags.length) await annotateCall(d, call._id, { guardrailFlags: judgement.flags });
  return { judgement, call, user };
}

export function docQuestions(rules: LineRuleResult[]): DocQuestion[] {
  const out: DocQuestion[] = [];
  for (const l of rules)
    for (const h of l.hits)
      for (const c of h.missing) if (!out.some((q) => q.ruleId === h.ruleId && q.activityId === l.activityId && q.concept === c)) out.push({ ruleId: h.ruleId, activityId: l.activityId, concept: c, meaning: CONCEPT_TEXT[c] });
  return out;
}

// ── Critic (plan §7): a different model checks the judge ──────────────────
export const CRITIC_PROMPT = { dir: "critic", version: "v1" } as const;
export const CriticOutput = z.object({
  verdict: z.enum(["pass", "fail"]),
  agreement: z.enum(["agree", "disagree"]),
  issues: z.array(z.object({ check: z.enum(["citations", "evidence", "no_new_facts", "no_code_changes", "consistency"]), activityId: z.string().optional(), detail: z.string() })).default([]),
  note: z.string().default(""),
});
export type CriticOutput = z.infer<typeof CriticOutput>;

export async function runCritic(d: Db, input: ClaimCheckInput, judgeUser: string, judgement: GuardedJudgement, judgeCall: AiCallDoc): Promise<{ critic: CriticOutput; call: AiCallDoc }> {
  const shown = { documentation: judgement.documentation, lines: judgement.lines, claimProbability: judgement.claimProbability, confidence: judgement.confidence, summary: judgement.summary };
  const { data, call } = await runAgent(d, {
    agent: "critic",
    promptVersion: `${CRITIC_PROMPT.dir}/${CRITIC_PROMPT.version}`,
    system: loadPrompt(CRITIC_PROMPT.dir, CRITIC_PROMPT.version),
    user: JSON.stringify({ evidence: JSON.parse(judgeUser), judgement: shown }),
    schema: CriticOutput,
    subject: { claimId: input.claim._id, encounterId: input.claim.encounterId },
  });
  await annotateCall(d, judgeCall._id, { criticResult: data.verdict });
  return { critic: data, call };
}

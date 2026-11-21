import "server-only";
import { adjust, hospitalPrior } from "@/lib/hospital/prior";
import type { Db } from "mongodb";
import { db as getDb } from "@/lib/db/mongo";
import { emit } from "@/lib/db/events";
import { COLLECTIONS as C, type ClaimDoc, type EventDoc, type FindingDoc } from "@/lib/db/schemas";
import type { DocConcept, Rule } from "@/lib/rules/dsl";
import { anyMatch, checkLine, ruleApplies, type RuleHit } from "@/lib/rules/engine";
import { activeRules } from "@/lib/rules/active";
import { RULE_SET_VERSION } from "@/lib/rules/library";
import { codedQualifier } from "@/lib/rules/qualifier";
import { composeQuestions } from "@/lib/questions/compose";
import { trainStats } from "@/lib/learning/model";
import { AgentDisabled } from "@/lib/ai/agent";
import { embedTexts } from "@/lib/ai/embed";
import { dubaiIso } from "@/lib/util/time";
import { loadCheckInput, similarClaims, type SimilarClaim } from "./context";
import { docQuestions, runCritic, runJudge, type CriticOutput, type GuardedJudgement, type LineRuleResult } from "./judge";

/**
 * Stage 3 of the flow (plan §5): the real-time check. Rule engine first (< 1 s), then similar
 * past claims, the AI judge, the critic, and routing to Hold or Ready. Each step is written as a
 * domain event, so every open claim view (on any Vercel instance) can stream it.
 * Max one run per claim at a time (lock on liveCheckState); hard fallback to rules-only scoring.
 */

type Actor = EventDoc["actor"];
const ACTOR: Actor = { kind: "agent", id: "claim-check" };
/** A run stuck longer than this (crashed instance) may be taken over. */
const STALE_MS = 120_000;
/** Hold when the claim's refusal probability reaches this. */
export const HOLD_THRESHOLD = 0.5;
/** SEAL's own prior that a firing rule leads to refusal, per denial family (not the insurer's numbers). */
const RULE_PRIOR: Record<string, number> = { AUTH: 0.9, DUPL: 0.85, MNEC: 0.8, CODE: 0.8, PRCE: 0.7, NCOV: 0.85, ELIG: 0.95, BENX: 0.8, CLAI: 0.6, COPY: 0.6, TIME: 0.95 };
const LAB_BASE = 0.08;
const OTHER_BASE = 0.03;

/** Load the local embedding model early so the first retrieval is fast. */
let warm: Promise<unknown> | null = null;
export function warmEmbeddings() {
  warm ??= embedTexts(["warm up"]).catch(() => (warm = null));
  return warm;
}

const ruleView = (h: RuleHit) => ({
  ruleId: h.ruleId,
  title: h.rule.title,
  family: h.rule.family,
  denialCode: h.rule.denialCode,
  severity: h.rule.severity,
  fired: h.fired,
  missing: h.missing,
  insurerNeeds: h.rule.insurerNeeds,
  fixActions: h.rule.fixActions,
  fixTemplates: h.rule.fixTemplates,
  verified: h.rule.verified,
  source: { publisher: h.rule.source.publisher, title: h.rule.source.title, url: h.rule.source.url },
});
export type RuleView = ReturnType<typeof ruleView>;

const isDocRule = (r: Rule) => JSON.stringify(r.when).includes('"documents"');

async function lock(d: Db, claimId: string, force: boolean): Promise<ClaimDoc | null> {
  const claim = (await d.collection(C.claims).findOne({ _id: claimId as never })) as ClaimDoc | null;
  if (!claim) throw new Error(`claim ${claimId} not found`);
  if (!["draft", "ready", "hold", "checking"].includes(claim.status)) return null; // already sent: no pre-submission check
  const running = ["rules", "judge", "critic"].includes(claim.liveCheckState);
  const stale = running && claim.check && Date.now() - new Date(claim.check.startedAt).getTime() > STALE_MS;
  if (running && !stale) return null;
  if (!running && claim.liveCheckState !== "idle" && !force) return null;
  const run = (claim.check?.run ?? 0) + 1;
  const r = await d.collection(C.claims).findOneAndUpdate(
    { _id: claimId as never, liveCheckState: claim.liveCheckState },
    { $set: { liveCheckState: "rules", status: "checking", check: { run, startedAt: dubaiIso(), mode: "full", holdReasons: [], lineRisk: {}, aiCallIds: [], ruleSetVersion: RULE_SET_VERSION } } },
    { returnDocument: "after" },
  );
  return r as ClaimDoc | null;
}

export type CheckOutcome = { claimId: string; run: number; route: "ready" | "hold"; riskScore: number; holdReasons: string[]; mode: "full" | "rules_only" | "trained_model"; ms: number };

/** Run the real-time check. Returns null if another run holds the lock or the claim was already sent. */
export async function runClaimCheck(claimId: string, opts: { database?: Db; force?: boolean } = {}): Promise<CheckOutcome | null> {
  const d = opts.database ?? (await getDb());
  const claim = await lock(d, claimId, !!opts.force);
  if (!claim) return null;
  const run = claim.check!.run;
  const t0 = Date.now();
  const step = (stage: string, data: Record<string, unknown>) => emit(stage === "rules" ? "claim.check.rule_result" : "claim.check.ai_result", { claimId, run, stage, ms: Date.now() - t0, ...data }, ACTOR);

  try {
    // The started event, the claim's data and the rule set load in parallel (each is a round trip to Atlas).
    const [, input, rules] = await Promise.all([emit("claim.check.started", { claimId, run, claimNo: claim.claimNo }, ACTOR), loadCheckInput(claim, d), activeRules(d)]);
    const timings: Record<string, number> = { loaded: Date.now() - t0 };

    // ── 1. Rule engine (documentation not known yet → "depends on documentation") ──
    const pass1: LineRuleResult[] = input.lines.map((l) => ({ activityId: l.activityId, code: l.code, hits: checkLine(rules, input.ctxFor(() => null), l, "claim") }));
    const dismissed = d.collection(C.findings).updateMany({ claimId, status: "open", stage: { $in: ["rule_engine", "claim_judge", "critic"] } }, { $set: { status: "dismissed" } });
    await step("rules", { lines: pass1.map((l) => ({ activityId: l.activityId, code: l.code, label: input.lines.find((x) => x.activityId === l.activityId)!.label, hits: l.hits.map(ruleView) })) });

    // ── 2. search_ledger: similar past claims ──
    // Embedding runs on this CPU; start it only after the rule results are out so it can't delay them.
    timings.rules = Date.now() - t0;
    const [similar] = await Promise.all([similarClaims(input, d).catch((): SimilarClaim[] => []), dismissed]);
    timings.retrieval = Date.now() - t0;
    await step("retrieval", { similar });

    // ── 3. AI judge + guardrails ──
    await d.collection(C.claims).updateOne({ _id: claimId as never }, { $set: { liveCheckState: "judge" } });
    const questions = docQuestions(pass1);
    let judgement: GuardedJudgement | null = null;
    let critic: CriticOutput | null = null;
    const aiCallIds: string[] = [];
    let mode: "full" | "rules_only" | "trained_model" = "full";
    const judges = await d.collection(C.judges).findOne({ _id: "judges" as never });
    let trained: Record<string, number> | null = null;
    let shadowRisk: number | undefined;
    const trainedRisk = async () => {
      const stats = await trainStats(d);
      return Object.fromEntries(input.lines.map((l) => [l.activityId, Math.round(stats.rate(claim.payerId, l.code) * 1000) / 1000]));
    };
    let judgeError: string | undefined;
    let judgeUser = "";
    let judgeCall;
    if (judges?.active === "trained_model") {
      // Active judge set in /admin: refusal rates learned from the ledger, no model call.
      mode = "trained_model";
      trained = await trainedRisk();
      await step("judge", { mode, model: "trained model (ledger refusal rates)", provider: "none", lines: input.lines.map((l) => ({ activityId: l.activityId, probability: trained![l.activityId], reasons: [] })) });
    } else try {
      const r = await runJudge(d, input, pass1, questions, similar);
      judgement = r.judgement;
      judgeUser = r.user;
      judgeCall = r.call;
      aiCallIds.push(r.call._id);
      await step("judge", { ...judgement, model: r.call.model, provider: r.call.provider, latencyMs: r.call.latencyMs, fallbackUsed: r.call.fallbackUsed, aiCallId: r.call._id });
    } catch (e) {
      mode = "rules_only";
      judgeError = e instanceof AgentDisabled ? e.message : `AI judge unavailable: ${(e as Error).message.slice(0, 200)}`;
      const failed = (e as { call?: { _id: string } }).call;
      if (failed) aiCallIds.push(failed._id);
      await step("judge", { error: judgeError, mode });
    }

    // ── 4. Rules again with the judge's documentation answers ──
    const answers = new Map<string, Map<DocConcept, boolean>>();
    for (const a of judgement?.documentation ?? []) {
      const m = answers.get(a.activityId) ?? new Map<DocConcept, boolean>();
      m.set(a.concept, (m.get(a.concept) ?? false) || a.documented);
      answers.set(a.activityId, m);
    }
    const pass2: LineRuleResult[] = input.lines.map((l) => ({ activityId: l.activityId, code: l.code, hits: checkLine(rules, input.ctxFor((c) => answers.get(l.activityId)?.get(c) ?? null), l, "claim") }));

    // ── 5. Critic ──
    let agreement: "agree" | "low_agreement" | "not_checked" = "not_checked";
    if (judgement && judgeCall) {
      await d.collection(C.claims).updateOne({ _id: claimId as never }, { $set: { liveCheckState: "critic" } });
      try {
        const r = await runCritic(d, input, judgeUser, judgement, judgeCall);
        critic = r.critic;
        aiCallIds.push(r.call._id);
        agreement = critic.verdict === "pass" && critic.agreement === "agree" ? "agree" : "low_agreement";
        await step("critic", { ...critic, model: r.call.model, provider: r.call.provider, latencyMs: r.call.latencyMs, fallbackUsed: r.call.fallbackUsed, aiCallId: r.call._id });
      } catch (e) {
        await step("critic", { error: `critic unavailable: ${(e as Error).message.slice(0, 200)}` });
      }
    }

    // ── 6. Score and route ──
    const lineRisk: Record<string, number> = {};
    const holdReasons: string[] = [];
    const findings: FindingDoc[] = [];
    const now = dubaiIso();
    const base = { claimId, encounterId: claim.encounterId, checkRun: run, pastClaimIds: [] as string[], writtenBy: ACTOR, writtenAt: now };
    for (const l of pass2) {
      const line = input.lines.find((x) => x.activityId === l.activityId)!;
      const definite = l.hits.filter((h) => h.fired === true);
      const possible = l.hits.filter((h) => h.fired === "unknown");
      const prior = Math.max(0, ...definite.map((h) => RULE_PRIOR[h.rule.family] ?? 0.7));
      const judged = judgement?.lines.find((x) => x.activityId === l.activityId);
      const p = judged ? Math.max(judged.probability, prior) : trained ? Math.max(trained[l.activityId] ?? 0, prior, possible.length ? 0.45 : 0) : definite.length ? prior : possible.length ? 0.45 : /^8\d{4}$/.test(l.code) ? LAB_BASE : OTHER_BASE;
      lineRisk[l.activityId] = Math.round(p * 1000) / 1000;
      const orderId = claim.versions.at(-1)!.lines.find((x) => x.activityId === l.activityId)?.orderId;
      for (const h of [...definite, ...possible]) {
        const doc = isDocRule(h.rule);
        // A doc-dependent rule that fires means the note lacks what the insurer needs → ask the doctor.
        const gap = doc ? h.missing.filter((c) => answers.get(l.activityId)?.get(c) !== true) : [];
        const kind = doc ? "documentation" : "fix";
        holdReasons.push(`${kind === "documentation" ? "Documentation gap" : "Fix needed"}: ${line.label} — ${h.rule.title} (${h.ruleId})`);
        findings.push({
          ...base,
          _id: `${claimId}-r${run}-${findings.length + 1}`,
          orderId,
          activityId: l.activityId,
          stage: "rule_engine",
          ruleId: h.ruleId,
          denialCode: h.rule.denialCode,
          insurerNeeds: h.rule.insurerNeeds,
          severity: h.rule.severity,
          probability: lineRisk[l.activityId],
          status: "open",
          kind,
          gapConcepts: gap.length ? gap : undefined,
          reason: h.fired === "unknown" ? "Could not confirm the documentation automatically." : h.rule.title,
        });
      }
      // Documented in the note but not coded on the claim → coder links the diagnosis.
      for (const rule of rules) {
        if (!rule.stages.includes("claim") || !ruleApplies(rule, claim.payerId, l.code)) continue;
        const codes = codedQualifier(rule);
        if (!codes || l.hits.some((h) => h.ruleId === rule.id)) continue;
        const ans = judgement?.documentation.find((a) => a.activityId === l.activityId && a.ruleId === rule.id && a.concept === "qualifying_diagnosis_documented" && a.documented);
        if (!ans || input.diagnoses.some((x) => anyMatch(codes, x.code))) continue;
        holdReasons.push(`Fix needed: ${line.label} — qualifying condition is in the note but not coded on the claim (${rule.id})`);
        lineRisk[l.activityId] = Math.max(lineRisk[l.activityId], 0.6);
        findings.push({
          ...base,
          _id: `${claimId}-r${run}-${findings.length + 1}`,
          orderId,
          activityId: l.activityId,
          stage: "rule_engine",
          ruleId: rule.id,
          denialCode: rule.denialCode,
          insurerNeeds: rule.insurerNeeds,
          evidenceSpan: ans.evidence,
          severity: rule.severity,
          probability: lineRisk[l.activityId],
          status: "open",
          kind: "fix",
          reason: "The note documents a qualifying condition, but no qualifying diagnosis is on the claim. Link the documented diagnosis (coder).",
        });
      }
      for (const r of judged?.reasons ?? []) {
        const evid = judgement!.documentation.find((a) => a.activityId === l.activityId && a.ruleId === r.ruleId && a.documented)?.evidence;
        findings.push({ ...base, _id: `${claimId}-r${run}-${findings.length + 1}`, orderId, activityId: l.activityId, stage: "claim_judge", ruleId: r.ruleId, pastClaimIds: r.pastClaimIds ?? [], evidenceSpan: evid, severity: p >= 0.6 ? "high" : p >= 0.3 ? "medium" : "low", probability: lineRisk[l.activityId], status: "open", kind: "risk", reason: r.text, aiCallId: judgeCall?._id });
      }
    }
    // ── 6b. This hospital's own history with this insurer (hospitals with their own data only) ──
    const hospital = await hospitalPrior(d, claim.payerId, claim.providerId).catch(() => null);
    if (hospital) {
      for (const k of Object.keys(lineRisk)) lineRisk[k] = Math.round(adjust(lineRisk[k], hospital.factor) * 1000) / 1000;
      await step("hospital", { ...hospital });
    }
    const riskScore = Math.round((1 - Object.values(lineRisk).reduce((s, p) => s * (1 - p), 1)) * 1000) / 1000;
    if (judges?.shadow === "trained_model" && mode !== "trained_model") {
      const t = await trainedRisk();
      shadowRisk = Math.round((1 - Object.values(t).reduce((s, p) => s * (1 - p), 1)) * 1000) / 1000;
    }
    if (agreement === "low_agreement") {
      holdReasons.push(`Low agreement: the critic ${critic!.verdict === "fail" ? "rejected the judgement" : "disagreed with the judge"}${critic!.note ? ` — ${critic!.note}` : ""}`);
      for (const i of critic!.issues) findings.push({ ...base, _id: `${claimId}-r${run}-${findings.length + 1}`, activityId: i.activityId || undefined, stage: "critic", severity: "medium", status: "open", kind: "agreement", reason: `${i.check}: ${i.detail}` });
    }
    if (riskScore >= HOLD_THRESHOLD && !holdReasons.length) holdReasons.push(`Refusal risk ${Math.round(riskScore * 100)}% is above the ${HOLD_THRESHOLD * 100}% hold threshold`);
    if (findings.length) await d.collection(C.findings).insertMany(findings as never[]);

    const route = holdReasons.length ? "hold" : "ready";
    const finishedAt = dubaiIso();
    await d.collection(C.claims).updateOne(
      { _id: claimId as never },
      { $set: { status: route, riskScore, "check.finishedAt": finishedAt, "check.mode": mode, "check.route": route, "check.holdReasons": holdReasons, "check.lineRisk": lineRisk, "check.agreement": agreement, ...(hospital ? { "check.hospital": hospital } : {}), "check.aiCallIds": aiCallIds, ...(shadowRisk !== undefined ? { "check.shadowRiskScore": shadowRisk } : {}), ...(judgeError ? { "check.error": judgeError } : {}) } },
    );
    const ms = Date.now() - t0;
    // Final rule results (after the documentation answers) replace the first-pass view in the claim screen.
    const finalLines = pass2.map((l) => ({ activityId: l.activityId, code: l.code, hits: l.hits.map(ruleView) }));
    await step("routed", { route, riskScore, holdReasons, lineRisk, mode, agreement, findings: findings.length, timings, lines: finalLines });
    if (route === "hold") await emit("claim.held", { claimId, run, riskScore, reasons: holdReasons }, ACTOR);
    // Stage 4: documentation gaps become questions for the doctor (as many as there are gapped orders).
    if (findings.some((f) => f.kind === "documentation" && f.gapConcepts?.length)) await composeQuestions(d, claimId, run).catch(() => null);
    else await d.collection(C.questionSets).updateMany({ claimId, status: "open" }, { $set: { status: "cancelled" } });
    // Mark done only after the events are written, so streaming viewers never stop before "routed".
    await d.collection(C.claims).updateOne({ _id: claimId as never }, { $set: { liveCheckState: "done" } });
    return { claimId, run, route, riskScore, holdReasons, mode, ms };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    // Never leave a claim unchecked and sendable: hold it for a person.
    await d.collection(C.claims).updateOne({ _id: claimId as never }, { $set: { status: "hold", "check.error": msg, "check.route": "hold", "check.holdReasons": [`Check failed: ${msg}`] } });
    await step("error", { error: msg }).catch(() => null);
    await d.collection(C.claims).updateOne({ _id: claimId as never }, { $set: { liveCheckState: "error" } });
    throw e;
  }
}

import "server-only";
import type { Db } from "mongodb";
import { AGENTS, type AgentName } from "@/config/models";
import { COLLECTIONS as C, type AiCallDoc, type EvalRunDoc } from "@/lib/db/schemas";
import { RULE_SET_VERSION } from "@/lib/rules/library";
import { DAY } from "@/lib/util/time";

/**
 * AI Health (plan §10). Every number is computed from logged model calls (aiCalls), the outcome
 * ledger, evaluation runs, question sets and events — never from mocks. scripts/dev/phase7-health.ts
 * re-derives them with direct queries.
 */
const pct = (a: number, b: number) => (b ? a / b : null);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
};
// Pilot criteria from the pitch (plan §10).
export const THRESHOLDS = { holdPrecision: 0.5, doctorAnswerRate: 0.6, fallbackRate: 0.1 };

export async function healthMetrics(d: Db, now = Date.now()) {
  const [calls, evalRuns, sets, judges, cycles, rulesActive, evts] = await Promise.all([
    d.collection(C.aiCalls).find({}, { projection: { _id: 1, agent: 1, provider: 1, model: 1, promptVersion: 1, tokensIn: 1, tokensOut: 1, cost: 1, latencyMs: 1, status: 1, fallbackUsed: 1, criticResult: 1, guardrailFlags: 1, maskingPassed: 1, subject: 1, at: 1 } }).toArray() as unknown as Promise<AiCallDoc[]>,
    d.collection(C.evalRuns).find({}).sort({ at: -1 }).limit(10).toArray() as unknown as Promise<EvalRunDoc[]>,
    d.collection(C.questionSets).find({ status: { $ne: "cancelled" } }, { projection: { status: 1, writtenAt: 1, encounterId: 1, addendumId: 1 } }).toArray(),
    d.collection(C.judges).findOne({ _id: "judges" as never }),
    d.collection(C.learningCycles).find({}).sort({ at: -1 }).limit(1).toArray(),
    d.collection(C.rules).countDocuments({ scope: "seal", active: true }),
    d.collection(C.events).find({ type: { $in: ["claim.submitted", "claim.released"] } }, { projection: { type: 1, payload: 1 } }).toArray(),
  ]);

  // ── Operations ──
  const agents = [...new Set(calls.map((c) => c.agent))].sort();
  const operations = agents.map((agent) => {
    const xs = calls.filter((c) => c.agent === agent);
    const ok = xs.filter((c) => c.status === "ok");
    const lat = ok.map((c) => c.latencyMs);
    return {
      agent,
      calls: xs.length,
      p50: quantile(lat, 0.5),
      p95: quantile(lat, 0.95),
      targetMs: AGENTS[agent as AgentName]?.targetMs ?? null,
      errorRate: pct(xs.filter((c) => c.status !== "ok").length, xs.length),
      fallbackRate: pct(xs.filter((c) => c.fallbackUsed).length, xs.length),
      tokensIn: xs.reduce((s, c) => s + c.tokensIn, 0),
      tokensOut: xs.reduce((s, c) => s + c.tokensOut, 0),
      cost: xs.reduce((s, c) => s + c.cost, 0),
    };
  });
  const byProvider = ["groq", "gemini", "none"].map((p) => ({ provider: p, calls: calls.filter((c) => c.provider === p).length, cost: calls.filter((c) => c.provider === p).reduce((s, c) => s + c.cost, 0), tokens: calls.filter((c) => c.provider === p).reduce((s, c) => s + c.tokensIn + c.tokensOut, 0) }));
  const claimsWithCalls = new Set(calls.map((c) => c.subject?.claimId).filter(Boolean));
  const totalCost = calls.reduce((s, c) => s + c.cost, 0);

  // ── Safety ──
  const flagCounts: Record<string, number> = {};
  for (const c of calls) for (const f of c.guardrailFlags ?? []) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
  const judged = calls.filter((c) => c.agent === "claimJudge" && c.status === "ok");
  const safety = {
    guardrailBlocks: flagCounts,
    maskingChecks: calls.length,
    maskingPassed: calls.filter((c) => c.maskingPassed).length,
    criticRejections: judged.filter((c) => c.criticResult === "fail").length,
    judgedByCritic: judged.filter((c) => c.criticResult && c.criticResult !== "skipped").length,
  };

  // ── Agreement ──
  const answered = sets.filter((s) => s.status === "answered");
  const addenda = answered.length ? await d.collection(C.encounters).find({ "addenda.questionSetId": { $in: answered.map((s) => s._id) } }, { projection: { addenda: 1 } }).toArray() : [];
  const answerMinutes = answered
    .map((s) => {
      const a = addenda.flatMap((e) => (e.addenda ?? []) as { questionSetId: string; signedAt: string }[]).find((x) => x.questionSetId === String(s._id));
      return a ? (new Date(a.signedAt).getTime() - new Date(s.writtenAt as string).getTime()) / 60_000 : null;
    })
    .filter((x): x is number => x !== null);
  const submittedFirst = evts.filter((e) => e.type === "claim.submitted" && e.payload?.version === 1).length;
  const overrides = evts.filter((e) => e.type === "claim.released").length;
  const agreement = {
    judgeCriticAgree: pct(judged.filter((c) => c.criticResult === "pass").length, safety.judgedByCritic),
    billerOverrides: overrides,
    billerAccepted: submittedFirst - overrides,
    billerOverrideRate: pct(overrides, submittedFirst),
    doctorQuestionSets: sets.length,
    doctorAnswered: answered.length,
    doctorAnswerRate: pct(answered.length, sets.length),
    doctorMinutesToAnswerMedian: quantile(answerMinutes, 0.5),
  };

  // ── Quality (evaluation set + live claims in the ledger) ──
  const latest = evalRuns[0] ?? null;
  const live = await d.collection(C.outcomes).find({ "writtenBy.id": "outcome-ledger", predictedProbability: { $ne: null } }, { projection: { predictedProbability: 1, firstPassRefused: 1 } }).toArray();
  const liveHeld = live.filter((o) => (o.predictedProbability as number) >= 0.5);
  const quality = {
    eval: latest && { at: latest.at, n: latest.n, holdPrecision: latest.precision, refusalRecall: latest.recall, auc: latest.auc, brier: latest.brier, firstPassBaseline: latest.firstPassBaseline, firstPassWithSeal: latest.firstPassWithSeal, judge: latest.judge },
    live: { n: live.length, held: liveHeld.length, holdPrecision: pct(liveHeld.filter((o) => o.firstPassRefused).length, liveHeld.length), refusalRecall: pct(liveHeld.filter((o) => o.firstPassRefused).length, live.filter((o) => o.firstPassRefused).length) },
    history: evalRuns.map((r) => ({ at: r.at, precision: r.precision, recall: r.recall })).reverse(),
  };

  // ── Drift: this week vs last (claims by creation; refusals by remittance date) ──
  const wk = (k: number) => [new Date(now - (k + 1) * 7 * DAY).toISOString(), new Date(now - k * 7 * DAY).toISOString()];
  const mix = async (field: string, k: number) => {
    const [a, b] = wk(k);
    const rows = await d.collection(C.claims).aggregate([{ $match: { evalSet: false, createdAt: { $gte: a.replace("Z", "+00:00"), $lt: b.replace("Z", "+00:00") } } }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]).toArray();
    return Object.fromEntries(rows.map((r) => [r._id, r.n as number]));
  };
  const reasons = async (k: number) => {
    const [a, b] = wk(k);
    const rows = await d.collection(C.remittances).aggregate([{ $match: { claimVersion: 1, readyAt: { $gte: a.replace("Z", "+00:00"), $lt: b.replace("Z", "+00:00") } } }, { $unwind: "$lines" }, { $match: { "lines.denialCode": { $exists: true } } }, { $group: { _id: { $substrCP: ["$lines.denialCode", 0, 4] }, n: { $sum: 1 } } }]).toArray();
    return Object.fromEntries(rows.map((r) => [r._id, r.n as number]));
  };
  const [payerNow, payerLast, specNow, specLast, reasonNow, reasonLast] = await Promise.all([mix("payerId", 0), mix("payerId", 1), mix("providerId", 0), mix("providerId", 1), reasons(0), reasons(1)]);
  const seen = new Set((await d.collection(C.remittances).distinct("lines.denialCode", { readyAt: { $lt: wk(0)[0].replace("Z", "+00:00") } })) as string[]);
  const recent = (await d.collection(C.remittances).distinct("lines.denialCode", { readyAt: { $gte: wk(0)[0].replace("Z", "+00:00"), $lte: new Date(now).toISOString() } })) as string[];
  const drift = { payerMix: { thisWeek: payerNow, lastWeek: payerLast }, providerMix: { thisWeek: specNow, lastWeek: specLast }, refusalReasons: { thisWeek: reasonNow, lastWeek: reasonLast }, newDenialCodes: recent.filter((c) => c && !seen.has(c)) };

  // ── Versions ──
  const versions = { activeJudge: judges?.active ?? "agentic_llm", shadowJudge: judges?.shadow ?? null, promptVersions: [...new Set(calls.map((c) => c.promptVersion))].sort(), ruleSetVersion: RULE_SET_VERSION, activeRules: rulesActive, lastLearningCycle: cycles[0]?.at ?? null };

  // ── Alerts ──
  const alerts: { level: "critical" | "warning"; text: string }[] = [];
  if (latest && latest.precision < THRESHOLDS.holdPrecision) alerts.push({ level: "critical", text: `Hold precision ${Math.round(latest.precision * 100)}% is under the ${THRESHOLDS.holdPrecision * 100}% pilot threshold` });
  for (const o of operations) {
    if (o.p95 && o.targetMs && o.p95 > o.targetMs) alerts.push({ level: "warning", text: `${o.agent}: p95 latency ${(o.p95 / 1000).toFixed(1)} s is over its ${(o.targetMs / 1000).toFixed(1)} s target` });
    if (o.fallbackRate !== null && o.fallbackRate > THRESHOLDS.fallbackRate && o.calls >= 3) alerts.push({ level: "warning", text: `${o.agent}: ${Math.round(o.fallbackRate * 100)}% of calls fell back to Gemini (over ${THRESHOLDS.fallbackRate * 100}%)` });
  }
  if (agreement.doctorAnswerRate !== null && agreement.doctorAnswerRate < THRESHOLDS.doctorAnswerRate && sets.length >= 3) alerts.push({ level: "warning", text: `Doctor answer rate ${Math.round(agreement.doctorAnswerRate * 100)}% is under the ${THRESHOLDS.doctorAnswerRate * 100}% pilot threshold` });

  // Learning battery: finished claims (outcomes) not yet used by a learning cycle.
  const since = (cycles[0]?.at as string | undefined) ?? null;
  const readyCases = await d.collection(C.outcomes).countDocuments(since ? { writtenAt: { $gt: since } } : {});
  const learnedRules = await d.collection(C.rules).countDocuments({ author: "rule-miner", active: true });
  const learning = { readyCases, since, learnedRules, refusedReady: await d.collection(C.outcomes).countDocuments({ ...(since ? { writtenAt: { $gt: since } } : {}), firstPassRefused: true }) };

  return { computedAt: new Date(now).toISOString(), learning, calls: calls.length, operations, byProvider, costPerClaim: claimsWithCalls.size ? totalCost / claimsWithCalls.size : null, totalCost, safety, agreement, quality, calibration: latest?.calibration ?? [], calibrationByPayer: latest?.byPayer ?? {}, drift, versions, alerts, thresholds: THRESHOLDS };
}

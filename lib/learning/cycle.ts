import "server-only";
import type { Db } from "mongodb";
import { emit } from "@/lib/db/events";
import { COLLECTIONS as C, type EvalRunDoc, type RuleProposalDoc } from "@/lib/db/schemas";
import { Rule } from "@/lib/rules/dsl";
import { anyMatch, checkLine } from "@/lib/rules/engine";
import { invalidateRuleCache } from "@/lib/rules/active";
import { dubaiIso } from "@/lib/util/time";
import { loadBatch } from "./batch";
import { runEvaluation } from "./evaluate";
import { findClusters, proposeRule, MIN_SUPPORT, WINDOW_DAYS } from "./miner";
import { forget } from "@/lib/perf/memo";

export type CycleStep = { step: string; detail: Record<string, unknown> };

/**
 * One learning cycle (plan §10): count new outcomes, cluster refusals into rule proposals, re-run
 * the evaluation set, compare with the previous run. Streams its steps through `onStep`.
 */
export async function runLearningCycle(d: Db, onStep: (s: CycleStep) => void = () => {}, opts: { now?: number; maxProposals?: number } = {}) {
  const id = `cycle-${Date.now()}`;
  const started = dubaiIso();
  const last = await d.collection(C.learningCycles).find({}).sort({ at: -1 }).limit(1).next();
  const since = (last?.at as string | undefined) ?? "1970-01-01";
  const newOutcomes = await d.collection(C.outcomes).countDocuments({ writtenAt: { $gt: since } });
  const totalOutcomes = await d.collection(C.outcomes).estimatedDocumentCount();
  onStep({ step: "outcomes", detail: { newOutcomes, totalOutcomes, since } });

  const clusters = await findClusters(d, opts.now);
  onStep({ step: "clusters", detail: { found: clusters.length, threshold: MIN_SUPPORT, windowDays: WINDOW_DAYS, top: clusters.slice(0, 5).map((c) => ({ clusterId: c.clusterId, count: c.count, explainedByRules: c.explained })) } });

  const proposals: RuleProposalDoc[] = [];
  for (const c of clusters.slice(0, opts.maxProposals ?? 2)) {
    try {
      const p = await proposeRule(d, c, opts.now);
      if (p) {
        proposals.push(p);
        onStep({ step: "proposal", detail: { proposalId: p._id, ruleId: (p.dsl as Rule).id, title: (p.dsl as Rule).title, backtest: p.backtest } });
      }
    } catch (e) {
      onStep({ step: "proposal_failed", detail: { clusterId: c.clusterId, error: (e as Error).message.slice(0, 200) } });
    }
  }

  const before = (await d.collection(C.evalRuns).find({}).sort({ at: -1 }).limit(1).next()) as EvalRunDoc | null;
  const after = await runEvaluation(d, id);
  onStep({ step: "evaluation", detail: { before: before && pick(before), after: pick(after) } });

  const cycle = { _id: id, at: dubaiIso(), startedAt: started, newOutcomes, clusters: clusters.length, proposals: proposals.map((p) => p._id), evalRunId: after._id, previousEvalRunId: before?._id };
  await d.collection(C.learningCycles).insertOne(cycle as never);
  await forget(d);
  await emit("learning.cycle.completed", { cycleId: id, newOutcomes, clusters: clusters.length, proposals: proposals.length, precision: after.precision, recall: after.recall }, { kind: "system", id: "learning" });
  return { cycle, proposals, before, after };
}

const pick = (r: EvalRunDoc) => ({ precision: round(r.precision), recall: round(r.recall), brier: round(r.brier ?? 0), auc: round(r.auc ?? 0), firstPassBaseline: round(r.firstPassBaseline ?? 0), firstPassWithSeal: round(r.firstPassWithSeal ?? 0), activeRules: r.activeRules });
const round = (n: number) => Math.round(n * 1000) / 1000;

/** "Test this rule": run it over the history for its services; how many refusals would it have caught? */
export async function testRule(d: Db, rule: Rule) {
  const evalIds = ((await d.collection(C.evalSets).findOne({}))?.claimIds ?? []) as string[];
  const exact = rule.target.codes.filter((c) => !c.includes("*") && !c.includes("-"));
  const filter = exact.length === rule.target.codes.length ? { "versions.0.lines.code": { $in: exact } } : {};
  const batch = (await loadBatch(d, { ...filter, evalSet: false, _id: { $nin: evalIds as never[] }, ...(rule.payers === "*" ? {} : { payerId: { $in: rule.payers } }) }, { withRemittances: true, limit: 6000 })).filter((b) =>
    b.claim.versions[0].lines.some((l) => anyMatch(rule.target.codes, l.code)),
  );
  let fires = 0, mightFire = 0, caught = 0, caughtSameCode = 0, firedOnPaid = 0, refusedLines = 0;
  for (const b of batch) {
    for (const l of b.claim.versions[0].lines) {
      if (!anyMatch(rule.target.codes, l.code)) continue;
      const hit = checkLine([rule], b.ctx(), { code: l.code, quantity: l.quantity }).find((h) => h.ruleId === rule.id);
      const denial = b.firstPass?.get(l.activityId);
      if (denial) refusedLines++;
      if (!hit) continue;
      if (hit.fired === true) fires++;
      else mightFire++;
      if (denial) {
        caught++;
        if (denial === rule.denialCode) caughtSameCode++;
      } else if (b.firstPass) firedOnPaid++;
    }
  }
  return { claimsChecked: batch.length, refusedLines, fires, mightFire, caught, caughtSameCode, firedOnPaid };
}

/** Approve or reject a proposal. Approval adds the rule to SEAL's active library at once. */
export async function decideProposal(d: Db, proposalId: string, decision: "approved" | "rejected", by: string, reason?: string) {
  const p = (await d.collection(C.ruleProposals).findOne({ _id: proposalId as never })) as RuleProposalDoc | null;
  if (!p) throw new Error(`proposal ${proposalId} not found`);
  if (p.status !== "proposed") throw new Error(`proposal is already ${p.status}`);
  await d.collection(C.ruleProposals).updateOne({ _id: proposalId as never }, { $set: { status: decision, decidedBy: by, decisionReason: reason } });
  if (decision === "approved") {
    const rule = Rule.parse(p.dsl);
    await d.collection(C.rules).replaceOne(
      { _id: rule.id as never },
      { _id: rule.id, payerId: rule.payers === "*" ? "*" : rule.payers[0], scope: "seal", dsl: rule, sourceUrl: rule.source.url, verified: false, version: rule.version, author: "rule-miner", approvedBy: by, active: true, writtenBy: { kind: "user", id: by }, writtenAt: dubaiIso() },
      { upsert: true },
    );
    invalidateRuleCache();
    await emit("rule.approved", { proposalId, ruleId: rule.id, approvedBy: by }, { kind: "user", id: by });
  }
  return { status: decision };
}

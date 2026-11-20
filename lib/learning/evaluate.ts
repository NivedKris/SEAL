import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS as C, type EvalRunDoc } from "@/lib/db/schemas";
import { activeRules } from "@/lib/rules/active";
import { RULE_SET_VERSION } from "@/lib/rules/library";
import { HOLD_THRESHOLD } from "@/lib/check/run";
import { dubaiIso } from "@/lib/util/time";
import { loadBatch } from "./batch";
import { scoreClaim, trainStats } from "./model";

type Labels = Record<string, { refused: boolean; denialCodes: string[] }>;

/** Re-score the held-out evaluation set (300 claims) and record precision, recall and calibration. */
export async function runEvaluation(d: Db, cycleId?: string): Promise<EvalRunDoc> {
  const set = (await d.collection(C.evalSets).findOne({})) as { _id: string; claimIds: string[]; labels: Labels } | null;
  if (!set) throw new Error("no evaluation set");
  const [batch, rules, stats] = await Promise.all([loadBatch(d, { _id: { $in: set.claimIds as never[] } }), activeRules(d), trainStats(d)]);
  const rows = batch.map((b) => {
    const s = scoreClaim(b, rules, stats);
    return { id: b.claim._id, payer: b.claim.payerId, p: s.p, held: s.definite || s.p >= HOLD_THRESHOLD, refused: !!set.labels[b.claim._id]?.refused };
  });
  const n = rows.length;
  const held = rows.filter((r) => r.held);
  const refused = rows.filter((r) => r.refused);
  const tp = held.filter((r) => r.refused).length;
  const calibration = Array.from({ length: 10 }, (_, i) => {
    const inBin = rows.filter((r) => Math.min(9, Math.floor(r.p * 10)) === i);
    return { bin: i, predicted: inBin.length ? inBin.reduce((s, r) => s + r.p, 0) / inBin.length : (i + 0.5) / 10, actual: inBin.length ? inBin.filter((r) => r.refused).length / inBin.length : 0, n: inBin.length };
  });
  // AUC by rank comparison (n is small).
  let wins = 0;
  const neg = rows.filter((r) => !r.refused);
  for (const a of refused) for (const b of neg) wins += a.p > b.p ? 1 : a.p === b.p ? 0.5 : 0;
  const byPayer: EvalRunDoc["byPayer"] = {};
  for (const r of rows) {
    const x = (byPayer[r.payer] ??= { n: 0, refused: 0, meanPredicted: 0 });
    x.n++;
    x.refused += r.refused ? 1 : 0;
    x.meanPredicted += r.p;
  }
  for (const x of Object.values(byPayer)) x.meanPredicted = Math.round((x.meanPredicted / x.n) * 1000) / 1000;
  const run: EvalRunDoc = {
    _id: `eval-${Date.now()}`,
    evalSetId: set._id,
    judge: "trained_model",
    precision: held.length ? tp / held.length : 0,
    recall: refused.length ? tp / refused.length : 0,
    calibration,
    at: dubaiIso(),
    n,
    brier: rows.reduce((s, r) => s + (r.p - (r.refused ? 1 : 0)) ** 2, 0) / n,
    auc: refused.length && neg.length ? wins / (refused.length * neg.length) : undefined,
    firstPassBaseline: 1 - refused.length / n,
    // Assumes every held claim is fixed before sending (what SEAL is for); refusals it missed still happen.
    firstPassWithSeal: 1 - refused.filter((r) => !r.held).length / n,
    byPayer,
    ruleSetVersion: RULE_SET_VERSION,
    activeRules: rules.length,
    cycleId,
  };
  await d.collection(C.evalRuns).insertOne(run as never);
  return run;
}

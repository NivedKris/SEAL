import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import type { Rule } from "@/lib/rules/dsl";
import { checkLine } from "@/lib/rules/engine";
import type { BatchClaim } from "./batch";

/**
 * The "trained model" judge (plan §10 judges): refusal rate per insurer and code learned from the
 * outcome ledger, combined with the rule engine. Cheap enough to score the whole evaluation set
 * every learning cycle (the LLM judge is too slow for 300 claims on the current Groq limits).
 */
export type Stats = { rate: (payer: string, code: string) => number; overall: number; rows: number };
const SMOOTH = 20;
const RULE_DEFINITE = 0.7;
const RULE_POSSIBLE = 0.25;

export async function trainStats(d: Db): Promise<Stats> {
  const [billed, refused] = await Promise.all([
    d.collection(C.outcomes).aggregate([{ $unwind: "$codes" }, { $group: { _id: { p: "$payerId", c: "$codes" }, n: { $sum: 1 } } }]).toArray(),
    d.collection(C.outcomes).aggregate([{ $unwind: "$refusedLines" }, { $group: { _id: { p: "$payerId", c: "$refusedLines.code" }, n: { $sum: 1 } } }]).toArray(),
  ]);
  const n = new Map(billed.map((x) => [`${x._id.p}|${x._id.c}`, x.n as number]));
  const r = new Map(refused.map((x) => [`${x._id.p}|${x._id.c}`, x.n as number]));
  const totalN = [...n.values()].reduce((a, b) => a + b, 0);
  const totalR = [...r.values()].reduce((a, b) => a + b, 0);
  const overall = totalR / Math.max(1, totalN);
  return { overall, rows: totalN, rate: (p, c) => ((r.get(`${p}|${c}`) ?? 0) + SMOOTH * overall) / ((n.get(`${p}|${c}`) ?? 0) + SMOOTH) };
}

export function scoreClaim(b: BatchClaim, rules: Rule[], stats: Stats) {
  const ctx = b.ctx();
  const lines = b.claim.versions[0].lines.map((l) => {
    const hits = checkLine(rules, ctx, { code: l.code, quantity: l.quantity }, "claim");
    const ruleP = hits.some((h) => h.fired === true) ? RULE_DEFINITE : hits.length ? RULE_POSSIBLE : 0;
    const p = 1 - (1 - stats.rate(b.claim.payerId, l.code)) * (1 - ruleP);
    return { activityId: l.activityId, code: l.code, p, definite: hits.some((h) => h.fired === true) };
  });
  return { p: 1 - lines.reduce((s, l) => s * (1 - l.p), 1), lines, definite: lines.some((l) => l.definite) };
}

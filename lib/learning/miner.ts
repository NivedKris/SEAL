import "server-only";
import type { Db } from "mongodb";
import { z } from "zod";
import { emit } from "@/lib/db/events";
import { COLLECTIONS as C, type RuleProposalDoc } from "@/lib/db/schemas";
import { Predicate, Rule } from "@/lib/rules/dsl";
import { anyMatch, checkLine, evaluate } from "@/lib/rules/engine";
import { activeRules } from "@/lib/rules/active";
import { loadPrompt, runAgent } from "@/lib/ai/agent";
import { denialInfo } from "@/lib/claims/denial-codes";
import { cptKind, cptLabel } from "@/lib/codes";
import { DAY, dubaiIso } from "@/lib/util/time";
import { loadBatch, type BatchClaim } from "./batch";

/**
 * Rule miner (plan §10, path 2): cluster recent first-pass refusals by insurer, service and denial
 * code; a cluster of ≥ 8 in 30 days that no active rule explains becomes a proposed rule in the DSL,
 * back-tested on the window, for a person to approve in /rules.
 */
export const MIN_SUPPORT = 8;
export const WINDOW_DAYS = 30;

export type Cluster = { clusterId: string; payerId: string; code: string; denialCode: string; count: number; claimIds: string[]; explained?: number; explainedShare?: number; /** Refusals no active rule flags: what the miner learns from. */ unexplainedClaimIds?: string[] };

export async function findClusters(d: Db, now = Date.now()): Promise<Cluster[]> {
  const evalIds = ((await d.collection(C.evalSets).findOne({}))?.claimIds ?? []) as string[];
  const since = new Date(now - WINDOW_DAYS * DAY).toISOString();
  const rows = await d
    .collection(C.remittances)
    .aggregate([
      { $match: { claimVersion: 1, readyAt: { $gte: since.replace("Z", "+00:00"), $lte: new Date(now).toISOString() }, claimId: { $nin: evalIds } } },
      { $unwind: "$lines" },
      { $match: { "lines.denialCode": { $exists: true } } },
      { $group: { _id: { p: "$payerId", c: "$lines.code", dc: "$lines.denialCode" }, n: { $sum: 1 }, claims: { $addToSet: "$claimId" } } },
      { $match: { n: { $gte: MIN_SUPPORT } } },
      { $sort: { n: -1 } },
    ])
    .toArray();
  const rules = await activeRules(d);
  const candidates = rows
    .map((r) => ({ clusterId: `${r._id.p}|${r._id.c}|${r._id.dc}`, payerId: r._id.p as string, code: r._id.c as string, denialCode: r._id.dc as string, count: r.n as number, claimIds: r.claims as string[] }))
    .filter((c) => !c.denialCode.startsWith("ELIG") && !c.denialCode.startsWith("TIME"))
    .slice(0, 12);
  if (!candidates.length) return [];
  // "No matching rule" = SEAL's active rules don't flag most of the cluster's refusals (applying to the code is not enough).
  const batch = await loadBatch(d, { _id: { $in: [...new Set(candidates.flatMap((c) => c.claimIds))] as never[] } });
  const byId = new Map(batch.map((b) => [b.claim._id, b]));
  return candidates
    .map((c) => {
      const unexplained: string[] = [];
      for (const id of c.claimIds) {
        const b = byId.get(id);
        const line = b?.claim.versions[0].lines.find((l) => l.code === c.code);
        if (!(b && line && checkLine(rules, b.ctx(), { code: line.code, quantity: line.quantity }, "claim").some((h) => h.rule.denialCode === c.denialCode))) unexplained.push(id);
      }
      const explained = c.claimIds.length - unexplained.length;
      return { ...c, explained, explainedShare: explained / c.claimIds.length, unexplainedClaimIds: unexplained };
    })
    .filter((c) => c.explainedShare < 0.5);
}

const features = (b: BatchClaim, code: string) => {
  const prev = b.ctx().history.filter((h) => h.code === code && h.at < b.at).sort((x, y) => y.at - x.at)[0];
  return {
    diagnoses: b.diagnoses.map((x) => x.code),
    age: b.age,
    specialty: b.specialty,
    otherServices: b.claim.versions[0].lines.map((l) => l.code).filter((c) => c !== code),
    daysSincePreviousSameService: prev ? Math.round((b.at - prev.at) / DAY) : null,
  };
};

/**
 * Candidate conditions as real DSL predicates (single features, negations, and pairs), each
 * back-tested on the refused and paid examples. The model chooses among these and words the rule.
 */
function candidates(refused: BatchClaim[], paid: BatchClaim[], code: string) {
  const feats: { label: string; p: Predicate }[] = [];
  const prefixes = [...new Set([...refused, ...paid].flatMap((b) => b.diagnoses.map((x) => x.code.slice(0, 3))))];
  for (const p of prefixes) feats.push({ label: `diagnosis ${p}*`, p: { op: "hasDiagnosis", codes: [`${p}*`] } });
  feats.push({ label: "diabetes diagnosis (E10*, E11*, E13*)", p: { op: "hasDiagnosis", codes: ["E10*", "E11*", "E13*"] } });
  for (const days of [90, 180, 365]) feats.push({ label: `same service within ${days} days`, p: { op: "priorActivityWithin", codes: [code], days } });
  feats.push({ label: "age 65 or over", p: { op: "patientAge", gte: 65 } });
  const fires = (p: Predicate, b: BatchClaim) => evaluate(p, b.ctx(), { code, quantity: 1 }) === true;
  const stat = (p: Predicate) => ({ refused: refused.filter((b) => fires(p, b)).length, paid: paid.filter((b) => fires(p, b)).length });
  const score = (x: { refused: number; paid: number }) => x.refused / Math.max(1, refused.length) - 1.5 * (x.paid / Math.max(1, paid.length));
  const singles = feats.flatMap((f) => [{ label: f.label, p: f.p }, { label: `NOT ${f.label}`, p: { op: "not", of: f.p } as Predicate }]).map((c) => ({ ...c, ...stat(c.p) }));
  // Pair the best separators with the features that cover most refusals (a broad feature narrowed by another).
  const byScore = [...singles].sort((x, y) => score(y) - score(x)).slice(0, 8);
  const byCoverage = [...singles].filter((x) => x.refused / Math.max(1, refused.length) >= 0.6).sort((x, y) => y.refused - x.refused || x.paid - y.paid).slice(0, 6);
  const top = [...new Map([...byScore, ...byCoverage].map((x) => [x.label, x])).values()];
  const pairs = top.flatMap((x, i) => top.slice(i + 1).map((y) => ({ label: `${x.label} AND ${y.label}`, p: { op: "all", of: [x.p, y.p] } as Predicate }))).map((c) => ({ ...c, ...stat(c.p) }));
  // Occam: a two-feature condition must beat a single one by a clear margin (small gains are usually noise).
  const PAIR_PENALTY = 0.1;
  const scored = [...singles.map((c) => ({ ...c, s: score(c) })), ...pairs.map((c) => ({ ...c, s: score(c) - PAIR_PENALTY }))];
  return scored
    .sort((x, y) => y.s - x.s)
    .slice(0, 6)
    .map((c) => ({ condition: c.label, when: c.p, refusedMatched: `${c.refused}/${refused.length}`, paidMatched: `${c.paid}/${paid.length}` }));
}

const MinerOut = z.object({ title: z.string().min(5), insurerNeeds: z.string().min(5), when: Predicate, rationale: z.string() });

/** Propose a rule for one cluster and back-test it on the window. */
export async function proposeRule(d: Db, cluster: Cluster, now = Date.now()): Promise<RuleProposalDoc | null> {
  const existing = await d.collection(C.ruleProposals).findOne({ clusterId: cluster.clusterId, status: { $in: ["proposed", "approved"] } });
  if (existing) return null;
  const since = new Date(now - WINDOW_DAYS * DAY);
  // Refused examples, and paid claims for the same insurer + service in the same window.
  // Learn only from refusals SEAL's current rules don't already explain.
  const refused = await loadBatch(d, { _id: { $in: (cluster.unexplainedClaimIds ?? cluster.claimIds) as never[] } }, { withRemittances: true });
  const paidCandidates = await loadBatch(d, { payerId: cluster.payerId, evalSet: false, "versions.0.lines.code": cluster.code, "versions.0.sentAt": { $gte: since.toISOString().replace("Z", "+00:00") }, _id: { $nin: cluster.claimIds as never[] } }, { withRemittances: true, limit: 400 });
  const paid = paidCandidates.filter((b) => b.firstPass && [...b.firstPass.entries()].some(([a, dc]) => !dc && b.claim.versions[0].lines.find((l) => l.activityId === a)?.code === cluster.code));
  const r = await runAgent(d, {
    agent: "ruleMiner",
    promptVersion: "rule-miner/v1",
    system: loadPrompt("rule-miner", "v1"),
    user: JSON.stringify({
      cluster: { insurer: cluster.payerId, service: `${cluster.code} ${cptLabel(cluster.code)}`, denialCode: cluster.denialCode, description: denialInfo(cluster.denialCode).description, refusalsIn30Days: cluster.count },
      candidateConditions: candidates(refused, paid, cluster.code),
      refused: refused.slice(0, 14).map((b) => features(b, cluster.code)),
      paid: paid.slice(0, 14).map((b) => features(b, cluster.code)),
    }),
    schema: MinerOut,
  });
  const family = cluster.denialCode.split("-")[0] as Rule["family"];
  const id = `MINED-${cluster.payerId.toUpperCase()}-${cluster.code}-${cluster.denialCode.replace("-", "")}`;
  const rule = Rule.parse({
    id,
    version: 1,
    title: r.data.title,
    family,
    denialCode: cluster.denialCode,
    denialCodeBasis: "inferred",
    payers: [cluster.payerId],
    target: { activityType: 3, codes: [cluster.code], kind: (cptKind(cluster.code) ?? "procedure") as Rule["target"]["kind"] },
    when: r.data.when,
    stages: ["point_of_care", "claim"],
    severity: "high",
    insurerNeeds: r.data.insurerNeeds,
    fixTemplates: [],
    fixActions: ["add_documentation", "link_diagnosis", "remove_order"],
    source: { title: `Outcome ledger: ${cluster.count} refusals in ${WINDOW_DAYS} days`, publisher: "SEAL rule miner", url: `https://seal.invalid/rules/proposals/${encodeURIComponent(cluster.clusterId)}`, quote: r.data.rationale.slice(0, 400) },
    verified: false,
    notes: "Learned from outcomes; not from a published guideline. Approve only after review.",
  });
  // Back-test: how many of the cluster's refusals it flags, and how many paid claims it would flag too.
  const fires = (b: BatchClaim) => b.claim.versions[0].lines.some((l) => anyMatch([cluster.code], l.code) && evaluate(rule.when, b.ctx(), { code: l.code, quantity: l.quantity }) === true);
  const backtest = { caught: refused.filter(fires).length, refusedInCluster: refused.length, firedOnPaid: paid.filter(fires).length, paidChecked: paid.length };
  const proposal: RuleProposalDoc = {
    _id: `prop-${cluster.payerId}-${cluster.code}-${Date.now()}`,
    clusterId: cluster.clusterId,
    dsl: rule,
    supportCount: backtest.caught,
    exampleClaimIds: refused.filter(fires).slice(0, 12).map((b) => b.claim._id),
    status: "proposed",
    payerId: cluster.payerId,
    codes: [cluster.code],
    denialCode: cluster.denialCode,
    windowDays: WINDOW_DAYS,
    backtest,
    rationale: r.data.rationale,
    aiCallId: r.call._id,
    writtenBy: { kind: "agent", id: "rule-miner" },
    writtenAt: dubaiIso(),
  };
  await d.collection(C.ruleProposals).insertOne(proposal as never);
  await emit("rule.proposed", { proposalId: proposal._id, ruleId: id, clusterId: cluster.clusterId, caught: backtest.caught, firedOnPaid: backtest.firedOnPaid }, { kind: "agent", id: "rule-miner" });
  return proposal;
}

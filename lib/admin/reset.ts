import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { invalidateRuleCache } from "@/lib/rules/active";
import { runEvaluation } from "@/lib/learning/evaluate";
import seed from "./scenario-seed.json";
import { seedWorkday, WORKDAY_PREFIX } from "./workday";
import { seedClinics } from "./clinics";

/**
 * Reset to the seeded state (plan §9.8 /admin): remove everything the live demo wrote and restore
 * the scenario records (S1–S8) from the committed seed extract. The 20k-claim history is untouched,
 * so this takes seconds; a full re-seed is `npm run seed:load -- --reset` (about 25 minutes).
 */
export async function resetDemo(d: Db, opts: { clearAiCalls?: boolean; workday?: boolean } = {}) {
  const live = (await d.collection(C.claims).find({ claimNo: /-L\d+$/ }, { projection: { _id: 1 } }).toArray()).map((c) => c._id as unknown as string);
  // Today's working-day encounters from the previous reset.
  const wdEnc = (await d.collection(C.encounters).find({ _id: { $regex: `^${WORKDAY_PREFIX}-` } as never }, { projection: { _id: 1 } }).toArray()).map((e) => String(e._id));
  const scenarioClaims = seed.claims.map((c) => c._id);
  const touched = [...live, ...scenarioClaims];
  const r: Record<string, number> = {};
  const del = async (col: string, filter: object) => (r[col] = (r[col] ?? 0) + (await d.collection(col).deleteMany(filter)).deletedCount);
  await del(C.claims, { _id: { $in: touched as never[] } });
  await del(C.findings, {});
  await del(C.questionSets, {});
  await del(C.recoveryDrafts, {});
  await del(C.remittances, { claimId: { $in: touched } });
  await del(C.denials, { claimId: { $in: touched } });
  // Seeded outcomes (incl. the scenario history) stay; only rows the live ledger wrote go.
  await del(C.outcomes, { $or: [{ _id: { $in: live as never[] } }, { "writtenBy.id": "outcome-ledger" }] });
  await del(C.mockDhpo, {});
  await del(C.events, {});
  await del(C.ruleProposals, {});
  await del(C.learningCycles, {});
  await del(C.evalRuns, {});
  await del(C.rules, { author: "rule-miner" });
  await del(C.priorAuths, { "writtenBy.kind": "mock_insurer" });
  if (opts.clearAiCalls) await del(C.aiCalls, {});
  // Scenario encounters (and any encounter created live), their orders and diagnoses: back to the seed.
  await del(C.orders, { encounterId: { $in: wdEnc } });
  await del(C.diagnoses, { encounterId: { $in: wdEnc } });
  await del(C.encounters, { _id: { $in: wdEnc as never[] } });
  const encIds = seed.encounters.map((e) => e._id);
  await del(C.orders, { encounterId: { $in: encIds } });
  await del(C.diagnoses, { encounterId: { $in: encIds } });
  await del(C.encounters, { _id: { $in: encIds as never[] } });
  for (const [col, docs] of [[C.encounters, seed.encounters], [C.orders, seed.orders], [C.diagnoses, seed.diagnoses], [C.claims, seed.claims], [C.remittances, seed.remittances], [C.denials, seed.denials]] as const)
    if (docs.length) await d.collection(col).insertMany(docs as never[]);
  await d.collection(C.counters).updateOne({ _id: "claimNo" as never }, { $set: { seq: 0 } }, { upsert: true });
  await d.collection(C.settings).updateOne({ _id: "settings" as never }, { $set: { insurerDelaySeconds: 20, killSwitches: {}, modelOverrides: {} } }, { upsert: true });
  await d.collection(C.judges).updateOne({ _id: "judges" as never }, { $set: { active: "agentic_llm", shadow: null } }, { upsert: true });
  invalidateRuleCache();
  const baseline = await runEvaluation(d);
  const workday = opts.workday === false ? null : await seedWorkday(d).catch((e) => ({ error: (e as Error).message }));
  // Every doctor's clinic for today (open visits, from each doctor's own history).
  const clinics = opts.workday === false ? null : await seedClinics(d).catch((e) => ({ error: (e as Error).message }));
  return { workday, clinics, removed: r, restored: { encounters: seed.encounters.length, orders: seed.orders.length, claims: seed.claims.length }, baselineEval: baseline._id };
}

export const SEED_META = { meta: seed.meta, assumptions: seed.assumptions, counts: seed.counts };

/**
 * Phase 7 learning check: run one learning cycle (clusters → proposals → evaluation), test the
 * proposed rule on history, then (with --keep) leave the results, else delete what it created.
 *   NODE_OPTIONS=--conditions=react-server node --env-file=.env node_modules/.bin/tsx scripts/dev/phase7-learning.ts [--keep]
 */
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { runLearningCycle, testRule } from "@/lib/learning/cycle";
import { Rule } from "@/lib/rules/dsl";

async function main() {
  const d = await db();
  const t = Date.now();
  const { cycle, proposals, after } = await runLearningCycle(d, (s) => console.log(`[${((Date.now() - t) / 1000).toFixed(1)} s] ${s.step}: ${JSON.stringify(s.detail)}`));
  for (const p of proposals) {
    const rule = Rule.parse(p.dsl);
    console.log(`\nproposal ${rule.id}: ${rule.title}\n  when ${JSON.stringify(rule.when)}\n  ${p.rationale}`);
    console.log(`  history test: ${JSON.stringify(await testRule(d, rule))}`);
  }
  console.log(`\neval: precision ${after.precision.toFixed(3)} recall ${after.recall.toFixed(3)} auc ${after.auc?.toFixed(3)} brier ${after.brier?.toFixed(3)} first-pass ${after.firstPassBaseline?.toFixed(3)} → ${after.firstPassWithSeal?.toFixed(3)}`);
  console.log(`calibration: ${after.calibration.map((b) => `${b.bin}:${b.n}@${b.actual.toFixed(2)}`).join(" ")}`);
  if (!process.argv.includes("--keep")) {
    await d.collection(C.ruleProposals).deleteMany({ _id: { $in: cycle.proposals as never[] } });
    await d.collection(C.evalRuns).deleteOne({ _id: cycle.evalRunId as never });
    await d.collection(C.learningCycles).deleteOne({ _id: cycle._id as never });
    await d.collection(C.events).deleteMany({ $or: [{ "payload.cycleId": cycle._id }, { "payload.proposalId": { $in: cycle.proposals } }] });
    await d.collection(C.aiCalls).deleteMany({ agent: "ruleMiner", at: { $gte: new Date(t).toISOString() } });
    console.log("cleaned up");
  }
  console.log(`${((Date.now() - t) / 1000).toFixed(1)} s`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

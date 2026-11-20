/**
 * Phase 7 check (cleans up after itself):
 *  S6 — reader → drafter → coder recode → approve → resubmit → paid → outcome in the ledger (embedded)
 *  S7 — learning cycle proposes the Gulf Shield lipid rule → approve → the next such order is caught at /emr
 *  AI Health numbers match direct queries on aiCalls and outcomes.
 *   NODE_OPTIONS=--conditions=react-server node --env-file=.env node_modules/.bin/tsx scripts/dev/phase7-check.ts
 */
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C, type ClaimDoc, type RecoveryDraftDoc } from "@/lib/db/schemas";
import { approveRecovery, draftRecovery, readDenials } from "@/lib/recovery/recovery";
import { pollRemittances } from "@/lib/claims/ingest";
import { runLearningCycle, decideProposal } from "@/lib/learning/cycle";
import { checkOrders } from "@/lib/check/orders";
import { healthMetrics } from "@/lib/health/metrics";
import { invalidateRuleCache } from "@/lib/rules/active";
import { Rule } from "@/lib/rules/dsl";
import { anyMatch } from "@/lib/rules/engine";

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T0 = new Date().toISOString();

async function main() {
  const d = await db();
  const cleanup: (() => Promise<unknown>)[] = [];
  try {
    // ── S6 recovery on a copy of the seeded refused claim ──
    console.log("S6: refused abdominal CT → recovery");
    const s6 = (await d.collection(C.claims).findOne({ _id: "clm-S6" as never })) as unknown as ClaimDoc;
    const cid = "clm-T7-S6";
    const no = "SSH-2026-T7S6";
    await d.collection(C.claims).insertOne({ ...s6, _id: cid as never, claimNo: no, scenario: "T7-S6" });
    const ra = await d.collection(C.remittances).findOne({ claimId: "clm-S6" });
    await d.collection(C.remittances).insertOne({ ...ra!, _id: `${cid}-ra1` as never, claimId: cid });
    const den = await d.collection(C.denials).findOne({ claimId: "clm-S6" });
    await d.collection(C.denials).insertOne({ ...den!, _id: `${cid}-den${den!.activityId}` as never, claimId: cid, remittanceId: `${cid}-ra1`, deadline: new Date(Date.now() + 30 * 86_400_000).toISOString() });
    cleanup.push(async () => {
      for (const col of [C.remittances, C.denials, C.recoveryDrafts]) await d.collection(col).deleteMany({ claimId: cid });
      await d.collection(C.claims).deleteOne({ _id: cid as never });
      await d.collection(C.outcomes).deleteOne({ _id: cid as never });
      await d.collection(C.mockDhpo).deleteMany({ claimIds: no });
      await d.collection(C.events).deleteMany({ "payload.claimId": cid });
    });
    const read = await readDenials(d, cid);
    check(read.length === 1, `denial reader: ${read[0]?.rootCause} (recoverable ${read[0]?.recoverable}, ${read[0]?.action})`);
    const draft: RecoveryDraftDoc = await draftRecovery(d, cid);
    check(!!draft.letter && draft.evidence.length > 0, `drafter: ${draft.type} with ${draft.evidence.length} evidence items · flags ${draft.flags.join(",") || "none"}`);
    console.log(`         coder review: ${draft.coderReview || "—"}\n         letter: ${(draft.letter ?? "").slice(0, 260).replace(/\n/g, " ")}…`);
    check(!/\bR10\.3\d\b|\bR50\.\d/.test(`${draft.letter} ${draft.coderReview}`), "the drafter proposed no new diagnosis code");
    // The coder (a person) picks the codes the note supports.
    await approveRecovery(d, draft._id, { type: draft.type, letter: draft.letter ?? "", diagnoses: [{ code: "R10.31", type: "Principal" }, { code: "R50.9", type: "Secondary" }] }, { kind: "user", id: "coder-rania" }, { delaySeconds: 1 });
    await sleep(1600);
    await pollRemittances({ database: d });
    const after = (await d.collection(C.claims).findOne({ _id: cid as never })) as unknown as ClaimDoc;
    const dAfter = await d.collection(C.denials).findOne({ claimId: cid });
    const outcome = await d.collection(C.outcomes).findOne({ _id: cid as never });
    check(after.status === "paid" && dAfter?.status === "won", `resubmitted as ${after.versions[1]?.resubmissionType} → ${after.status}, denial ${dAfter?.status}`);
    check(!!outcome?.embedding && outcome.refusedLines?.[0]?.recovered === true, `outcome ledger: ${outcome?.finalStatus}, recovered ${outcome?.refusedLines?.[0]?.recovered}, embedded ${!!outcome?.embedding}`);

    // ── S7 learning ──
    console.log("S7: Gulf Shield lipid pattern → rule → caught at point of care");
    const { cycle, proposals } = await runLearningCycle(d, (s) => s.step !== "evaluation" && console.log(`         ${s.step}: ${JSON.stringify(s.detail).slice(0, 200)}`));
    cleanup.push(async () => {
      await d.collection(C.ruleProposals).deleteMany({ _id: { $in: cycle.proposals as never[] } });
      await d.collection(C.evalRuns).deleteOne({ _id: cycle.evalRunId as never });
      await d.collection(C.learningCycles).deleteOne({ _id: cycle._id as never });
      await d.collection(C.events).deleteMany({ $or: [{ "payload.cycleId": cycle._id }, { "payload.proposalId": { $in: cycle.proposals } }] });
    });
    const p = proposals.find((x) => x.payerId === "gulfshield");
    check(!!p, `rule proposed: ${p ? Rule.parse(p.dsl).title : "none"} · caught ${p?.backtest?.caught}/${p?.backtest?.refusedInCluster}, paid flagged ${p?.backtest?.firedOnPaid}/${p?.backtest?.paidChecked}`);
    if (p) {
      const rule = Rule.parse(p.dsl);
      await decideProposal(d, p._id, "approved", "rania-fakhoury");
      cleanup.push(async () => {
        await d.collection(C.rules).deleteOne({ _id: rule.id as never });
        invalidateRuleCache();
        await d.collection(C.events).deleteMany({ "payload.ruleId": rule.id });
      });
      // A Gulf Shield patient with a lipid panel in the past year and no diabetes, back for a new lipid panel.
      const recent = await d.collection(C.claims).find({ payerId: "gulfshield", evalSet: false, "versions.0.lines.code": "80061" }, { projection: { patientId: 1, memberId: 1, providerId: 1, encounterId: 1 } }).sort({ createdAt: -1 }).limit(60).toArray();
      let target: (typeof recent)[number] | undefined;
      for (const c of recent) {
        const dx = await d.collection(C.diagnoses).find({ encounterId: c.encounterId }).toArray();
        if (!dx.some((x) => anyMatch(["E10*", "E11*", "E13*"], x.icd10 as string))) {
          target = c;
          break;
        }
      }
      const eid = "enc-T7-S7";
      await d.collection(C.encounters).insertOne({ _id: eid as never, patientId: target!.patientId, memberId: target!.memberId, providerId: target!.providerId, facilityId: "DHA-F-SEAL001", type: 1, start: new Date().toISOString().replace("Z", "+00:00"), status: "open", complaint: "Annual review. Feels well.", findings: "BP 128/80. BMI 26.", plan: "Lipid profile.", noteVersions: [], evalSet: false, scenario: "T7-S7", writtenBy: { kind: "emr", id: "test" }, writtenAt: new Date().toISOString() });
      await d.collection(C.diagnoses).insertOne({ _id: `${eid}-dx1` as never, encounterId: eid, icd10: "Z00.00", description: "General adult medical examination", primary: true, source: "doctor", writtenBy: { kind: "emr", id: "test" }, writtenAt: new Date().toISOString() });
      await d.collection(C.orders).insertOne({ _id: `${eid}-o1` as never, encounterId: eid, kind: "lab", activityType: 3, code: "80061", label: "Lipid panel", quantity: 1, linkedDiagnoses: ["Z00.00"], justificationStatus: "unchecked", orderedAt: new Date().toISOString(), writtenBy: { kind: "emr", id: "test" }, writtenAt: new Date().toISOString() });
      cleanup.push(async () => {
        await d.collection(C.encounters).deleteOne({ _id: eid as never });
        for (const col of [C.orders, C.diagnoses, C.findings]) await d.collection(col).deleteMany({ encounterId: eid });
      });
      invalidateRuleCache();
      const t = Date.now();
      const r = await checkOrders(eid, d, "rules");
      const card = r.orders[0]?.cards.find((x) => x.ruleId === rule.id);
      check(!!card, `next Gulf Shield lipid order caught at point of care in ${Date.now() - t} ms: ${card?.title ?? "no card"}`);
    }

    // ── AI Health vs direct queries ──
    console.log("AI Health numbers match direct queries");
    const h = await healthMetrics(d);
    const direct = await d.collection(C.aiCalls).aggregate([{ $group: { _id: "$agent", n: { $sum: 1 }, fb: { $sum: { $cond: ["$fallbackUsed", 1, 0] } }, tin: { $sum: "$tokensIn" } } }]).toArray();
    const mismatch = direct.filter((x) => {
      const o = h.operations.find((y) => y.agent === x._id);
      return !o || o.calls !== x.n || Math.round((o.fallbackRate ?? 0) * x.n) !== x.fb || o.tokensIn !== x.tin;
    });
    check(mismatch.length === 0 && h.calls === (await d.collection(C.aiCalls).countDocuments()), `operations: ${direct.length} agents, ${h.calls} calls — counts, fallbacks and tokens identical`);
    const lastEval = await d.collection(C.evalRuns).find({}).sort({ at: -1 }).limit(1).next();
    check(!lastEval || h.quality.eval?.holdPrecision === lastEval.precision, `quality: hold precision ${h.quality.eval?.holdPrecision?.toFixed(3)} = evalRuns ${lastEval?.precision?.toFixed(3)}`);
  } finally {
    for (const f of cleanup.reverse()) await f().catch((e) => console.log("cleanup:", e.message));
    await d.collection(C.aiCalls).deleteMany({ at: { $gte: T0 } });
    console.log("cleaned up");
  }
  console.log(failures ? `${failures} FAILED` : "all checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

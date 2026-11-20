/**
 * Phase 6 check on COPIES of the scenarios (cleaned up): S5 must give exactly 3, 1 and 0 questions;
 * S1's questions are answered, submitted, the addendum is attached (verbatim), and the re-check
 * clears the documentation gap.
 *   NODE_OPTIONS=--conditions=react-server node --env-file=.env node_modules/.bin/tsx scripts/dev/phase6-check.ts
 */
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C, type ClaimDoc, type QuestionSetDoc } from "@/lib/db/schemas";
import { signEncounter } from "@/lib/claims/builder";
import { runClaimCheck, warmEmbeddings } from "@/lib/check/run";
import { integrateAnswers, saveAnswer, submitAnswers } from "@/lib/questions/answers";
import { claimVersionXml } from "@/lib/claims/submit";

const TAG = "T6";
const ACTOR = { kind: "system" as const, id: "phase6-check" };
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures++;
};

async function main() {
  const d = await db();
  const claimIds: string[] = [];
  const encIds: string[] = [];
  await warmEmbeddings();
  const copy = async (sc: string) => {
    const src = `enc-${sc}`;
    const id = `enc-${TAG}-${sc}`;
    const e = await d.collection(C.encounters).findOne({ _id: src as never });
    await d.collection(C.encounters).insertOne({ ...e!, _id: id as never, status: "open", scenario: `${TAG}-${sc}` });
    for (const col of [C.orders, C.diagnoses]) {
      const docs = await d.collection(col).find({ encounterId: src }).toArray();
      if (docs.length) await d.collection(col).insertMany(docs.map((x) => ({ ...x, _id: String(x._id).replace(src, id) as never, encounterId: id })));
    }
    encIds.push(id);
    const claim = await signEncounter(id, ACTOR);
    claimIds.push(claim._id);
    const out = await runClaimCheck(claim._id);
    const set = (await d.collection(C.questionSets).findOne({ claimId: claim._id, status: "open" })) as QuestionSetDoc | null;
    return { claim, out, set };
  };
  try {
    console.log("S5: the question set follows the claim");
    for (const [sc, want] of (process.argv.includes("--s1") ? [] : [["S5a", 3], ["S5b", 1], ["S5c", 0]]) as [string, number][]) {
      const { out, set } = await copy(sc);
      const n = set?.questions.length ?? 0;
      check(n === want, `${sc}: ${n} question${n === 1 ? "" : "s"} (want ${want}) · route ${out?.route} · ${set ? `worded by ${set.composedBy}` : "no set"}`);
      for (const q of set?.questions ?? []) console.log(`         · ${q.order}: ${q.textEn}\n           ${q.textAr}\n           fields: ${q.fields.map((f) => `${f.key}(${f.kind}${f.options ? `: ${f.options.join("/")}` : ""})`).join(", ")}`);
    }

    console.log("S1: answer → addendum → re-check");
    const { claim, set } = await copy("S1");
    check(!!set && set.questions.length === 1, `S1: ${set?.questions.length} question (MRI; duration + neuro finding merged)`);
    const q = set!.questions[0];
    const answer: Record<string, string | number> = {};
    for (const f of q.fields)
      answer[f.key] =
        f.key === "duration_value" ? 8 : f.key === "duration_unit" ? "weeks" : f.key === "treatment" ? "physiotherapy and ibuprofen for 4 weeks" : f.key === "treatment_outcome" ? "no improvement" : f.key === "neuro_finding" ? "reduced power 4/5 left ankle dorsiflexion, absent left ankle reflex, SLR positive at 40°" : f.key === "red_flag" ? "none" : "see note";
    await saveAnswer(d, set!._id, q.gapId, answer, { kind: "user", id: "dr-omar-haddad" });
    const t0 = Date.now();
    const r = await submitAnswers(d, set!._id, { kind: "user", id: "dr-omar-haddad" });
    const enc = await d.collection(C.encounters).findOne({ _id: claim.encounterId as never });
    check(Date.now() - t0 < 3000 && !!enc?.addenda?.length, `addendum attached ${Date.now() - t0} ms after Submit; SEAL hold flag ${enc?.sealHold ? "still on" : "cleared"}`);
    check(Object.values(answer).every((v) => r.text.includes(String(v))), "every answer appears verbatim in the addendum");
    console.log(r.text.split("\n").map((l) => `         ${l}`).join("\n"));
    const res = await integrateAnswers(d, set!._id);
    console.log(`         integrator: ${JSON.stringify(res)}`);
    const re = await runClaimCheck(claim._id, { force: true });
    const xml = await claimVersionXml((await d.collection(C.claims).findOne({ _id: claim._id as never })) as unknown as ClaimDoc, undefined, d);
    check(xml.includes("<Observation>") && xml.includes("Addendum"), "addendum travels on the claim as an eClaimLink Observation");
    check(!re?.holdReasons.some((h) => h.includes("DAMAN-SPINE-BACKPAIN")), `re-check (${re?.mode}): documentation gap cleared · route ${re?.route} (${re?.holdReasons.join(" | ") || "no reasons"})`);
  } finally {
    await d.collection(C.claims).deleteMany({ _id: { $in: claimIds as never[] } });
    for (const col of [C.findings, C.questionSets]) await d.collection(col).deleteMany({ claimId: { $in: claimIds } });
    await d.collection(C.encounters).deleteMany({ _id: { $in: encIds as never[] } });
    for (const col of [C.orders, C.diagnoses]) await d.collection(col).deleteMany({ encounterId: { $in: encIds } });
    await d.collection(C.events).deleteMany({ $or: [{ "payload.claimId": { $in: claimIds } }, { "payload.encounterId": { $in: encIds } }] });
    await d.collection(C.aiCalls).deleteMany({ $or: [{ "subject.claimId": { $in: claimIds } }, { "subject.encounterId": { $in: encIds } }] });
    console.log(`cleaned up ${claimIds.length} claims`);
  }
  console.log(failures ? `${failures} FAILED` : "all checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

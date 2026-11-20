/**
 * Phase 4 check on COPIES of the scenario encounters (cleaned up afterwards): sign → claim →
 * real-time check (rules, retrieval, judge, critic, routing). Prints timings and routing.
 *
 *   NODE_OPTIONS=--conditions=react-server node --env-file=.env node_modules/.bin/tsx scripts/dev/phase4-check.ts [S1 S4 …] [--no-groq]
 */
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C, type EventDoc } from "@/lib/db/schemas";
import { signEncounter } from "@/lib/claims/builder";
import { runClaimCheck, warmEmbeddings } from "@/lib/check/run";

const TAG = "T4";
const ACTOR = { kind: "system" as const, id: "phase4-check" };
const args = process.argv.slice(2);
const SCEN = args.filter((a) => !a.startsWith("--")).length ? args.filter((a) => !a.startsWith("--")) : ["S1", "S2", "S4", "S5a", "S5c", "S8"];
const EXPECT: Record<string, string> = {
  S1: "hold: MRI documentation (duration/prior treatment + neuro finding) and no prior approval",
  S2: "hold: HbA1c repeat reason, C-peptide not indicated",
  S4: "hold: 6 sessions billed, approval for 4 (fix)",
  S5a: "hold: 3 documentation gaps (MRI, shockwave, vitamin D)",
  S5b: "hold: 1 documentation gap (vitamin D)",
  S5c: "ready: no gaps",
  S8: "hold: repeat screening within 90 days (fix)",
  S3: "hold: vitamin D without a linked qualifying diagnosis",
};

async function main() {
  const d = await db();
  if (args.includes("--no-groq")) await d.collection(C.settings).updateOne({ _id: "settings" as never }, { $set: { "killSwitches.groq": true } });
  const claimIds: string[] = [];
  const encIds: string[] = [];
  const t = Date.now();
  await warmEmbeddings();
  console.log(`embedding model ready in ${Date.now() - t} ms`);
  try {
    for (const sc of SCEN) {
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
      const evs = (await d.collection(C.events).find({ "payload.claimId": claim._id }).sort({ seq: 1 }).toArray()) as unknown as EventDoc[];
      const at = (stage: string) => evs.find((x) => x.payload.stage === stage)?.payload.ms;
      const judge = evs.find((x) => x.payload.stage === "judge")?.payload as Record<string, unknown> | undefined;
      const critic = evs.find((x) => x.payload.stage === "critic")?.payload as Record<string, unknown> | undefined;
      console.log(`\n${sc} → ${out?.route?.toUpperCase()} risk ${out?.riskScore}  (${out?.mode})   expected ${EXPECT[sc] ?? "?"}`);
      console.log(`   timings: rules ${at("rules")} ms · retrieval ${at("retrieval")} ms · judge ${at("judge")} ms (${judge?.provider}/${judge?.model}${judge?.fallbackUsed ? ", fallback" : ""}) · critic ${at("critic")} ms (${critic?.provider ?? critic?.error}) · total ${out?.ms} ms`);
      if (judge?.error) console.log(`   judge error: ${judge.error}`);
      if (judge?.flags && (judge.flags as string[]).length) console.log(`   guardrail flags: ${(judge.flags as string[]).join(", ")}${(judge.rejectedQuotes as string[])?.length ? ` · rejected quotes: ${(judge.rejectedQuotes as string[]).map((q) => `«${q}»`).join(" ")}` : ""}`);
      for (const r of out?.holdReasons ?? []) console.log(`   • ${r}`);
      const c = await d.collection(C.claims).findOne({ _id: claim._id as never });
      console.log(`   line risk: ${Object.entries(c!.check.lineRisk).map(([k, v]) => `${c!.versions[0].lines.find((l: { activityId: string }) => l.activityId === k).code}=${v}`).join(" ")}`);
      for (const a of (judge?.documentation as { concept: string; activityId: string; documented: boolean; evidence: string }[]) ?? []) console.log(`   doc ${a.activityId}/${a.concept}: ${a.documented ? `yes «${a.evidence}»` : "no"}`);
      if (critic && !critic.error) console.log(`   critic: ${critic.verdict}/${critic.agreement} — ${critic.note}`);
      for (const a of await d.collection(C.aiCalls).find({ "subject.claimId": claim._id }).sort({ at: 1 }).toArray())
        console.log(`   call ${a.agent}: ${a.provider}/${a.model} ${a.status} in ${a.tokensIn}/out ${a.tokensOut} ${a.latencyMs} ms${a.fallbackUsed ? " FALLBACK" : ""}${a.error ? ` — ${String(a.error).replace(/\{"error".*?"message":"/g, "").slice(0, 600)}` : ""}${a.guardrailFlags?.length ? ` flags ${a.guardrailFlags.join(",")}` : ""}`);
    }
  } finally {
    if (args.includes("--no-groq")) await d.collection(C.settings).updateOne({ _id: "settings" as never }, { $unset: { "killSwitches.groq": "" } });
    await d.collection(C.claims).deleteMany({ _id: { $in: claimIds as never[] } });
    await d.collection(C.findings).deleteMany({ claimId: { $in: claimIds } });
    await d.collection(C.encounters).deleteMany({ _id: { $in: encIds as never[] } });
    await d.collection(C.orders).deleteMany({ encounterId: { $in: encIds } });
    await d.collection(C.diagnoses).deleteMany({ encounterId: { $in: encIds } });
    await d.collection(C.events).deleteMany({ $or: [{ "payload.claimId": { $in: claimIds } }, { "payload.encounterId": { $in: encIds } }] });
    await d.collection(C.aiCalls).deleteMany({ "subject.claimId": { $in: claimIds } });
    console.log(`\ncleaned up ${claimIds.length} test claims`);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

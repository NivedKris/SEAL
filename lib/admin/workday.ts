import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS as C, type ClaimDoc } from "@/lib/db/schemas";
import { createClaimForEncounter } from "@/lib/claims/builder";
import { submitClaim } from "@/lib/claims/submit";
import { pollRemittances } from "@/lib/claims/ingest";
import { runClaimCheck } from "@/lib/check/run";
import { DAY, dubaiIso } from "@/lib/util/time";

/**
 * A realistic working day for the billing team after a reset: today's earlier patients (copied
 * from older visits in the history), signed, built into claims and checked with the rules +
 * trained model (no AI calls, so it is fast and free). Some stay ready, some are already with the
 * insurer and arrive over the next minutes, a couple are already paid. Scenario cases are untouched.
 */
export const WORKDAY_PREFIX = "enc-W";

export async function seedWorkday(d: Db, want = { held: 3, ready: 6 }) {
  const count = (want.held + want.ready) * 3;
  const now = Date.now();
  const from = new Date(now - 330 * DAY).toISOString().replace("Z", "+04:00");
  const to = new Date(now - 200 * DAY).toISOString().replace("Z", "+04:00");
  const pool = await d
    .collection(C.claims)
    .aggregate([{ $match: { evalSet: false, scenario: { $exists: false }, status: "paid", createdAt: { $gte: from, $lte: to } } }, { $sample: { size: count * 2 } }])
    .toArray();
  const seen = new Set<string>();
  const picks = pool.filter((c) => !seen.has(c.patientId) && seen.add(c.patientId)).slice(0, count);
  let n = 0;

  const judges = await d.collection(C.judges).findOne({ _id: "judges" as never });
  await d.collection(C.judges).updateOne({ _id: "judges" as never }, { $set: { active: "trained_model" } });
  const claims: ClaimDoc[] = [];
  try {
    const today = new Date(new Date(now + 4 * 3600_000).toISOString().slice(0, 10) + "T08:00:00+04:00").getTime();
    for (const src of picks) {
      const held = claims.filter((c) => c.status === "hold").length;
      if (held >= want.held && claims.length - held >= want.ready) break;
      const enc = await d.collection(C.encounters).findOne({ _id: src.encounterId });
      if (!enc) continue;
      const i = n++;
      const id = `${WORKDAY_PREFIX}-${String(i + 1).padStart(2, "0")}`;
      const start = dubaiIso(today + claims.length * 25 * 60_000);
      await d.collection(C.encounters).insertOne({ ...enc, _id: id as never, start, status: "signed", noteVersions: [], scenario: undefined, writtenAt: start });
      for (const col of [C.orders, C.diagnoses]) {
        const docs = await d.collection(col).find({ encounterId: enc._id }).toArray();
        if (docs.length) await d.collection(col).insertMany(docs.map((x, j) => ({ ...x, _id: `${id}-${col === C.orders ? "o" : "dx"}${j + 1}` as never, encounterId: id, orderedAt: start })));
      }
      const claim = await createClaimForEncounter(id, { kind: "user", id: "dr-on-duty" }, d);
      await runClaimCheck(claim._id, { database: d }).catch(() => null);
      const checked = (await d.collection(C.claims).findOne({ _id: claim._id as never })) as unknown as ClaimDoc;
      // Keep the day balanced: discard extra held claims (and their encounter) once we have enough.
      if (checked.status === "hold" && claims.filter((c) => c.status === "hold").length >= want.held) {
        await d.collection(C.claims).deleteOne({ _id: claim._id as never });
        for (const col of [C.findings, C.questionSets]) await d.collection(col).deleteMany({ claimId: claim._id });
        await d.collection(C.events).deleteMany({ "payload.claimId": claim._id });
        await d.collection(C.encounters).deleteOne({ _id: id as never });
        for (const col of [C.orders, C.diagnoses]) await d.collection(col).deleteMany({ encounterId: id });
        continue;
      }
      claims.push(checked);
    }
  } finally {
    await d.collection(C.judges).updateOne({ _id: "judges" as never }, { $set: { active: judges?.active ?? "agentic_llm" } });
  }

  // Ready ones: two are already paid, three arrive during the next minutes, the rest wait to be sent.
  const ready = claims.filter((c) => c.status === "ready");
  const actor = { kind: "user" as const, id: "noura-al-mansoori" };
  for (const c of ready.slice(0, 2)) await submitClaim(c._id, actor, { database: d, delaySeconds: 0 });
  for (const [i, c] of ready.slice(2, 4).entries()) await submitClaim(c._id, actor, { database: d, delaySeconds: 120 + i * 120 });
  await pollRemittances({ database: d });
  return { claims: claims.length, held: claims.filter((c) => c.status === "hold").length, ready: Math.max(0, ready.length - 4), withInsurer: Math.min(2, Math.max(0, ready.length - 2)), paidOrRefused: Math.min(2, ready.length) };
}

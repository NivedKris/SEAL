/**
 * Phase 3 end-to-end check on COPIES of the seeded scenarios (ids "…-T3-…"); everything it
 * creates is deleted at the end, so the seeded demo state is untouched.
 *
 *   sign → claim built + XML valid → submit → post office holds it until readyAt (lazy delay)
 *   → poll → insurer adjudicates once (even with parallel polls) → remittance, denials, status
 *   → S6 correction resubmission → paid.
 *
 *   NODE_OPTIONS=--conditions=react-server node --env-file=.env node_modules/.bin/tsx scripts/dev/phase3-e2e.ts
 */
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C, type ClaimDoc, type DenialDoc, type RemittanceDoc } from "@/lib/db/schemas";
import { createClaimForEncounter, signEncounter } from "@/lib/claims/builder";
import { createResubmission, submitClaim } from "@/lib/claims/submit";
import { pollRemittances } from "@/lib/claims/ingest";
import { parseTransaction } from "@/lib/claims/xml";
import { uploadTransaction } from "@/lib/mock/dhpo";

const TAG = "T3";
const ACTOR = { kind: "system" as const, id: "phase3-e2e" };
const DELAY = 15;
const SCENARIOS = ["S1", "S2", "S3", "S4", "S5a", "S5b", "S5c", "S8"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures++;
};

async function main() {
  const d = await db();
  const claimIds: string[] = [];
  const claimNos: string[] = [];
  const encIds: string[] = [];
  try {
    // ── Copies of the open scenario encounters ──
    for (const sc of SCENARIOS) {
      const src = `enc-${sc}`;
      const id = `enc-${TAG}-${sc}`;
      const e = await d.collection(C.encounters).findOne({ _id: src as never });
      if (!e) throw new Error(`${src} missing — seed the database first`);
      await d.collection(C.encounters).insertOne({ ...e, _id: id as never, status: "open", scenario: `${TAG}-${sc}` });
      for (const col of [C.orders, C.diagnoses]) {
        const docs = await d.collection(col).find({ encounterId: src }).toArray();
        if (docs.length) await d.collection(col).insertMany(docs.map((x) => ({ ...x, _id: String(x._id).replace(src, id) as never, encounterId: id })));
      }
      encIds.push(id);
    }

    console.log("claim creation");
    const claims: ClaimDoc[] = [];
    for (const id of encIds) {
      const t = Date.now();
      const claim = await signEncounter(id, ACTOR);
      claims.push(claim);
      claimIds.push(claim._id);
      claimNos.push(claim.claimNo);
      const tx = parseTransaction(claim.versions[0].xml!);
      const enc = await d.collection(C.encounters).findOne({ _id: id as never });
      check(tx.kind === "Claim.Submission" && claim.status === "ready" && enc?.status === "claimed", `${id} → ${claim.claimNo}: ${claim.versions[0].lines.map((l) => `${l.code}×${l.quantity}${l.priorAuthId ? "(PA)" : ""}`).join(" ")} · AED ${claim.net} · ${Date.now() - t} ms`);
    }
    const again = await createClaimForEncounter(encIds[0], ACTOR);
    check(again._id === claims[0]._id, "building twice returns the same claim (idempotent)");

    console.log("submission and lazy delay");
    for (const c of claims) await submitClaim(c._id, ACTOR, { delaySeconds: DELAY });
    const early = (await pollRemittances()).filter((r) => claimIds.includes(r.claimId));
    check(early.length === 0, `poll before readyAt returns nothing (${early.length})`);
    await sleep(DELAY * 1000 + 500);
    const [a, b] = await Promise.all([pollRemittances(), pollRemittances()]);
    const got = [...a, ...b].filter((r) => claimIds.includes(r.claimId));
    check(got.length === claims.length && new Set(got.map((r) => r.claimId)).size === claims.length, `two parallel polls after readyAt: ${got.length} remittances for ${claims.length} claims, none twice`);
    const files = await d.collection(C.mockDhpo).countDocuments({ kind: "Remittance.Advice", claimIds: { $in: claimNos } });
    check(files === claims.length, `insurer answered each file exactly once (${files} remittance files)`);
    check((await pollRemittances()).filter((r) => claimIds.includes(r.claimId)).length === 0, "a further poll is a no-op");

    console.log("outcomes (mock insurer; probabilistic, deterministic per file)");
    for (const c of claims) {
      const rem = (await d.collection(C.remittances).findOne({ claimId: c._id })) as RemittanceDoc | null;
      const st = (await d.collection(C.claims).findOne({ _id: c._id as never }))!.status;
      const dens = (await d.collection(C.denials).find({ claimId: c._id }).toArray()) as unknown as DenialDoc[];
      console.log(`       ${c.scenario!.padEnd(7)} ${st.padEnd(14)} ${rem!.lines.map((l) => (l.denialCode ? `${l.code}✗${l.denialCode}` : `${l.code}✓`)).join(" ")}${dens.length ? ` · ${dens.length} queued` : ""}`);
      check(rem!.lines.every((l) => !l.denialCode || dens.some((x) => x.activityId === l.activityId)), `${c.scenario}: every refused line has a denial with a deadline`);
    }
    const evs = await d.collection(C.events).find({ "payload.claimId": { $in: claimIds } }).toArray();
    const types = new Set(evs.map((e) => e.type));
    check(["claim.created", "claim.submitted", "remittance.received"].every((t) => types.has(t)), `events written: ${[...types].sort().join(", ")}`);

    console.log("post office validation");
    const bad = claims[0].versions[0].xml!.replace(/<Type>Principal<\/Type>/, "<Type>Secondary</Type>");
    const r = await uploadTransaction(bad, { delaySeconds: 0 });
    check(r.result === -3, `file without a principal diagnosis rejected: ${r.result === -3 ? r.errors[0] : "accepted!"}`);

    console.log("S6 correction resubmission");
    const s6 = (await d.collection(C.claims).findOne({ _id: "clm-S6" as never })) as ClaimDoc | null;
    if (!s6) throw new Error("clm-S6 missing");
    const cid = `clm-${TAG}-S6`;
    const no = `SSH-2026-${TAG}S6`;
    claimIds.push(cid);
    claimNos.push(no);
    await d.collection(C.claims).insertOne({ ...s6, _id: cid as never, claimNo: no, scenario: `${TAG}-S6` });
    const ra = await d.collection(C.remittances).findOne({ claimId: "clm-S6" });
    await d.collection(C.remittances).insertOne({ ...ra!, _id: `${cid}-ra1` as never, claimId: cid });
    const den = await d.collection(C.denials).findOne({ claimId: "clm-S6" });
    await d.collection(C.denials).insertOne({ ...den!, _id: `${cid}-den${den!.activityId}` as never, claimId: cid, remittanceId: `${cid}-ra1` });
    await createResubmission(
      cid,
      {
        type: "correction",
        comment: "Diagnosis corrected by coder: right lower quadrant pain with fever, as documented in the ER note.",
        activityIds: [den!.activityId],
        diagnoses: [{ code: "R10.31", type: "Principal" }, { code: "R50.9", type: "Secondary" }],
      },
      { kind: "user", id: "coder" },
    );
    await submitClaim(cid, ACTOR, { delaySeconds: 1 });
    await sleep(1500);
    const res = (await pollRemittances()).find((x) => x.claimId === cid);
    const after = (await d.collection(C.claims).findOne({ _id: cid as never })) as ClaimDoc | null;
    const denAfter = await d.collection(C.denials).findOne({ claimId: cid });
    const v2 = parseTransaction(after!.versions[1].xml!);
    check(v2.kind === "Claim.Submission" && v2.data.Claim[0].Resubmission?.Type === "correction", "version 2 filed as an eClaimLink correction resubmission");
    check(res?.version === 2 && after?.status === "paid" && denAfter?.status === "won", `S6 corrected claim: ${after?.status}, denial ${denAfter?.status}`);
  } finally {
    // ── Clean up everything this run created ──
    await d.collection(C.claims).deleteMany({ _id: { $in: claimIds as never[] } });
    await d.collection(C.remittances).deleteMany({ claimId: { $in: claimIds } });
    await d.collection(C.denials).deleteMany({ claimId: { $in: claimIds } });
    await d.collection(C.mockDhpo).deleteMany({ claimIds: { $in: claimNos } });
    await d.collection(C.encounters).deleteMany({ _id: { $in: encIds as never[] } });
    await d.collection(C.orders).deleteMany({ encounterId: { $in: encIds } });
    await d.collection(C.diagnoses).deleteMany({ encounterId: { $in: encIds } });
    await d.collection(C.events).deleteMany({ $or: [{ "payload.claimId": { $in: claimIds } }, { "payload.encounterId": { $in: encIds } }] });
    console.log(`cleaned up ${claimIds.length} test claims`);
  }
  console.log(failures ? `${failures} check(s) FAILED` : "all checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

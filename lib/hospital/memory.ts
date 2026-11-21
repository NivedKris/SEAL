import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { isKnownDenialCode, denialInfo } from "@/lib/claims/denial-codes";
import { embedTexts, toVector } from "@/lib/ai/embed";
import { dubaiIso } from "@/lib/util/time";
import { insurerName } from "./names";
import type { HospitalClaim } from "./profile";

/**
 * A hospital's own past claims, added to SEAL's memory of past claims (the outcome ledger the
 * "Past claims" step searches). Each claim becomes one outcome: insurer, clinician, value,
 * refusal codes and whether resubmission won it back. Remittance exports carry no services or
 * diagnoses, so these match on insurer, clinician and value, not code by code.
 */
export const HOSPITAL_MEMORY_PREFIX = "hx-";

const status = (r: HospitalClaim) => (r.paymentStatus === "Payment" ? "paid" : r.paymentStatus === "Partial Payment" ? "partially_paid" : r.paymentStatus === "Rejected" ? "refused" : "pending");

export function toOutcome(raw: HospitalClaim, ctx: { hospital: string; payerName: string; specialty: string; clinician: string }) {
  const r = { ...raw, denialCodes: raw.denialCodes.filter((c) => !!c && !["nan", "none", "null"].includes(c.trim().toLowerCase())) };
  const refused = r.rejected > 0.005 || r.resubCount > 0;
  const recovered = r.resubCount > 0 && r.rejected <= 0.005;
  const reasons = r.denialCodes.map((c) => `${c}${isKnownDenialCode(c) ? ` ${denialInfo(c).description}` : ""}`);
  const settle = r.activityDate && r.settledOn ? Math.round((Date.parse(r.settledOn) - Date.parse(r.activityDate)) / 86_400_000) : null;
  return {
    _id: `${HOSPITAL_MEMORY_PREFIX}${r.claim}`,
    claimId: `${HOSPITAL_MEMORY_PREFIX}${r.claim}`,
    payerId: r.payerId ?? `ins-${r.insurerCode}`,
    specialty: ctx.specialty,
    theme: "hospital-history",
    codes: [] as string[],
    diagnoses: [] as string[],
    finalStatus: status(r),
    gross: Math.round((r.submitted + r.deductible) * 100) / 100,
    paid: r.remitted,
    firstPassRefused: refused,
    refusedCodes: r.denialCodes,
    refusedLines: r.denialCodes.map((c) => ({ code: "", denialCode: c, amount: Math.round((r.rejected / Math.max(1, r.denialCodes.length)) * 100) / 100, recovered })),
    fixesApplied: r.resubCount > 0 ? [`Resubmitted ${r.resubCount === 1 ? "once" : `${r.resubCount} times`}`] : [],
    daysToCash: settle != null && settle >= 0 ? settle : null,
    predictedProbability: null,
    summary: [
      `Insurer: ${ctx.payerName}. Specialty: ${ctx.specialty.replace(/_/g, " ")}. Visit type: outpatient. Clinician: ${ctx.clinician}.`,
      `Claim value: AED ${Math.round(r.submitted)}.`,
      refused ? `Refused: ${reasons.join("; ") || "part of the claim"}.` : "Paid on first submission.",
      r.resubCount > 0 ? `Resubmitted. Result: ${recovered ? "recovered" : "still refused"}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    hospital: ctx.hospital,
    clinician: ctx.clinician,
    activityDate: r.activityDate,
    closedAt: r.settledOn ? `${r.settledOn}T12:00:00+04:00` : null,
    writtenBy: { kind: "system" as const, id: "hospital-history" },
    writtenAt: dubaiIso(),
  };
}

/** Add every claim to the memory; embed the ones live claims can match (insurers on live claims). */
export async function importHospitalMemory(d: Db, hospital: string, rows: HospitalClaim[], log: (s: string) => void = () => {}) {
  const [payers, providers] = await Promise.all([d.collection(C.payers).find({}).toArray(), d.collection(C.providers).find({}).toArray()]);
  const payerName = new Map(payers.map((p) => [String(p._id), String(p.name)]));
  const prov = new Map(providers.map((p) => [String(p._id), p]));
  const outcomes = d.collection(C.outcomes);
  await outcomes.deleteMany({ _id: { $regex: `^${HOSPITAL_MEMORY_PREFIX}` } as never });
  // Only claims to insurers that appear on live claims can be matched (the search filters by insurer).
  const live = new Set(payers.map((p) => String(p._id)));
  const docs = rows.filter((r) => r.payerId && live.has(r.payerId)).map((r) => {
    const p = r.providerId ? prov.get(r.providerId) : undefined;
    return toOutcome(r, { hospital, payerName: r.payerId ? (payerName.get(r.payerId) ?? insurerName(r.insurer)) : insurerName(r.insurer), specialty: String(p?.specialty ?? "general practice"), clinician: String(p?.name ?? r.clinician) });
  });
  for (let i = 0; i < docs.length; i += 5000) await outcomes.insertMany(docs.slice(i, i + 5000) as never[], { ordered: false });
  log(`added ${docs.length} ${hospital} claims to the memory`);

  const todo = docs;
  const t0 = Date.now();
  for (let i = 0; i < todo.length; i += 128) {
    const batch = todo.slice(i, i + 128);
    const vecs = await embedTexts(batch.map((x) => x.summary));
    await outcomes.bulkWrite(batch.map((x, j) => ({ updateOne: { filter: { _id: x._id as never }, update: { $set: { embedding: toVector(vecs[j]) } } } })), { ordered: false });
    if ((i / 128) % 20 === 0) log(`  embedded ${i + batch.length}/${todo.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  // Record it as a learning step, so the learning battery counts these claims as learned.
  await d.collection(C.learningCycles).insertOne({ _id: `cycle-hospital-${Date.now()}`, at: dubaiIso(), startedAt: dubaiIso(t0), kind: "hospital_history", newOutcomes: rows.length, embedded: todo.length, clusters: 0, proposals: [], note: `${hospital}'s own claim history: profile from all ${rows.length} claims, ${docs.length} added to the memory of past claims` } as never);
  return { added: docs.length, embedded: todo.length };
}

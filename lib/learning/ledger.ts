import "server-only";
import type { Db } from "mongodb";
import { emit } from "@/lib/db/events";
import { COLLECTIONS as C, type ClaimDoc, type DiagnosisDoc, type OutcomeDoc, type PayerDoc, type ProviderDoc, type RemittanceDoc } from "@/lib/db/schemas";
import { embedTexts, toVector } from "@/lib/ai/embed";
import { cptLabel, icdLabel } from "@/lib/codes";
import { DAY, dubaiIso } from "@/lib/util/time";

/**
 * Outcome ledger (plan §10, memory path): one row per claim, rewritten on every remittance. Each
 * row is embedded at once, so the claim judge's next search already sees it.
 */
export async function recordOutcome(d: Db, claimId: string) {
  const claim = (await d.collection(C.claims).findOne({ _id: claimId as never })) as ClaimDoc | null;
  if (!claim) return null;
  const [rems, payer, provider, dxDocs] = await Promise.all([
    d.collection(C.remittances).find({ claimId }).sort({ claimVersion: 1 }).toArray() as unknown as Promise<RemittanceDoc[]>,
    d.collection(C.payers).findOne({ _id: claim.payerId as never }) as Promise<PayerDoc | null>,
    d.collection(C.providers).findOne({ _id: claim.providerId as never }) as Promise<ProviderDoc | null>,
    d.collection(C.diagnoses).find({ encounterId: claim.encounterId }).toArray() as unknown as Promise<DiagnosisDoc[]>,
  ]);
  if (!rems.length) return null;
  const v1 = claim.versions[0];
  const dx = v1.diagnoses?.map((x) => x.code) ?? dxDocs.map((x) => x.icd10);
  const first = rems.find((r) => r.claimVersion === 1) ?? rems[0];
  const final = new Map<string, RemittanceDoc["lines"][number]>();
  for (const r of rems) for (const l of r.lines) final.set(l.activityId, l);
  const deniedFirst = first.lines.filter((l) => l.denialCode);
  const states = [...final.values()];
  const paid = Math.round(states.reduce((s, l) => s + l.paymentAmount, 0) * 100) / 100;
  const open = claim.status === "resubmitted" || (await d.collection(C.denials).countDocuments({ claimId, status: { $in: ["queued", "drafted", "resubmitted"] } })) > 0;
  const finalStatus: OutcomeDoc["finalStatus"] = open ? "pending" : states.every((l) => !l.denialCode) ? "paid" : paid > 0 ? "partially_paid" : "refused";
  const fixes = claim.versions.slice(1).map((v) => v.comment ?? v.resubmissionType ?? "resubmission");
  const lastPaid = [...rems].reverse().find((r) => r.lines.some((l) => l.paymentAmount > 0));
  const summary = [
    `Insurer: ${payer?.name}. Specialty: ${provider?.specialty}. Visit type: outpatient.`,
    `Diagnoses: ${dx.map((c) => `${c} ${icdLabel(c)}`).join("; ")}.`,
    `Services: ${v1.lines.map((l) => `${l.code} ${cptLabel(l.code)}${l.quantity > 1 ? ` x${l.quantity}` : ""}`).join("; ")}.`,
    deniedFirst.length ? `Refused: ${deniedFirst.map((l) => `${l.denialCode} on ${l.code} ${cptLabel(l.code)}`).join("; ")}.` : "Paid on first submission.",
    fixes.length ? `Resubmitted: ${fixes[0].slice(0, 160)}. Result: ${finalStatus === "paid" ? "recovered" : finalStatus}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const [vec] = await embedTexts([summary]);
  const doc: OutcomeDoc = {
    _id: claimId,
    claimId,
    payerId: claim.payerId,
    specialty: provider?.specialty ?? "",
    codes: v1.lines.map((l) => l.code),
    diagnoses: dx,
    finalStatus,
    gross: claim.gross,
    paid,
    firstPassRefused: deniedFirst.length > 0,
    refusedCodes: [...new Set(deniedFirst.map((l) => l.denialCode!))],
    refusedLines: deniedFirst.map((l) => ({ code: l.code, denialCode: l.denialCode!, amount: Math.round((l.net - l.paymentAmount) * 100) / 100, recovered: !final.get(l.activityId)!.denialCode })),
    fixesApplied: fixes,
    daysToCash: lastPaid && v1.sentAt ? Math.max(0, Math.round((new Date(lastPaid.receivedAt ?? lastPaid.readyAt).getTime() - new Date(v1.sentAt).getTime()) / DAY)) : null,
    predictedProbability: claim.riskScore,
    summary,
    embedding: toVector(vec),
    closedAt: finalStatus === "pending" ? null : dubaiIso(),
    writtenBy: { kind: "system", id: "outcome-ledger" },
    writtenAt: dubaiIso(),
  };
  await d.collection(C.outcomes).replaceOne({ _id: claimId as never }, doc as never, { upsert: true });
  await emit("outcome.recorded", { claimId, finalStatus, firstPassRefused: doc.firstPassRefused, predicted: claim.riskScore, paid }, { kind: "system", id: "outcome-ledger" });
  return doc;
}

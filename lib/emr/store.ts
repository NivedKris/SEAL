import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { emit } from "@/lib/db/events";
import { COLLECTIONS as C, type EncounterDoc, type OrderDoc } from "@/lib/db/schemas";
import { cptKind, cptLabel, icdLabel } from "@/lib/codes";
import { dubaiIso } from "@/lib/util/time";

/**
 * The EMR simulator's own writes (it owns clinical data, plan §6). The doctor edits the note,
 * orders and diagnoses here; SEAL only reads them (and later writes back its addendum + hold flag).
 */
const EMR = (doctor: string) => ({ kind: "emr" as const, id: doctor });

async function openEncounter(d: Db, id: string): Promise<EncounterDoc> {
  const e = (await d.collection(C.encounters).findOne({ _id: id as never })) as EncounterDoc | null;
  if (!e) throw new Error(`encounter ${id} not found`);
  if (e.status !== "open") throw new Error(`encounter ${id} is signed; the note can no longer change`);
  return e;
}

/** Save the note; every edit is kept as a version (plan §8). */
export async function saveNote(d: Db, id: string, patch: { complaint?: string; findings?: string; plan?: string }) {
  const e = await openEncounter(d, id);
  const next = { complaint: patch.complaint ?? e.complaint, findings: patch.findings ?? e.findings, plan: patch.plan ?? e.plan };
  if (next.complaint === e.complaint && next.findings === e.findings && next.plan === e.plan) return e;
  const version = (e.noteVersions.at(-1)?.version ?? 0) + 1;
  await d.collection(C.encounters).updateOne(
    { _id: id as never },
    { $set: next, $push: { noteVersions: { version, ...next, editedBy: EMR(e.providerId), editedAt: dubaiIso() } as never } },
  );
  await emit("encounter.updated", { encounterId: id, change: "note", version }, EMR(e.providerId));
  return { ...e, ...next };
}

const ACTIVITY_TYPE: Record<string, number> = { drug: 5 };

export async function addOrder(d: Db, id: string, code: string, quantity = 1): Promise<OrderDoc> {
  const e = await openEncounter(d, id);
  const kind = cptKind(code);
  if (!kind) throw new Error(`unknown order code ${code}`);
  const dx = await d.collection(C.diagnoses).find({ encounterId: id }).sort({ primary: -1 }).toArray();
  const order: OrderDoc = {
    _id: `${id}-o${randomUUID().slice(0, 8)}`,
    encounterId: id,
    kind: kind as OrderDoc["kind"],
    activityType: ACTIVITY_TYPE[kind] ?? 3,
    code,
    label: cptLabel(code),
    quantity,
    linkedDiagnoses: dx.slice(0, 1).map((x) => x.icd10 as string),
    justificationStatus: "unchecked",
    orderedAt: dubaiIso(),
    writtenBy: EMR(e.providerId),
    writtenAt: dubaiIso(),
  };
  await d.collection(C.orders).insertOne(order as never);
  await emit("encounter.updated", { encounterId: id, change: "order_added", orderId: order._id, code }, EMR(e.providerId));
  return order;
}

/** Removing an order is the doctor's decision; it stays on file as "removed" and is never billed. */
export async function removeOrder(d: Db, id: string, orderId: string) {
  const e = await openEncounter(d, id);
  await d.collection(C.orders).updateOne({ _id: orderId as never, encounterId: id }, { $set: { justificationStatus: "removed" } });
  await emit("encounter.updated", { encounterId: id, change: "order_removed", orderId }, EMR(e.providerId));
}

export async function addDiagnosis(d: Db, id: string, icd10: string, primary = false) {
  const e = await openEncounter(d, id);
  const label = icdLabel(icd10);
  if (label === icd10) throw new Error(`${icd10} is not a billable ICD-10-CM code`);
  if (await d.collection(C.diagnoses).findOne({ encounterId: id, icd10 })) return;
  if (primary) await d.collection(C.diagnoses).updateMany({ encounterId: id }, { $set: { primary: false } });
  const has = await d.collection(C.diagnoses).countDocuments({ encounterId: id });
  await d.collection(C.diagnoses).insertOne({ _id: `${id}-dx${randomUUID().slice(0, 8)}` as never, encounterId: id, icd10, description: label, primary: primary || has === 0, source: "doctor", writtenBy: EMR(e.providerId), writtenAt: dubaiIso() });
  await emit("encounter.updated", { encounterId: id, change: "diagnosis_added", icd10 }, EMR(e.providerId));
}

export async function removeDiagnosis(d: Db, id: string, dxId: string) {
  const e = await openEncounter(d, id);
  await d.collection(C.diagnoses).deleteOne({ _id: dxId as never, encounterId: id });
  await emit("encounter.updated", { encounterId: id, change: "diagnosis_removed", dxId }, EMR(e.providerId));
}

/**
 * Prior-approval request from the EMR. MOCK: the insurer approves at once for the ordered quantity
 * (the Dubai directive requires an answer within 6 h for elective outpatient requests).
 */
export async function requestPriorAuth(d: Db, id: string, orderId: string) {
  const e = await openEncounter(d, id);
  const o = (await d.collection(C.orders).findOne({ _id: orderId as never, encounterId: id })) as OrderDoc | null;
  if (!o) throw new Error(`order ${orderId} not found`);
  const member = await d.collection(C.members).findOne({ _id: e.memberId as never });
  const authNo = `PA-${String(member?.payerId ?? "XX").slice(0, 2).toUpperCase()}-L${randomUUID().slice(0, 6).toUpperCase()}`;
  const validTo = new Date(Date.now() + 30 * 86_400_000 + 4 * 3600_000).toISOString().slice(0, 10);
  await d.collection(C.priorAuths).insertOne({ _id: `pa-${randomUUID()}` as never, memberId: e.memberId, encounterId: id, codes: [o.code], approvedQty: o.quantity, requestedAt: dubaiIso(), validTo, status: "approved", authNo, writtenBy: { kind: "mock_insurer", id: String(member?.payerId) }, writtenAt: dubaiIso() });
  await emit("encounter.updated", { encounterId: id, change: "prior_auth_approved", orderId, authNo }, EMR(e.providerId));
  return { authNo, approvedQty: o.quantity, validTo };
}

import "server-only";
import type { Db } from "mongodb";
import { db as getDb } from "@/lib/db/mongo";
import { emit } from "@/lib/db/events";
import { COLLECTIONS as C, ClaimVersion, type ClaimDoc, type ClaimLineDoc, type ClaimVersionDoc, type DiagnosisDoc, type EncounterDoc, type EventDoc, type MemberDoc, type PatientDoc, type PayerDoc } from "@/lib/db/schemas";
import { dubaiIso } from "@/lib/util/time";
import { buildClaimSubmission } from "./xml";
import { submissionFor, type SubmissionParties } from "./builder";
import { MAX_RESUBMISSIONS } from "./facility";
import { dhpo } from "./dhpo-client";

type Actor = EventDoc["actor"];

async function partiesFor(claim: ClaimDoc, d: Db): Promise<SubmissionParties> {
  const [payer, member, patient, encounter] = await Promise.all([
    d.collection(C.payers).findOne({ _id: claim.payerId as never }) as Promise<PayerDoc | null>,
    d.collection(C.members).findOne({ _id: claim.memberId as never }) as Promise<MemberDoc | null>,
    d.collection(C.patients).findOne({ _id: claim.patientId as never }) as Promise<PatientDoc | null>,
    d.collection(C.encounters).findOne({ _id: claim.encounterId as never }) as Promise<EncounterDoc | null>,
  ]);
  if (!payer || !member || !patient || !encounter) throw new Error(`claim ${claim._id}: missing payer, member, patient or encounter`);
  return { payer, member, patient, encounter };
}

/** Diagnoses as filed in a version; seeded history falls back to the encounter's diagnoses. */
export async function versionDiagnoses(claim: ClaimDoc, v: ClaimVersionDoc, d: Db) {
  if (v.diagnoses?.length) return v.diagnoses;
  const dx = (await d.collection(C.diagnoses).find({ encounterId: claim.encounterId }).sort({ primary: -1, _id: 1 }).toArray()) as unknown as DiagnosisDoc[];
  return dx.map((x) => ({ code: x.icd10, type: x.primary ? ("Principal" as const) : ("Secondary" as const) }));
}

/** The eClaimLink XML for any version of a claim (stored for live claims, rebuilt for seeded history). */
export async function claimVersionXml(claim: ClaimDoc, version?: number, database?: Db): Promise<string> {
  const d = database ?? (await getDb());
  const v = version ? claim.versions.find((x) => x.version === version) : claim.versions.at(-1);
  if (!v) throw new Error(`claim ${claim._id} has no version ${version}`);
  if (v.xml) return v.xml;
  return buildClaimSubmission(submissionFor(claim, v, await versionDiagnoses(claim, v, d), await partiesFor(claim, d), v.sentAt ? new Date(v.sentAt).getTime() : Date.now()));
}

const SENDABLE_FIRST = new Set<ClaimDoc["status"]>(["draft", "ready"]);
const SENDABLE_RESUB = new Set<ClaimDoc["status"]>(["refused", "partially_paid"]);

/**
 * Send the claim's latest unsent version to the post office. A person triggers this (Submit, or
 * Approve and resubmit); a held claim goes only with an override reason.
 */
export async function submitClaim(claimId: string, actor: Actor, opts: { database?: Db; overrideReason?: string; delaySeconds?: number } = {}): Promise<ClaimDoc> {
  const d = opts.database ?? (await getDb());
  const claim = (await d.collection(C.claims).findOne({ _id: claimId as never })) as ClaimDoc | null;
  if (!claim) throw new Error(`claim ${claimId} not found`);
  const v = claim.versions.at(-1)!;
  if (v.sentAt) throw new Error(`claim ${claim.claimNo} version ${v.version} was already sent`);
  const first = v.version === 1;
  if (first && claim.status === "hold" && !opts.overrideReason) throw new Error(`claim ${claim.claimNo} is on hold; releasing it needs an override reason`);
  if (first && claim.status !== "hold" && !SENDABLE_FIRST.has(claim.status)) throw new Error(`claim ${claim.claimNo} is ${claim.status}`);
  if (!first && !SENDABLE_RESUB.has(claim.status)) throw new Error(`claim ${claim.claimNo} is ${claim.status}; only refused lines can be resubmitted`);
  if (v.version - 1 > MAX_RESUBMISSIONS) throw new Error(`claim ${claim.claimNo}: the Dubai directive allows ${MAX_RESUBMISSIONS} resubmissions`);

  const now = Date.now();
  const xml = buildClaimSubmission(submissionFor(claim, v, await versionDiagnoses(claim, v, d), await partiesFor(claim, d), now));
  const up = await dhpo.uploadTransaction(xml, { database: d, delaySeconds: opts.delaySeconds });
  if (up.result !== 0) throw new Error(`post office rejected ${claim.claimNo}: ${up.errors.join("; ")}`);

  const status = first ? "submitted" : "resubmitted";
  await d.collection(C.claims).updateOne(
    { _id: claimId as never, "versions.version": v.version },
    { $set: { status, "versions.$.xml": xml, "versions.$.sentAt": dubaiIso(now), "versions.$.transactionId": up.transactionId } },
  );
  if (first && claim.status === "hold") await emit("claim.released", { claimId, reason: opts.overrideReason }, actor);
  await emit(first ? "claim.submitted" : "resubmission.sent", { claimId, claimNo: claim.claimNo, version: v.version, transactionId: up.transactionId, readyAt: up.readyAt, net: claim.net }, actor);
  return (await d.collection(C.claims).findOne({ _id: claimId as never })) as unknown as ClaimDoc;
}

export type ResubmissionInput = {
  type: "correction" | "internal complaint";
  comment: string;
  /** Activities to resubmit (refused lines). */
  activityIds: string[];
  /** Corrections to those lines (codes/quantities come from the coder, never the AI). */
  lineEdits?: Record<string, Partial<Pick<ClaimLineDoc, "code" | "quantity" | "net" | "priorAuthId">>>;
  /** Corrected diagnoses (coder), if the correction changes them. */
  diagnoses?: { code: string; type: "Principal" | "Secondary" }[];
  attachmentText?: string;
};

/** Add the next version of a refused claim (not sent until submitClaim). */
export async function createResubmission(claimId: string, input: ResubmissionInput, actor: Actor, database?: Db): Promise<ClaimDoc> {
  const d = database ?? (await getDb());
  const claim = (await d.collection(C.claims).findOne({ _id: claimId as never })) as ClaimDoc | null;
  if (!claim) throw new Error(`claim ${claimId} not found`);
  if (!SENDABLE_RESUB.has(claim.status)) throw new Error(`claim ${claim.claimNo} is ${claim.status}`);
  const last = claim.versions.at(-1)!;
  if (!last.sentAt) throw new Error(`claim ${claim.claimNo} already has an unsent version ${last.version}`);
  if (last.version > MAX_RESUBMISSIONS) throw new Error(`claim ${claim.claimNo}: no resubmissions left`);

  // Latest filed state of each activity across versions.
  const latest = new Map<string, ClaimLineDoc>();
  for (const v of claim.versions) for (const l of v.lines) latest.set(l.activityId, l);
  const lines = input.activityIds.map((id) => {
    const l = latest.get(id);
    if (!l) throw new Error(`claim ${claim.claimNo} has no activity ${id}`);
    return { ...l, ...(input.lineEdits?.[id] ?? {}) };
  });
  const prevDx = await versionDiagnoses(claim, last, d);
  const v = ClaimVersion.parse({
    version: last.version + 1,
    resubmissionType: input.type,
    comment: input.comment,
    lines,
    diagnoses: input.diagnoses ?? prevDx,
    attachmentText: input.attachmentText,
  });
  // Validate the file before storing the version (the stored XML is built at send time).
  buildClaimSubmission(submissionFor(claim, v, v.diagnoses!, await partiesFor(claim, d), Date.now()));
  await d.collection(C.claims).updateOne({ _id: claimId as never }, { $push: { versions: v as never } });
  return (await d.collection(C.claims).findOne({ _id: claimId as never })) as unknown as ClaimDoc;
}

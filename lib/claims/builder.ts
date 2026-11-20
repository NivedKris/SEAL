import "server-only";
import type { Db } from "mongodb";
import { db as getDb } from "@/lib/db/mongo";
import { emit, nextSeq } from "@/lib/db/events";
import { Claim, COLLECTIONS as C, type ClaimDoc, type ClaimLineDoc, type ClaimVersionDoc, type EventDoc, type PatientDoc, type PayerDoc, type MemberDoc, type EncounterDoc } from "@/lib/db/schemas";
import { anyMatch } from "@/lib/rules/engine";
import { dubaiIso, eclaimDateTime } from "@/lib/util/time";
import { buildClaimSubmission } from "./xml";
import type { ClaimSubmission } from "./schema";
import { loadEncounterBundle, type EncounterBundle } from "./bundle";
import { FACILITY } from "./facility";

/**
 * Stage 2 of the flow (plan §5): when an encounter is signed, build the claim in the DHA
 * eClaimLink structure and validate it. Codes come from the doctor and coder only — the
 * builder copies them; it never chooses a diagnosis or a procedure code.
 */

type Actor = EventDoc["actor"];
const round2 = (n: number) => Math.round(n * 100) / 100;
const ER_TYPES = new Set([2, 4, 6]);

/**
 * E/M visit line. The doctor/coder may set encounter.visitCode; otherwise the coding
 * department's default applies (assumption, same as the seed): ER 99284, new patient 99203,
 * established 99213, therapy-only visits none.
 */
async function visitCodeFor(b: EncounterBundle, d: Db): Promise<string | null> {
  if (b.encounter.visitCode) return b.encounter.visitCode;
  if (ER_TYPES.has(b.encounter.type)) return "99284";
  if (b.provider.role === "therapist" || (b.orders.length > 0 && b.orders.every((o) => o.kind === "therapy"))) return null;
  const seenBefore = await d.collection(C.claims).findOne({ patientId: b.patient._id, encounterId: { $ne: b.encounter._id } }, { projection: { _id: 1 } });
  return seenBefore ? "99213" : "99203";
}

/** Priced claim lines from the encounter's orders (contract price × qty, less the plan co-pay; no co-pay in the ER). */
export function priceLines(b: EncounterBundle, visitCode: string | null): { lines: ClaimLineDoc[]; gross: number; net: number } {
  const copay = ER_TYPES.has(b.encounter.type) ? 0 : b.plan.copayPct;
  const at = new Date(b.encounter.start).getTime();
  const items = [
    ...(visitCode ? [{ code: visitCode, quantity: 1, activityType: 3, orderId: undefined as string | undefined }] : []),
    ...b.orders.map((o) => ({ code: o.code, quantity: o.quantity, activityType: o.activityType, orderId: o._id })),
  ];
  const missing = items.filter((i) => b.contract.prices[i.code] === undefined).map((i) => i.code);
  if (missing.length) throw new Error(`no contract price with ${b.payer.name} for ${missing.join(", ")}`);
  let gross = 0;
  const lines = items.map((i, idx): ClaimLineDoc => {
    const price = b.contract.prices[i.code] * i.quantity;
    gross += price;
    const auth = b.priorAuths.find((p) => p.status === "approved" && p.codes.some((c) => anyMatch([c], i.code)) && Date.parse(`${p.validTo}T23:59:59+04:00`) >= at);
    return {
      activityId: String(idx + 1),
      orderId: i.orderId,
      activityType: i.activityType,
      code: i.code,
      quantity: i.quantity,
      net: round2(price * (1 - copay)),
      clinician: b.provider.licenseNo,
      priorAuthId: auth?.authNo,
      start: b.encounter.start,
    };
  });
  return { lines, gross: round2(gross), net: round2(lines.reduce((s, l) => s + l.net, 0)) };
}

/** Everything the XML needs besides the claim itself. */
export type SubmissionParties = { payer: Pick<PayerDoc, "eclaimLinkId">; member: Pick<MemberDoc, "memberNo">; patient: Pick<PatientDoc, "emiratesId">; encounter: Pick<EncounterDoc, "type" | "start" | "end" | "patientId"> };

/** The eClaimLink Claim.Submission for one version of a claim (validated when built to XML). */
export function submissionFor(claim: ClaimDoc, version: ClaimVersionDoc, diagnoses: { code: string; type: "Principal" | "Secondary" }[], p: SubmissionParties, sentAtMs: number): ClaimSubmission {
  const start = new Date(p.encounter.start).getTime();
  const isEr = ER_TYPES.has(p.encounter.type);
  const net = round2(version.lines.reduce((s, l) => s + l.net, 0));
  // A resubmission files only the lines being resubmitted; amounts follow those lines.
  const gross = version.version === 1 ? claim.gross : round2(net + (claim.patientShare * net) / (claim.net || 1));
  return {
    Header: { SenderID: FACILITY.id, ReceiverID: p.payer.eclaimLinkId, TransactionDate: eclaimDateTime(sentAtMs), RecordCount: 1, DispositionFlag: "PRODUCTION" },
    Claim: [
      {
        ID: claim.claimNo,
        MemberID: p.member.memberNo,
        PayerID: p.payer.eclaimLinkId,
        ProviderID: FACILITY.id,
        EmiratesIDNumber: p.patient.emiratesId,
        Gross: gross,
        PatientShare: round2(gross - net),
        Net: net,
        Encounter: {
          FacilityID: FACILITY.id,
          Type: p.encounter.type,
          PatientID: `MRN-${p.encounter.patientId.replace(/^pat-/, "")}`,
          Start: eclaimDateTime(start),
          End: p.encounter.end ? eclaimDateTime(new Date(p.encounter.end).getTime()) : undefined,
          StartType: isEr ? 2 : 1,
          EndType: p.encounter.end ? 1 : undefined,
        },
        Diagnosis: diagnoses.map((d) => ({ Type: d.type, Code: d.code })),
        Activity: version.lines.map((l) => ({
          ID: l.activityId,
          Start: eclaimDateTime(new Date(l.start).getTime()),
          Type: l.activityType as 3,
          Code: l.code,
          Quantity: l.quantity,
          Net: l.net,
          Clinician: l.clinician,
          PriorAuthorizationID: l.priorAuthId ?? undefined,
          Observation: version.observations?.filter((o) => o.activityId === l.activityId).map((o) => ({ Type: "Text" as const, Code: o.code, Value: o.text, ValueType: "Text" })),
        })).map((a) => (a.Observation?.length ? a : { ...a, Observation: undefined })),
        Resubmission: version.resubmissionType
          ? {
              Type: version.resubmissionType,
              Comment: version.comment ?? "Resubmission",
              Attachment: version.attachmentText ? Buffer.from(version.attachmentText, "utf8").toString("base64") : undefined,
            }
          : undefined,
      },
    ],
  };
}

export const diagnosesOf = (b: Pick<EncounterBundle, "diagnoses">) =>
  b.diagnoses.map((d) => ({ code: d.icd10, type: d.primary ? ("Principal" as const) : ("Secondary" as const) }));

/** Build, validate and store the claim for a signed encounter. Idempotent: one claim per encounter. */
export async function createClaimForEncounter(encounterId: string, actor: Actor, database?: Db): Promise<ClaimDoc> {
  const d = database ?? (await getDb());
  const existing = (await d.collection(C.claims).findOne({ encounterId })) as ClaimDoc | null;
  if (existing) return existing;

  const b = await loadEncounterBundle(encounterId, d);
  if (b.encounter.status === "open") throw new Error(`encounter ${encounterId} is not signed yet`);
  if (!b.diagnoses.some((x) => x.primary)) throw new Error(`encounter ${encounterId} has no principal diagnosis`);
  if (b.diagnoses.some((x) => (x.source as string) !== "doctor" && (x.source as string) !== "coder")) throw new Error("diagnoses must come from the doctor or coder");

  const visit = await visitCodeFor(b, d);
  const { lines, gross, net } = priceLines(b, visit);
  if (!lines.length) throw new Error(`encounter ${encounterId} has nothing to bill`);
  const now = Date.now();
  const seq = await nextSeq("claimNo");
  const year = new Date(now + 4 * 3600_000).getUTCFullYear();
  const version: ClaimVersionDoc = { version: 1, lines, diagnoses: diagnosesOf(b) };
  const claim: ClaimDoc = Claim.parse({
    _id: `clm-L${String(seq).padStart(6, "0")}`,
    claimNo: `SSH-${year}-L${String(seq).padStart(6, "0")}`,
    encounterId,
    patientId: b.patient._id,
    memberId: b.member._id,
    payerId: b.payer._id,
    providerId: b.provider._id,
    gross,
    patientShare: round2(gross - net),
    net,
    // Phase 4 puts the live check between creation and Ready.
    status: "ready",
    versions: [version],
    riskScore: null,
    liveCheckState: "idle",
    createdAt: dubaiIso(now),
    evalSet: false,
    scenario: b.encounter.scenario,
    writtenBy: actor,
    writtenAt: dubaiIso(now),
  });
  // Validate against the R1 field rules before anything is stored.
  const v1 = claim.versions[0];
  v1.xml = buildClaimSubmission(submissionFor(claim, v1, v1.diagnoses!, b, now));

  await d.collection(C.claims).insertOne(claim as never);
  await d.collection(C.encounters).updateOne({ _id: encounterId as never }, { $set: { status: "claimed" } });
  await emit("claim.created", { claimId: claim._id, claimNo: claim.claimNo, encounterId, payerId: claim.payerId, net, lines: lines.length }, actor);
  return claim;
}

/** Sign an encounter (EMR action) and build its claim. */
export async function signEncounter(encounterId: string, actor: Actor, database?: Db): Promise<ClaimDoc> {
  const d = database ?? (await getDb());
  const r = await d.collection(C.encounters).findOneAndUpdate({ _id: encounterId as never, status: "open" }, { $set: { status: "signed" } }, { returnDocument: "after" });
  if (r) await emit("encounter.signed", { encounterId }, actor);
  return createClaimForEncounter(encounterId, actor, d);
}

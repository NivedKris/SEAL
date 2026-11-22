import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import { emit } from "@/lib/db/events";
import { COLLECTIONS as C, type ClaimDoc, type DenialDoc, type EncounterDoc, type EventDoc, type PriorAuthDoc, type RecoveryDraftDoc } from "@/lib/db/schemas";
import { denialInfo, isKnownDenialCode } from "@/lib/claims/denial-codes";
import { versionDiagnoses } from "@/lib/claims/submit";
import { MAX_RESUBMISSIONS } from "@/lib/claims/facility";
import { activeRules } from "@/lib/rules/active";
import { ruleApplies } from "@/lib/rules/engine";
import { codedQualifier } from "@/lib/rules/qualifier";
import { cptLabel, icdLabel, searchIcd } from "@/lib/codes";
import { dubaiIso } from "@/lib/util/time";

/**
 * Win it back: a refused claim on its own claim page, like a new one. Each refused line comes with
 * what the insurer said, SEAL's reading of why, and one recommended fix a person applies in a click
 * (get the approval, bill the approved quantity, add a documented diagnosis, or write the line off).
 * The fixes collect into one working resubmission (an unsent recovery draft); SEAL drafts the letter
 * and a person approves and resubmits (lib/recovery/recovery.ts approveRecovery). SEAL never picks
 * codes on its own: diagnosis suggestions come from the note's words within the rule's qualifying codes.
 */
export type RecoveryFix =
  | { type: "request_prior_auth"; activityId: string }
  | { type: "attach_auth"; activityId: string; authNo: string }
  | { type: "set_quantity"; activityId: string; quantity: number }
  | { type: "add_diagnosis"; activityId: string; suggestions: { code: string; description: string }[]; patterns: string[] }
  | { type: "appeal"; activityId: string }
  | { type: "write_off"; activityId: string };

export type RefusedLine = {
  denialId: string;
  activityId: string;
  code: string;
  service: string;
  denialCode: string;
  meaning: string;
  family: string;
  insurerComment?: string;
  amount: number;
  deadline: string;
  status: string;
  sealReads?: { rootCause: string; recoverable: boolean; action: string; confidence: string };
  recommendation: string;
  fixes: RecoveryFix[];
  done: string[];
};

type Diff = { lineEdits?: Record<string, { quantity?: number; priorAuthId?: string }>; activityIds?: string[]; diagnoses?: { code: string; type: "Principal" | "Secondary" }[]; changes?: string[] };

const OPEN = ["queued", "drafted"];
const NOT_RECOVERABLE = new Set(["DUPL", "ELIG", "TIME", "BENX", "NCOV", "COPY", "BSMA"]);

/** The unsent draft collecting this resubmission's changes (newest first, superseded ones skipped). */
export async function workingDraft(d: Db, claimId: string) {
  return (await d.collection(C.recoveryDrafts).find({ claimId, sentAt: null, supersededBy: { $exists: false } }).sort({ writtenAt: -1 }).limit(1).next()) as (RecoveryDraftDoc & { diff?: Diff }) | null;
}

export async function recoveryPlan(d: Db, claimId: string) {
  const claim = (await d.collection(C.claims).findOne({ _id: claimId as never })) as ClaimDoc | null;
  if (!claim) throw new Error(`claim ${claimId} not found`);
  const now = dubaiIso();
  const [denials, enc, auths, rules, draft] = await Promise.all([
    d.collection(C.denials).find({ claimId, status: { $in: [...OPEN, "written_off"] } }).sort({ deadline: 1 }).toArray() as unknown as Promise<DenialDoc[]>,
    d.collection(C.encounters).findOne({ _id: claim.encounterId as never }) as Promise<EncounterDoc | null>,
    d.collection(C.priorAuths).find({ memberId: claim.memberId, status: "approved" }).toArray() as unknown as Promise<PriorAuthDoc[]>,
    activeRules(d),
    workingDraft(d, claimId),
  ]);
  const lines = Object.fromEntries(claim.versions.flatMap((v) => v.lines).map((l) => [l.activityId, l]));
  const diff = (draft?.diff ?? {}) as Diff;
  const note = [enc?.complaint, enc?.findings, enc?.plan, ...(enc?.addenda ?? []).map((a) => a.text)].filter(Boolean).join(" ").toLowerCase();
  const words = [...new Set(note.match(/[a-z]{5,}/g) ?? [])].slice(0, 60);

  const refused: RefusedLine[] = denials.map((x) => {
    const info = isKnownDenialCode(x.denialCode) ? denialInfo(x.denialCode) : null;
    const family = info?.family ?? x.denialCode.slice(0, 4);
    const l = lines[x.activityId];
    const done: string[] = [];
    const edit = diff.lineEdits?.[x.activityId];
    if (edit?.priorAuthId) done.push(`Approval ${edit.priorAuthId} attached`);
    if (edit?.quantity) done.push(`Billing ${edit.quantity}`);
    if (x.status === "written_off") done.push("Written off");
    const fixes: RecoveryFix[] = [];
    let recommendation = info?.typicalFix ?? "Appeal with the documentation in the note.";
    // the approval on the line itself, else one covering the service and valid on the visit date
    const svc = (enc?.start ?? now).slice(0, 10);
    const pa = auths.find((a) => a.authNo === l?.priorAuthId) ?? auths.find((a) => a.codes.includes(x.code) && `${a.validTo}` >= svc);
    if (family === "AUTH") {
      if (pa && l && l.quantity > pa.approvedQty) {
        fixes.push({ type: "set_quantity", activityId: x.activityId, quantity: pa.approvedQty });
        recommendation = `The approval covers ${pa.approvedQty}; bill the approved quantity and resubmit.`;
      } else if (pa) {
        fixes.push({ type: "attach_auth", activityId: x.activityId, authNo: pa.authNo });
        recommendation = `A valid approval (${pa.authNo}) is on file: attach it and resubmit.`;
      } else {
        fixes.push({ type: "request_prior_auth", activityId: x.activityId });
        recommendation = "Ask the insurer for the approval, attach it, and resubmit as a correction.";
      }
    } else if (family === "MNEC" || family === "CODE" || family === "CLAI") {
      const qualifier = rules.filter((r) => ruleApplies(r, claim.payerId, x.code)).map((r) => codedQualifier(r)).find(Boolean);
      if (qualifier) {
        const suggestions = words.flatMap((w) => searchIcd(w, qualifier, 2)).filter((s, i, a) => a.findIndex((y) => y.code === s.code) === i).slice(0, 4);
        fixes.push({ type: "add_diagnosis", activityId: x.activityId, suggestions, patterns: qualifier });
        recommendation = "Code the qualifying condition the note documents (coder's choice), then resubmit; or appeal with the note.";
      } else recommendation = family === "MNEC" ? "Appeal with what the note documents; SEAL drafts the letter from the note's own words." : recommendation;
      fixes.push({ type: "appeal", activityId: x.activityId });
    } else if (NOT_RECOVERABLE.has(family)) {
      recommendation = `Usually not recoverable (${info?.familyName ?? family}). Write it off, or appeal if you have evidence the insurer is wrong.`;
      fixes.push({ type: "write_off", activityId: x.activityId }, { type: "appeal", activityId: x.activityId });
    } else fixes.push({ type: "appeal", activityId: x.activityId });
    // SEAL's own reading of the refusal, when it says this one is not worth chasing
    if (x.reader && !x.reader.recoverable && !fixes.some((f) => f.type === "write_off")) fixes.push({ type: "write_off", activityId: x.activityId });
    return {
      denialId: x._id,
      activityId: x.activityId,
      code: x.code,
      service: cptLabel(x.code),
      denialCode: x.denialCode,
      meaning: info?.description ?? x.denialCode,
      family,
      insurerComment: x.payerComment,
      amount: x.amount,
      deadline: x.deadline,
      status: x.status,
      sealReads: x.reader ? { rootCause: x.reader.rootCause, recoverable: x.reader.recoverable, action: x.reader.action, confidence: x.reader.confidence } : undefined,
      recommendation,
      fixes,
      done,
    };
  });

  const v = claim.versions.at(-1)!;
  const dx = await versionDiagnoses(claim, v, d);
  const open = refused.filter((r) => r.status !== "written_off");
  return {
    claimId,
    claimNo: claim.claimNo,
    status: claim.status,
    resubmissionsUsed: Math.max(0, v.version - 1),
    resubmissionsLeft: Math.max(0, MAX_RESUBMISSIONS - (v.version - 1)),
    deadline: open.map((r) => r.deadline).sort()[0] ?? null,
    atStake: Math.round(open.reduce((s, r) => s + r.amount, 0) * 100) / 100,
    refused,
    diagnoses: dx.map((x) => ({ code: x.code, type: x.type, label: icdLabel(x.code) })),
    draft: draft
      ? { id: draft._id, type: draft.type, letter: draft.letter ?? "", byAI: !!draft.aiCallId, rationale: draft.rationale, coderReview: draft.coderReview, evidence: draft.evidence, flags: draft.flags, lineEdits: diff.lineEdits ?? {}, diagnoses: diff.diagnoses ?? null, activityIds: diff.activityIds ?? open.map((r) => r.activityId), changes: diff.changes ?? [] }
      : null,
  };
}
export type RecoveryPlan = Awaited<ReturnType<typeof recoveryPlan>>;

export const RecoveryFixInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("request_prior_auth"), activityId: z.string() }),
  z.object({ type: z.literal("attach_auth"), activityId: z.string(), authNo: z.string() }),
  z.object({ type: z.literal("set_quantity"), activityId: z.string(), quantity: z.number().int().positive() }),
  z.object({ type: z.literal("add_diagnosis"), code: z.string() }),
  z.object({ type: z.literal("remove_diagnosis"), code: z.string() }),
  z.object({ type: z.literal("write_off"), activityId: z.string() }),
]);

/** Apply one fix to the working resubmission (created if there is none yet). A person clicked it, or said yes. */
export async function applyRecoveryFix(d: Db, claimId: string, input: z.infer<typeof RecoveryFixInput>, actor: EventDoc["actor"]) {
  const claim = (await d.collection(C.claims).findOne({ _id: claimId as never })) as ClaimDoc | null;
  if (!claim) throw new Error(`claim ${claimId} not found`);
  if (!["refused", "partially_paid"].includes(claim.status)) throw new Error(`claim ${claim.claimNo} is ${claim.status}: only refused claims are won back here`);
  const denials = (await d.collection(C.denials).find({ claimId, status: { $in: OPEN } }).toArray()) as unknown as DenialDoc[];
  if (!denials.length) throw new Error("no refused lines are waiting on this claim");
  const lines = Object.fromEntries(claim.versions.flatMap((v) => v.lines).map((l) => [l.activityId, l]));
  const draft = (await workingDraft(d, claimId)) ?? (await newDraft(d, claim, denials, actor));
  const diff: Diff = { lineEdits: {}, activityIds: denials.map((x) => x.activityId), changes: [], ...((draft.diff ?? {}) as Diff) };
  diff.lineEdits ??= {};
  diff.changes ??= [];
  const say = (t: string) => diff.changes!.push(t);
  const line = "activityId" in input ? lines[input.activityId] : null;
  if ("activityId" in input && !line) throw new Error("that line is not on the claim");

  switch (input.type) {
    case "request_prior_auth": {
      // the mock insurer approves at once (as on the visit screen)
      const authNo = `PA-${claim.payerId.slice(0, 2).toUpperCase()}-R${randomUUID().slice(0, 6).toUpperCase()}`;
      const validTo = new Date(Date.now() + 30 * 86_400_000 + 4 * 3600_000).toISOString().slice(0, 10);
      await d.collection(C.priorAuths).insertOne({ _id: `pa-${randomUUID()}` as never, memberId: claim.memberId, encounterId: claim.encounterId, codes: [line!.code], approvedQty: line!.quantity, requestedAt: dubaiIso(), validTo, status: "approved", authNo, writtenBy: { kind: "mock_insurer", id: claim.payerId }, writtenAt: dubaiIso() });
      diff.lineEdits[input.activityId] = { ...diff.lineEdits[input.activityId], priorAuthId: authNo };
      say(`Prior approval ${authNo} obtained for ${line!.code} ${cptLabel(line!.code)} and attached`);
      break;
    }
    case "attach_auth":
      diff.lineEdits[input.activityId] = { ...diff.lineEdits[input.activityId], priorAuthId: input.authNo };
      say(`Prior approval ${input.authNo} attached to ${line!.code}`);
      break;
    case "set_quantity":
      diff.lineEdits[input.activityId] = { ...diff.lineEdits[input.activityId], quantity: input.quantity };
      say(`${line!.code} billed as ${input.quantity} (the approved quantity)`);
      break;
    case "add_diagnosis":
    case "remove_diagnosis": {
      if (input.type === "add_diagnosis" && icdLabel(input.code) === input.code) throw new Error(`${input.code} is not a billable ICD-10-CM code`);
      const base = diff.diagnoses ?? (await versionDiagnoses(claim, claim.versions.at(-1)!, d)).map((x) => ({ code: x.code, type: x.type as "Principal" | "Secondary" }));
      const next = input.type === "add_diagnosis" ? (base.some((x) => x.code === input.code) ? base : [...base, { code: input.code, type: base.length ? ("Secondary" as const) : ("Principal" as const) }]) : base.filter((x) => x.code !== input.code).map((x, i) => ({ ...x, type: i === 0 ? ("Principal" as const) : ("Secondary" as const) }));
      if (!next.length) throw new Error("a claim needs at least one diagnosis");
      diff.diagnoses = next;
      say(input.type === "add_diagnosis" ? `Diagnosis ${input.code} ${icdLabel(input.code)} added` : `Diagnosis ${input.code} removed`);
      break;
    }
    case "write_off": {
      const den = denials.find((x) => x.activityId === input.activityId);
      if (!den) throw new Error("that line is not waiting");
      await d.collection(C.denials).updateOne({ _id: den._id as never }, { $set: { status: "written_off", writtenOffBy: actor.id, writtenOffAt: dubaiIso() } });
      diff.activityIds = (diff.activityIds ?? []).filter((x) => x !== input.activityId);
      say(`${line!.code} ${cptLabel(line!.code)} written off (${den.denialCode})`);
      break;
    }
  }
  const type = Object.keys(diff.lineEdits).length || diff.diagnoses ? "correction" : draft.type;
  const letter = draft.aiCallId ? draft.letter : correctionLetter(claim.claimNo, diff.changes);
  await d.collection(C.recoveryDrafts).updateOne({ _id: draft._id as never }, { $set: { diff, type, letter } });
  await emit("recovery.fix_applied", { claimId, fix: input.type, draftId: draft._id }, actor);
  return recoveryPlan(d, claimId);
}

/** A person's own working resubmission (no AI letter yet). */
async function newDraft(d: Db, claim: ClaimDoc, denials: DenialDoc[], actor: EventDoc["actor"]) {
  const draft: RecoveryDraftDoc & { diff: Diff } = {
    _id: `draft-${randomUUID().slice(0, 12)}`,
    denialId: denials[0]._id,
    claimId: claim._id,
    type: "correction",
    diff: { lineEdits: {}, activityIds: denials.map((x) => x.activityId), changes: [] },
    letter: "",
    evidence: [],
    approvedBy: null,
    sentAt: null,
    flags: [],
    writtenBy: actor,
    writtenAt: dubaiIso(),
  };
  await d.collection(C.recoveryDrafts).insertOne(draft as never);
  return draft;
}

const correctionLetter = (claimNo: string, changes: string[]) =>
  `Corrected claim ${claimNo}, resubmitted for the refused lines.\n\nCorrections made:\n${changes.map((c) => `- ${c}`).join("\n")}\n\nPlease reprocess the corrected lines.`;

import "server-only";
import { sharedDb } from "@/lib/db/mongo";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import { emit } from "@/lib/db/events";
import { COLLECTIONS as C, type ClaimDoc, type DenialDoc, type EncounterDoc, type EventDoc, type OutcomeDoc, type PayerDoc, type RecoveryDraftDoc } from "@/lib/db/schemas";
import { loadPrompt, runAgent, annotateCall } from "@/lib/ai/agent";
import { activeRules } from "@/lib/rules/active";
import { ruleApplies } from "@/lib/rules/engine";
import { denialInfo } from "@/lib/claims/denial-codes";
import { createResubmission, submitClaim, versionDiagnoses } from "@/lib/claims/submit";
import { cptLabel, icdLabel } from "@/lib/codes";
import { norm, quoted } from "@/lib/check/quotes";
import { dubaiIso } from "@/lib/util/time";

type Actor = EventDoc["actor"];
const AGENT = { kind: "agent" as const, id: "recovery" };
const CODE_TOKEN = /\b([A-TV-Z]\d{2}(?:\.\d{1,4})?|\d{4}[0-9TF])\b/g;

async function claimContext(d: Db, claimId: string) {
  const claim = (await d.collection(C.claims).findOne({ _id: claimId as never })) as ClaimDoc | null;
  if (!claim) throw new Error(`claim ${claimId} not found`);
  const [enc, payer, denials] = await Promise.all([
    d.collection(C.encounters).findOne({ _id: claim.encounterId as never }) as Promise<EncounterDoc | null>,
    d.collection(C.payers).findOne({ _id: claim.payerId as never }) as Promise<PayerDoc | null>,
    d.collection(C.denials).find({ claimId, status: { $in: ["queued", "drafted"] } }).toArray() as unknown as Promise<DenialDoc[]>,
  ]);
  const dx = await versionDiagnoses(claim, claim.versions.at(-1)!, d);
  const note = [enc?.complaint && `Complaint (as told): ${enc.complaint}`, enc?.findings && `Findings: ${enc.findings}`, enc?.plan && `Plan: ${enc.plan}`, ...(enc?.addenda ?? []).map((a) => a.text)].filter(Boolean).join("\n");
  return { claim, enc, payer, denials, dx, note };
}

// ── Denial reader ─────────────────────────────────────────────────────────────
const ReaderOut = z.object({ lines: z.array(z.object({ denialId: z.string(), rootCause: z.string(), recoverable: z.boolean(), action: z.enum(["correction", "appeal", "write_off"]), confidence: z.enum(["high", "medium", "low"]) })) });

/** remittance.received → classify each newly queued refused line. */
export async function readDenials(d: Db, claimId: string) {
  const { claim, payer, denials, dx, note } = await claimContext(d, claimId);
  const todo = denials.filter((x) => !x.reader);
  if (!todo.length) return [];
  const rules = await activeRules(d);
  const r = await runAgent(d, {
    agent: "denialReader",
    promptVersion: "denial-reader/v1",
    system: loadPrompt("denial-reader", "v1"),
    user: JSON.stringify({
      insurer: payer?.name,
      diagnoses: dx.map((x) => `${x.code} ${icdLabel(x.code)}`),
      note: note.slice(0, 1200),
      lines: todo.map((x) => ({ denialId: x._id, service: `${x.code} ${cptLabel(x.code)}`, denialCode: x.denialCode, description: denialInfo(x.denialCode).description, insurerComment: x.payerComment, rules: rules.filter((ru) => ruleApplies(ru, claim.payerId, x.code)).map((ru) => `${ru.id}: ${ru.insurerNeeds}`) })),
    }),
    schema: ReaderOut,
    subject: { claimId, encounterId: claim.encounterId },
  });
  for (const l of r.data.lines) {
    if (!todo.some((x) => x._id === l.denialId)) continue;
    await d.collection(C.denials).updateOne({ _id: l.denialId as never }, { $set: { reader: { rootCause: l.rootCause, recoverable: l.recoverable, action: l.action, confidence: l.confidence, aiCallId: r.call._id } } });
  }
  return r.data.lines;
}

// ── Recovery drafter ──────────────────────────────────────────────────────────
const DraftOut = z.object({
  type: z.enum(["appeal", "correction"]),
  letter: z.string().min(20),
  evidence: z.array(z.object({ kind: z.string(), ref: z.string(), quote: z.string().default("") })),
  lineEdits: z.record(z.string(), z.object({ quantity: z.number().int().positive().optional(), priorAuthId: z.string().optional() })).default({}),
  coderReview: z.string().default(""),
  rationale: z.string().default(""),
});

/** denial.queued → one draft per claim covering all its refused lines (a person edits and approves it). */
export async function draftRecovery(d: Db, claimId: string): Promise<RecoveryDraftDoc> {
  const { claim, payer, denials, dx, note } = await claimContext(d, claimId);
  if (!denials.length) throw new Error(`claim ${claim.claimNo} has no refused lines waiting`);
  const rules = await activeRules(d);
  const lines = claim.versions.at(-1)!.lines.length ? Object.fromEntries(claim.versions.flatMap((v) => v.lines).map((l) => [l.activityId, l])) : {};
  // Past wins: same insurer, same service, same denial code, later recovered.
  const wins = (await (await sharedDb())
    .collection(C.outcomes)
    .find({ payerId: claim.payerId, refusedLines: { $elemMatch: { code: { $in: denials.map((x) => x.code) }, denialCode: { $in: denials.map((x) => x.denialCode) }, recovered: true } } }, { projection: { embedding: 0, summary: 0 } })
    .limit(5)
    .toArray()) as unknown as OutcomeDoc[];
  const pa = await d.collection(C.priorAuths).find({ memberId: claim.memberId, status: "approved" }).toArray();
  const input = {
    insurer: payer?.name,
    claimNo: claim.claimNo,
    diagnoses: dx.map((x) => `${x.code} ${icdLabel(x.code)}${x.type === "Principal" ? " (principal)" : ""}`),
    lines: Object.values(lines).map((l) => ({ activityId: l.activityId, service: `${l.code} ${cptLabel(l.code)}`, quantity: l.quantity, priorAuthId: l.priorAuthId ?? null })),
    refused: denials.map((x) => ({ activityId: x.activityId, service: `${x.code} ${cptLabel(x.code)}`, denialCode: x.denialCode, description: denialInfo(x.denialCode).description, insurerComment: x.payerComment, readerSays: x.reader?.rootCause })),
    note,
    rules: denials.flatMap((x) => rules.filter((r) => ruleApplies(r, claim.payerId, x.code)).map((r) => ({ id: r.id, title: r.title, insurerNeeds: r.insurerNeeds, source: `${r.source.publisher}: ${r.source.title}` }))),
    approvalsOnFile: pa.map((p) => ({ authNo: p.authNo, codes: p.codes, approvedQty: p.approvedQty })),
    pastWins: wins.map((w) => ({ claimId: w.claimId, refused: w.refusedLines.filter((l) => l.recovered).map((l) => `${l.denialCode} on ${l.code}`), fix: w.fixesApplied })),
  };
  const r = await runAgent(d, {
    agent: "recoveryDrafter",
    promptVersion: "recovery-drafter/v1",
    system: loadPrompt("recovery-drafter", "v1").replace("{insurer}", payer?.name ?? "Insurer"),
    user: JSON.stringify(input),
    schema: DraftOut,
    subject: { claimId, encounterId: claim.encounterId },
  });
  // Guardrails in code: quotes must be the note's own words; no code may appear that isn't already on the claim.
  const flags = new Set<string>();
  const n = norm(note);
  const evidence = r.data.evidence.filter((e) => {
    if ((e.kind === "note" || e.kind === "addendum") && e.quote && !quoted(e.quote, n)) {
      flags.add("evidence_not_in_note");
      return false;
    }
    return true;
  });
  const allowed = new Set([...dx.map((x) => x.code), ...Object.values(lines).map((l) => l.code), ...wins.flatMap((w) => [...w.codes, ...w.diagnoses])]);
  const strip = (t: string) =>
    t.replace(CODE_TOKEN, (m) => {
      if (allowed.has(m)) return m;
      flags.add("code_suggestion_removed");
      return "[code to be chosen by coder]";
    });
  const lineEdits = Object.fromEntries(Object.entries(r.data.lineEdits).filter(([k]) => denials.some((x) => x.activityId === k)));
  const draft: RecoveryDraftDoc = {
    _id: `draft-${randomUUID().slice(0, 12)}`,
    denialId: denials[0]._id,
    claimId,
    type: r.data.type,
    diff: { lineEdits, activityIds: denials.map((x) => x.activityId) },
    letter: strip(r.data.letter),
    evidence,
    coderReview: strip(r.data.coderReview),
    rationale: strip(r.data.rationale),
    approvedBy: null,
    sentAt: null,
    aiCallId: r.call._id,
    flags: [...flags],
    writtenBy: AGENT,
    writtenAt: dubaiIso(),
  };
  if (flags.size) await annotateCall(d, r.call._id, { guardrailFlags: [...flags] });
  await d.collection(C.recoveryDrafts).insertOne(draft as never);
  await d.collection(C.denials).updateMany({ _id: { $in: denials.map((x) => x._id) as never[] } }, { $set: { status: "drafted", draftId: draft._id } });
  await emit("draft.ready", { claimId, draftId: draft._id, type: draft.type, lines: denials.length }, AGENT);
  return draft;
}

export const Approval = z.object({
  type: z.enum(["appeal", "correction"]),
  letter: z.string().min(10),
  /** Coder-chosen diagnoses (only when the coder changed them). */
  diagnoses: z.array(z.object({ code: z.string(), type: z.enum(["Principal", "Secondary"]) })).optional(),
  lineEdits: z.record(z.string(), z.object({ quantity: z.number().int().positive().optional(), priorAuthId: z.string().optional() })).optional(),
});

/** Approve and resubmit: the biller's (edited) draft becomes the next claim version and goes to the post office. */
export async function approveRecovery(d: Db, draftId: string, input: z.infer<typeof Approval>, actor: Actor, opts: { delaySeconds?: number } = {}) {
  const draft = (await d.collection(C.recoveryDrafts).findOne({ _id: draftId as never })) as RecoveryDraftDoc | null;
  if (!draft) throw new Error(`draft ${draftId} not found`);
  if (draft.sentAt) throw new Error("this draft was already sent");
  const a = Approval.parse(input);
  for (const x of a.diagnoses ?? []) if (icdLabel(x.code) === x.code) throw new Error(`${x.code} is not a billable ICD-10-CM code`);
  const diff = (draft.diff ?? {}) as { activityIds?: string[] };
  const codesChanged = !!a.diagnoses?.length || Object.keys(a.lineEdits ?? {}).length > 0;
  await createResubmission(
    draft.claimId!,
    {
      type: codesChanged || a.type === "correction" ? "correction" : "internal complaint",
      comment: a.letter.replace(/\s+/g, " ").slice(0, 500),
      activityIds: diff.activityIds ?? [],
      lineEdits: a.lineEdits,
      diagnoses: a.diagnoses,
      attachmentText: a.letter,
    },
    actor,
    d,
  );
  const claim = await submitClaim(draft.claimId!, actor, { database: d, delaySeconds: opts.delaySeconds });
  await d.collection(C.recoveryDrafts).updateOne({ _id: draftId as never }, { $set: { approvedBy: actor.id, sentAt: dubaiIso(), letter: a.letter, type: a.type, "diff.diagnoses": a.diagnoses, "diff.lineEdits": a.lineEdits ?? {} } });
  await d.collection(C.denials).updateMany({ claimId: draft.claimId, status: "drafted" }, { $set: { status: "resubmitted" } });
  return claim;
}

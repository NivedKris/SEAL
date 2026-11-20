import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import { emit } from "@/lib/db/events";
import { COLLECTIONS as C, type ClaimDoc, type EventDoc, type ProviderDoc, type QuestionDoc, type QuestionSetDoc } from "@/lib/db/schemas";
import { loadPrompt, runAgent } from "@/lib/ai/agent";
import { dubaiIso } from "@/lib/util/time";

type Actor = EventDoc["actor"];
type Answer = Record<string, string | number>;

async function getSet(d: Db, id: string): Promise<QuestionSetDoc> {
  const s = (await d.collection(C.questionSets).findOne({ _id: id as never })) as QuestionSetDoc | null;
  if (!s) throw new Error(`question set ${id} not found`);
  return s;
}

/** Autosave one answer as the doctor fills it in. */
export async function saveAnswer(d: Db, setId: string, gapId: string, answer: Answer, actor: Actor) {
  const s = await getSet(d, setId);
  if (s.status !== "open") throw new Error("these questions are already submitted");
  const q = s.questions.find((x) => x.gapId === gapId);
  if (!q) throw new Error(`no question ${gapId}`);
  const clean: Answer = {};
  for (const f of q.fields) {
    const v = answer[f.key];
    if (v === undefined || v === "") continue;
    if (f.kind === "number" && Number.isNaN(Number(v))) throw new Error(`${f.labelEn}: a number is needed`);
    if (f.kind === "choice" && f.options && !f.options.includes(String(v))) throw new Error(`${f.labelEn}: pick one of the options`);
    clean[f.key] = f.kind === "number" ? Number(v) : String(v).slice(0, 500);
  }
  await d.collection(C.questionSets).updateOne({ _id: setId as never, "questions.gapId": gapId }, { $set: { "questions.$.answer": clean, "questions.$.answeredAt": dubaiIso() } });
  await emit("question.answered", { claimId: s.claimId, questionSetId: setId, gapId, complete: q.fields.every((f) => clean[f.key] !== undefined) }, actor);
}

const complete = (q: QuestionDoc) => q.fields.every((f) => q.answer?.[f.key] !== undefined && q.answer[f.key] !== "");

/** One line per question: the field labels and the doctor's answers exactly as entered. */
export function addendumLines(s: QuestionSetDoc): { gapId: string; text: string }[] {
  return s.questions.map((q) => {
    const order = q.order;
    const parts = q.fields.map((f) => `${f.labelEn.replace(/[?:.]+$/, "")}: ${q.answer?.[f.key] ?? ""}${f.unit && f.kind === "number" ? f.unit : ""}`);
    return { gapId: q.gapId, text: `${order ? `${order} — ` : ""}${parts.join("; ")}.` };
  });
}

export function addendumText(s: QuestionSetDoc, doctor: string, at: string) {
  const when = new Date(at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" });
  return [`Addendum by ${doctor}, ${when} (in answer to insurer documentation questions):`, ...addendumLines(s).map((l) => `• ${l.text}`)].join("\n");
}

/** The addendum exactly as it will be attached (for the doctor's confirmation screen). */
export async function previewAddendum(d: Db, setId: string) {
  const s = await getSet(d, setId);
  const p = (await d.collection(C.providers).findOne({ _id: s.providerId as never })) as ProviderDoc | null;
  return { text: addendumText(s, p?.name ?? s.providerId, dubaiIso()), complete: s.questions.every(complete) };
}

/**
 * Submit all: the doctor signs the addendum. SEAL writes it back to the EMR record (its only
 * clinical write), attaches it to the claim lines it answers, and clears its hold flag. The answer
 * integrator and the claim re-check run afterwards.
 */
export async function submitAnswers(d: Db, setId: string, actor: Actor) {
  const s = await getSet(d, setId);
  if (s.status !== "open") throw new Error("these questions are already submitted");
  if (!s.questions.every(complete)) throw new Error("answer every question first");
  const p = (await d.collection(C.providers).findOne({ _id: s.providerId as never })) as ProviderDoc | null;
  const at = dubaiIso();
  const id = `add-${randomUUID().slice(0, 12)}`;
  const text = addendumText(s, p?.name ?? s.providerId, at);
  await d.collection(C.encounters).updateOne(
    { _id: s.encounterId as never },
    { $push: { addenda: { id, text, signedBy: p?.name ?? s.providerId, signedAt: at, questionSetId: setId } as never }, $set: { sealHold: false } },
  );
  const claim = (await d.collection(C.claims).findOne({ _id: s.claimId as never })) as ClaimDoc | null;
  if (claim && !claim.versions.at(-1)!.sentAt) {
    const v = claim.versions.at(-1)!;
    const lines = addendumLines(s);
    const observations = s.questions.map((q) => {
      const act = q.gapId.split("-a").at(-1)!;
      return { activityId: act, code: "Addendum", text: lines.find((l) => l.gapId === q.gapId)!.text };
    });
    await d.collection(C.claims).updateOne({ _id: s.claimId as never, "versions.version": v.version }, { $set: { "versions.$.observations": [...(v.observations ?? []), ...observations] }, $unset: { "versions.$.xml": "" } });
  }
  await d.collection(C.questionSets).updateOne({ _id: setId as never }, { $set: { status: "answered", addendumId: id } });
  await emit("addendum.attached", { claimId: s.claimId, questionSetId: setId, addendumId: id, encounterId: s.encounterId }, actor);
  return { addendumId: id, text };
}

const Resolution = z.object({ results: z.array(z.object({ gapId: z.string(), resolved: z.boolean(), note: z.string() })) });

/** Answer integrator: does each answer give the insurer what it needs? (Informational; the claim re-check decides routing.) */
export async function integrateAnswers(d: Db, setId: string) {
  const s = await getSet(d, setId);
  try {
    const r = await runAgent(d, {
      agent: "answerIntegrator",
      promptVersion: "answer-integrator/v1",
      system: loadPrompt("answer-integrator", "v1"),
      user: JSON.stringify({ questions: s.questions.map((q) => ({ gapId: q.gapId, question: q.textEn, insurerNeeds: q.insurerNeeds, answer: Object.fromEntries(q.fields.map((f) => [f.labelEn, q.answer?.[f.key] ?? ""])) })) }),
      schema: Resolution,
      subject: { claimId: s.claimId, encounterId: s.encounterId },
    });
    const resolution = s.questions.map((q) => r.data.results.find((x) => x.gapId === q.gapId) ?? { gapId: q.gapId, resolved: false, note: "Not assessed." });
    await d.collection(C.questionSets).updateOne({ _id: setId as never }, { $set: { resolution } });
    return resolution;
  } catch {
    return null;
  }
}

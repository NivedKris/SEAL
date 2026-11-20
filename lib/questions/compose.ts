import "server-only";
import type { Db } from "mongodb";
import { z } from "zod";
import { emit } from "@/lib/db/events";
import { COLLECTIONS as C, type ClaimDoc, type FindingDoc, type QuestionDoc, type QuestionSetDoc } from "@/lib/db/schemas";
import { DocConcept } from "@/lib/rules/dsl";
import { CONCEPT_TEXT } from "@/lib/rules/concepts";
import { loadPrompt, runAgent } from "@/lib/ai/agent";
import { cptLabel } from "@/lib/codes";
import { dubaiIso } from "@/lib/util/time";
import { CONCEPT_FIELDS, templateQuestion } from "./templates";

/**
 * Question composer (plan §5 stage 4). One question per order with open documentation gaps —
 * related gaps on the same order are merged — so a claim gets exactly as many questions as it has
 * gapped orders (zero, one or several). The count is decided here in code; the model only words
 * the questions (English + Arabic). Built-in templates take over if the model is unavailable.
 */
const ACTOR = { kind: "agent" as const, id: "question-composer" };

const Composed = z.object({
  questions: z.array(
    z.object({
      gapId: z.string(),
      textEn: z.string().min(5).max(400),
      textAr: z.string().min(3).max(400),
      fields: z.array(z.object({ key: z.string(), kind: z.enum(["number", "choice", "text", "date"]), labelEn: z.string(), labelAr: z.string(), options: z.array(z.string()).optional(), unit: z.string().optional() })),
    }),
  ),
});

export type Gap = { gapId: string; activityId: string; orderId?: string; order: string; concepts: z.infer<typeof DocConcept>[]; insurerNeeds: string; findingIds: string[] };

/** Group a check run's documentation findings by order. */
export function gapsFor(claim: ClaimDoc, findings: FindingDoc[]): Gap[] {
  const lines = claim.versions.at(-1)!.lines;
  const groups = new Map<string, Gap>();
  for (const f of findings) {
    if (f.kind !== "documentation" || !f.gapConcepts?.length || !f.activityId) continue;
    const line = lines.find((l) => l.activityId === f.activityId);
    const g = groups.get(f.activityId) ?? { gapId: `${claim._id}-a${f.activityId}`, activityId: f.activityId, orderId: line?.orderId, order: line ? `${line.code} ${cptLabel(line.code)}` : f.activityId, concepts: [], insurerNeeds: "", findingIds: [] };
    for (const c of f.gapConcepts) if (!g.concepts.includes(c)) g.concepts.push(c);
    if (f.insurerNeeds && !g.insurerNeeds.includes(f.insurerNeeds)) g.insurerNeeds = [g.insurerNeeds, f.insurerNeeds].filter(Boolean).join(" Also: ");
    g.findingIds.push(f._id);
    groups.set(f.activityId, g);
  }
  return [...groups.values()];
}

export async function composeQuestions(d: Db, claimId: string, run: number): Promise<QuestionSetDoc | null> {
  const claim = (await d.collection(C.claims).findOne({ _id: claimId as never })) as ClaimDoc | null;
  if (!claim) return null;
  const findings = (await d.collection(C.findings).find({ claimId, checkRun: run, stage: "rule_engine", status: "open" }).toArray()) as unknown as FindingDoc[];
  // Don't ask again what the doctor already answered for this claim; the biller sees what is still open.
  const answered = (await d.collection(C.questionSets).find({ claimId, status: "answered" }).toArray()) as unknown as QuestionSetDoc[];
  const asked = new Set(answered.flatMap((s) => s.questions.map((q) => q.gapId)));
  const gaps = gapsFor(claim, findings).filter((g) => !asked.has(g.gapId));
  await d.collection(C.questionSets).updateMany({ claimId, status: "open" }, { $set: { status: "cancelled" } });
  if (!gaps.length) return null;

  let composedBy: "agent" | "template" = "template";
  let aiCallId: string | undefined;
  let worded = new Map<string, z.infer<typeof Composed>["questions"][number]>();
  try {
    const r = await runAgent(d, {
      agent: "questionComposer",
      promptVersion: "question-composer/v1",
      system: loadPrompt("question-composer", "v1"),
      user: JSON.stringify({ gaps: gaps.map((g) => ({ gapId: g.gapId, order: g.order, insurerNeeds: g.insurerNeeds, missing: g.concepts.map((c) => CONCEPT_TEXT[c]), suggestedFields: g.concepts.flatMap((c) => CONCEPT_FIELDS[c]) })) }),
      schema: Composed,
      subject: { claimId, encounterId: claim.encounterId },
    });
    aiCallId = r.call._id;
    worded = new Map(r.data.questions.map((q) => [q.gapId, q]));
    // Models sometimes rewrite ids; when the count matches, match the questions by position.
    if (gaps.some((g) => !worded.has(g.gapId)) && r.data.questions.length === gaps.length) worded = new Map(gaps.map((g, i) => [g.gapId, r.data.questions[i]]));
    composedBy = "agent";
  } catch {
    // Template wording below.
  }

  const questions: QuestionDoc[] = gaps.map((g) => {
    const fallback = templateQuestion(g.order, g.concepts);
    const w = worded.get(g.gapId);
    // Keep the structure fixed: the model may reword labels, but every suggested field must survive unchanged.
    const fields = fallback.fields.map((f) => {
      const m = w?.fields.find((x) => x.key === f.key && x.kind === f.kind);
      return m ? { ...f, labelEn: m.labelEn || f.labelEn, labelAr: m.labelAr || f.labelAr } : f;
    });
    return { gapId: g.gapId, orderId: g.orderId, order: g.order, findingIds: g.findingIds, textEn: w?.textEn ?? fallback.textEn, textAr: w?.textAr ?? fallback.textAr, insurerNeeds: g.insurerNeeds, fields };
  });
  if (composedBy === "agent" && gaps.some((g) => !worded.has(g.gapId))) composedBy = "template";

  const set: QuestionSetDoc = {
    _id: `qs-${claimId}-r${run}`,
    claimId,
    providerId: claim.providerId,
    encounterId: claim.encounterId,
    questions,
    status: "open",
    checkRun: run,
    composedBy,
    aiCallId,
    writtenBy: ACTOR,
    writtenAt: dubaiIso(),
  };
  await d.collection(C.questionSets).replaceOne({ _id: set._id as never }, set, { upsert: true });
  // SEAL's hold flag on the EMR record (one of its two permitted write-backs).
  await d.collection(C.encounters).updateOne({ _id: claim.encounterId as never }, { $set: { sealHold: true } });
  await emit("questions.created", { claimId, questionSetId: set._id, count: questions.length, providerId: claim.providerId, encounterId: claim.encounterId }, ACTOR);
  return set;
}

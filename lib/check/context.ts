import "server-only";
import { sharedDb } from "@/lib/db/mongo";
import type { Db } from "mongodb";
import { COLLECTIONS as C, type ClaimDoc, type OutcomeDoc, type ProviderDoc } from "@/lib/db/schemas";
import type { DocConcept } from "@/lib/rules/dsl";
import { anyMatch, type HistoryItem, type RuleContext } from "@/lib/rules/engine";
import { loadEncounterBundle, type EncounterBundle } from "@/lib/claims/bundle";
import { versionDiagnoses } from "@/lib/claims/submit";
import { embedTexts, toVector } from "@/lib/ai/embed";
import { cptLabel, icdLabel } from "@/lib/codes";
import { ageAt } from "@/lib/util/time";
import { VECTOR_INDEX_NAME } from "@/lib/db/indexes";

const ER_TYPES = new Set([2, 4, 6]);

/** Everything the real-time check reads for one claim (SEAL's own view; never the insurer's). */
export type ClaimCheckInput = {
  claim: ClaimDoc;
  bundle: EncounterBundle;
  diagnoses: { code: string; type: "Principal" | "Secondary"; description: string }[];
  lines: { activityId: string; code: string; label: string; quantity: number; priorAuthId?: string }[];
  note: string;
  history: HistoryItem[];
  /** Rule context for a line, with documentation answers for that line (null = not known yet). */
  ctxFor: (documents: (c: DocConcept) => boolean | null) => RuleContext;
};

export async function loadCheckInput(claim: ClaimDoc, d: Db): Promise<ClaimCheckInput> {
  // History doesn't depend on the bundle: fetch both at once.
  const pastP = d
    .collection(C.claims)
    .find({ patientId: claim.patientId, _id: { $ne: claim._id as never } }, { projection: { versions: { $slice: 1 }, payerId: 1, providerId: 1 } })
    .toArray() as unknown as Promise<Pick<ClaimDoc, "versions" | "payerId" | "providerId">[]>;
  const bundle = await loadEncounterBundle(claim.encounterId, d);
  const v = claim.versions.at(-1)!;
  const dx = await versionDiagnoses(claim, v, d);
  const descByCode = new Map(bundle.diagnoses.map((x) => [x.icd10, x.description]));
  const diagnoses = dx.map((x) => ({ ...x, description: descByCode.get(x.code) ?? icdLabel(x.code) }));
  const lines = v.lines.map((l) => ({ activityId: l.activityId, code: l.code, label: cptLabel(l.code), quantity: l.quantity, priorAuthId: l.priorAuthId }));
  const e = bundle.encounter;
  const note = [`Complaint (as told): ${e.complaint}`, `Findings: ${e.findings}`, e.plan ? `Plan: ${e.plan}` : "", ...(e.addenda ?? []).map((a) => a.text)].filter(Boolean).join("\n");

  // The patient's earlier services at this hospital (SEAL's own records), before this visit.
  const at = new Date(e.start).getTime();
  const past = await pastP;
  const provIds = [...new Set(past.map((p) => p.providerId))];
  const provs = provIds.length ? ((await d.collection(C.providers).find({ _id: { $in: provIds as never[] } }).toArray()) as unknown as ProviderDoc[]) : [];
  const spec = new Map(provs.map((p) => [p._id, p.specialty]));
  const history: HistoryItem[] = [];
  for (const p of past)
    for (const l of p.versions[0].lines) {
      const t = new Date(l.start).getTime();
      if (t < at) history.push({ code: l.code, at: t, payerId: p.payerId, specialty: spec.get(p.providerId) });
    }

  const isEr = ER_TYPES.has(e.type);
  const auths = bundle.priorAuths;
  const ctxFor = (documents: (c: DocConcept) => boolean | null): RuleContext => ({
    payerId: claim.payerId,
    encounterType: e.type,
    clinicianSpecialty: bundle.provider.specialty,
    patientAge: ageAt(bundle.patient.dob, at),
    diagnoses: diagnoses.map((x) => ({ code: x.code, primary: x.type === "Principal" })),
    lines: lines.map((l) => ({ code: l.code, quantity: l.quantity })),
    history,
    at,
    benefits: bundle.plan.benefits,
    priorAuthRequired: (code) => !isEr && anyMatch(bundle.plan.priorAuthRequired, code),
    priorAuthFor: (code) => {
      const line = lines.find((l) => l.code === code);
      const pa = auths.find((a) => a.status === "approved" && (line?.priorAuthId ? a.authNo === line.priorAuthId : false) && a.codes.some((c) => anyMatch([c], code)));
      return pa ? { approvedQty: pa.approvedQty } : null;
    },
    labInHouse: true,
    documents,
  });
  return { claim, bundle, diagnoses, lines, note, history, ctxFor };
}

export type SimilarClaim = { claimId: string; score: number; payerId: string; codes: string[]; diagnoses: string[]; firstPassRefused: boolean; refused: string[]; fixes: string[]; hospital?: string; clinician?: string; value?: number };

/** Text for the embedding, in the same shape as the seeded outcome summaries (without the outcome). */
export function querySummary(input: ClaimCheckInput): string {
  const e = input.bundle.encounter;
  return [
    `Insurer: ${input.bundle.payer.name}. Specialty: ${input.bundle.provider.specialty}. Visit type: ${ER_TYPES.has(e.type) ? "emergency" : "outpatient"}.`,
    `Diagnoses: ${input.diagnoses.map((x) => `${x.code} ${x.description}`).join("; ")}.`,
    `Services: ${input.lines.map((l) => `${l.code} ${l.label}${l.quantity > 1 ? ` x${l.quantity}` : ""}`).join("; ")}.`,
  ].join(" ");
}

/** search_ledger: the most similar past claims for this insurer, with their outcomes (Atlas Vector Search). */
export async function similarClaims(input: ClaimCheckInput, d: Db, limit = 10): Promise<SimilarClaim[]> {
  // A hospital with its own history: also match its own past claims by the same clinician.
  const own = await d.collection(C.outcomes).findOne({ _id: { $regex: "^hx-" } as never }, { projection: { hospital: 1 } });
  const query = querySummary(input) + (own ? ` Clinician: ${input.bundle.provider.name}.` : "");
  const [v] = await embedTexts([query]);
  type Hit = OutcomeDoc & { score: number; hospital?: string; clinician?: string };
  const search = async (db: Db, n: number) =>
    (await db
      .collection(C.outcomes)
      .aggregate([
        { $vectorSearch: { index: VECTOR_INDEX_NAME, path: "embedding", queryVector: toVector(v), numCandidates: Math.max(150, n * 10), limit: n, filter: { payerId: input.claim.payerId } } },
        { $project: { embedding: 0, summary: 0, score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray()) as unknown as Hit[];
  // The regional memory lives once, in the shared database; a hospital's own claims live in its own.
  const shared = await sharedDb();
  const [regional, ownHits] = await Promise.all([search(shared, limit + 1), own && d.databaseName !== shared.databaseName ? search(d, 40) : Promise.resolve([] as Hit[])]);
  // Another hospital sees only the regional history in the shared memory, never Basic's own live claims.
  const sharedHits = d.databaseName === shared.databaseName ? regional : regional.filter((h) => !/^clm-L/.test(h.claimId));
  const hits = [...sharedHits, ...ownHits];
  const others = hits.filter((h) => h.claimId !== input.claim._id);
  // Up to 6 regional matches (they carry services and diagnoses) and 4 of the hospital's own claims,
  // preferring the same clinician.
  const picked = own
    ? [
        ...others.filter((h) => !h.hospital).slice(0, limit - 4),
        ...others
          .filter((h) => h.hospital)
          .sort((a, b) => Number(b.clinician === input.bundle.provider.name) - Number(a.clinician === input.bundle.provider.name) || b.score - a.score)
          .slice(0, 4),
      ].sort((a, b) => b.score - a.score)
    : others.slice(0, limit);
  return picked
    .slice(0, limit)
    .map((h) => ({
      claimId: h.claimId,
      score: Math.round(h.score * 1000) / 1000,
      payerId: h.payerId,
      codes: h.codes,
      diagnoses: h.diagnoses,
      firstPassRefused: h.firstPassRefused,
      refused: h.refusedLines.map((l) => `${l.denialCode}${l.code ? ` on ${l.code}` : ""}${l.recovered ? " (recovered on resubmission)" : ""}`),
      fixes: h.fixesApplied,
      ...(h.hospital ? { hospital: h.hospital, clinician: h.clinician, value: h.gross } : {}),
    }));
}

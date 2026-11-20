import "server-only";
import type { Db, Filter, Document } from "mongodb";
import { COLLECTIONS as C, type ClaimDoc, type DiagnosisDoc, type EncounterDoc, type MemberDoc, type PatientDoc, type PlanDoc, type PriorAuthDoc, type ProviderDoc, type RemittanceDoc } from "@/lib/db/schemas";
import type { DocConcept } from "@/lib/rules/dsl";
import { anyMatch, type HistoryItem, type RuleContext } from "@/lib/rules/engine";
import { ageAt } from "@/lib/util/time";

/**
 * Rule contexts for many claims at once (evaluation runs, rule back-tests, the rule miner):
 * a handful of queries instead of several per claim. Documentation is "unknown" — these runs
 * never read the seed's answer key.
 */
export type BatchClaim = {
  claim: Pick<ClaimDoc, "_id" | "claimNo" | "payerId" | "patientId" | "providerId" | "memberId" | "encounterId" | "versions">;
  at: number;
  diagnoses: { code: string; primary: boolean }[];
  ctx: (documents?: (c: DocConcept) => boolean | null) => RuleContext;
  /** First-pass decision per activity: denial code, or undefined when paid. */
  firstPass: Map<string, string | undefined> | null;
  specialty: string;
  age: number;
};

export async function loadBatch(d: Db, filter: Filter<Document>, opts: { limit?: number; withRemittances?: boolean } = {}): Promise<BatchClaim[]> {
  const claims = (await d
    .collection(C.claims)
    .find(filter, { projection: { claimNo: 1, payerId: 1, patientId: 1, providerId: 1, memberId: 1, encounterId: 1, versions: { $slice: 1 } } })
    .limit(opts.limit ?? 5000)
    .toArray()) as unknown as BatchClaim["claim"][];
  if (!claims.length) return [];
  const ids = <T,>(xs: T[]) => [...new Set(xs)] as never[];
  const [encs, dxs, pats, mems, plans, provs, history, rems] = await Promise.all([
    d.collection(C.encounters).find({ _id: { $in: ids(claims.map((c) => c.encounterId)) } }, { projection: { start: 1, type: 1 } }).toArray() as unknown as Promise<Pick<EncounterDoc, "_id" | "start" | "type">[]>,
    d.collection(C.diagnoses).find({ encounterId: { $in: ids(claims.map((c) => c.encounterId)) } }, { projection: { encounterId: 1, icd10: 1, primary: 1 } }).toArray() as unknown as Promise<DiagnosisDoc[]>,
    d.collection(C.patients).find({ _id: { $in: ids(claims.map((c) => c.patientId)) } }, { projection: { dob: 1 } }).toArray() as unknown as Promise<PatientDoc[]>,
    d.collection(C.members).find({ _id: { $in: ids(claims.map((c) => c.memberId)) } }, { projection: { planId: 1 } }).toArray() as unknown as Promise<MemberDoc[]>,
    d.collection(C.plans).find({}).toArray() as unknown as Promise<PlanDoc[]>,
    d.collection(C.providers).find({}).toArray() as unknown as Promise<ProviderDoc[]>,
    d.collection(C.claims).find({ patientId: { $in: ids(claims.map((c) => c.patientId)) } }, { projection: { patientId: 1, payerId: 1, providerId: 1, versions: { $slice: 1 } } }).toArray() as unknown as Promise<Pick<ClaimDoc, "_id" | "patientId" | "payerId" | "providerId" | "versions">[]>,
    opts.withRemittances ? (d.collection(C.remittances).find({ claimId: { $in: ids(claims.map((c) => c._id)) }, claimVersion: 1 }, { projection: { claimId: 1, lines: 1 } }).toArray() as unknown as Promise<RemittanceDoc[]>) : Promise.resolve([] as RemittanceDoc[]),
  ]);
  const auths = (await d.collection(C.priorAuths).find({ memberId: { $in: ids(claims.map((c) => c.memberId)) } }).toArray()) as unknown as PriorAuthDoc[];
  const byId = <T extends { _id: unknown }>(xs: T[]) => new Map(xs.map((x) => [String(x._id), x]));
  const encM = byId(encs), patM = byId(pats), memM = byId(mems), planM = byId(plans), provM = byId(provs);
  const remM = new Map(rems.map((r) => [r.claimId, new Map(r.lines.map((l) => [l.activityId, l.denialCode]))]));
  const dxByEnc = new Map<string, { code: string; primary: boolean }[]>();
  for (const x of dxs) dxByEnc.set(x.encounterId, [...(dxByEnc.get(x.encounterId) ?? []), { code: x.icd10, primary: x.primary }]);
  const histByPat = new Map<string, HistoryItem[]>();
  for (const h of history)
    for (const l of h.versions[0].lines) histByPat.set(h.patientId, [...(histByPat.get(h.patientId) ?? []), { code: l.code, at: new Date(l.start).getTime(), payerId: h.payerId, specialty: provM.get(h.providerId)?.specialty }]);

  return claims.map((c) => {
    const enc = encM.get(c.encounterId);
    const at = enc ? new Date(enc.start).getTime() : new Date(c.versions[0].lines[0].start).getTime();
    const plan = planM.get(memM.get(c.memberId)?.planId ?? "");
    const prov = provM.get(c.providerId);
    const age = patM.get(c.patientId) ? ageAt(patM.get(c.patientId)!.dob, at) : 40;
    const diagnoses = c.versions[0].diagnoses?.map((x) => ({ code: x.code, primary: x.type === "Principal" })) ?? dxByEnc.get(c.encounterId) ?? [];
    const lines = c.versions[0].lines;
    const isEr = [2, 4, 6].includes(enc?.type ?? 1);
    const hist = (histByPat.get(c.patientId) ?? []).filter((h) => h.at < at);
    const ctx = (documents: (cpt: DocConcept) => boolean | null = () => null): RuleContext => ({
      payerId: c.payerId,
      encounterType: enc?.type ?? 1,
      clinicianSpecialty: prov?.specialty ?? "general_practice",
      patientAge: age,
      diagnoses,
      lines: lines.map((l) => ({ code: l.code, quantity: l.quantity })),
      history: hist,
      at,
      benefits: plan?.benefits ?? [],
      priorAuthRequired: (code) => !isEr && !!plan && anyMatch(plan.priorAuthRequired, code),
      priorAuthFor: (code) => {
        const line = lines.find((l) => l.code === code);
        const pa = auths.find((a) => a.memberId === c.memberId && a.status === "approved" && line?.priorAuthId === a.authNo);
        return pa ? { approvedQty: pa.approvedQty } : null;
      },
      labInHouse: true,
      documents,
    });
    return { claim: c, at, diagnoses, ctx, firstPass: remM.get(c._id) ?? null, specialty: prov?.specialty ?? "", age };
  });
}

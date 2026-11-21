import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C, type ClaimDoc } from "@/lib/db/schemas";
import { cptLabel } from "@/lib/codes";

export const dynamic = "force-dynamic";

/** Claim detail: the claim (lines labelled), parties, latest check findings, remittances, denials, event timeline. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const d = await db();
    const claim = (await d.collection(C.claims).findOne({ _id: id as never })) as ClaimDoc | null;
    if (!claim) throw new Error(`claim ${id} not found`);
    const [remittances, denials, findings, events, patient, payer, provider, encounter, diagnoses, questionSets] = await Promise.all([
      d.collection(C.remittances).find({ claimId: id }, { projection: { xml: 0 } }).sort({ claimVersion: 1 }).toArray(),
      d.collection(C.denials).find({ claimId: id }).toArray(),
      claim.check ? d.collection(C.findings).find({ claimId: id, checkRun: claim.check.run }).toArray() : Promise.resolve([]),
      d.collection(C.events).find({ "payload.claimId": id }).sort({ seq: 1 }).limit(300).toArray(),
      d.collection(C.patients).findOne({ _id: claim.patientId as never }, { projection: { name: 1, maskedId: 1, dob: 1, sex: 1 } }),
      d.collection(C.payers).findOne({ _id: claim.payerId as never }),
      d.collection(C.providers).findOne({ _id: claim.providerId as never }),
      d.collection(C.encounters).findOne({ _id: claim.encounterId as never }, { projection: { noteVersions: 0 } }),
      d.collection(C.diagnoses).find({ encounterId: claim.encounterId }).sort({ primary: -1 }).toArray(),
      d.collection(C.questionSets).find({ claimId: id, status: { $ne: "cancelled" } }).sort({ writtenAt: -1 }).toArray(),
    ]);
    const labelled = { ...claim, versions: claim.versions.map((v) => ({ ...v, lines: v.lines.map((l) => ({ ...l, label: cptLabel(l.code) })) })) };
    const shownProvider = provider ? { ...provider, specialty: provider.displaySpecialty ?? provider.specialty } : provider;
    return { claim: labelled, patient, payer, provider: shownProvider, encounter, diagnoses, findings, remittances, denials, events, questionSets };
  });
}

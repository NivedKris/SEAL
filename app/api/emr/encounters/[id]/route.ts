import { z } from "zod";
import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { loadEncounterBundle } from "@/lib/claims/bundle";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { saveNote } from "@/lib/emr/store";
import { ageAt } from "@/lib/util/time";

export const dynamic = "force-dynamic";

/** EMR simulator: one encounter with patient banner data, orders (incl. removed) and diagnoses. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const d = await db();
    const b = await loadEncounterBundle(id, d);
    const [allOrders, claim] = await Promise.all([
      d.collection(C.orders).find({ encounterId: id }).sort({ orderedAt: 1, _id: 1 }).toArray(),
      d.collection(C.claims).findOne({ encounterId: id }, { projection: { _id: 1, claimNo: 1, status: 1 } }),
    ]);
    return {
      encounter: b.encounter,
      patient: { name: b.patient.name, sex: b.patient.sex, age: ageAt(b.patient.dob, new Date(b.encounter.start).getTime()), maskedId: b.patient.maskedId, nationality: b.patient.nationality },
      insurance: { payer: b.payer.name, plan: b.plan.name, memberNo: b.member.memberNo, validTo: b.member.validTo, copayPct: b.plan.copayPct },
      provider: { name: b.provider.name, specialty: b.provider.specialty },
      orders: allOrders,
      diagnoses: b.diagnoses,
      priorAuths: b.priorAuths.filter((p) => p.status === "approved").map((p) => ({ authNo: p.authNo, codes: p.codes, approvedQty: p.approvedQty, validTo: p.validTo })),
      claim,
    };
  });
}

/** Save the note (complaint as told, findings, plan). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = z.object({ complaint: z.string().max(5000).optional(), findings: z.string().max(5000).optional(), plan: z.string().max(3000).optional() }).parse(await req.json());
    await saveNote(await db(), id, body);
    return { ok: true };
  });
}

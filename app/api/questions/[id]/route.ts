import { z } from "zod";
import { handle, actorFrom } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { saveAnswer } from "@/lib/questions/answers";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const d = await db();
    const set = await d.collection(C.questionSets).findOne({ _id: id as never });
    if (!set) throw new Error(`question set ${id} not found`);
    const enc = await d.collection(C.encounters).findOne({ _id: set.encounterId }, { projection: { patientId: 1, start: 1, complaint: 1, findings: 1 } });
    const pat = enc ? await d.collection(C.patients).findOne({ _id: enc.patientId }, { projection: { name: 1, sex: 1, dob: 1 } }) : null;
    const claim = await d.collection(C.claims).findOne({ _id: set.claimId }, { projection: { claimNo: 1, status: 1, payerId: 1 } });
    const payer = claim ? await d.collection(C.payers).findOne({ _id: claim.payerId }, { projection: { name: 1 } }) : null;
    return { set, patient: pat, visitAt: enc?.start, claim, payer };
  });
}

/** Autosave an answer. Body: { gapId, answer: { fieldKey: value } } */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const b = z.object({ gapId: z.string(), answer: z.record(z.string(), z.union([z.string(), z.number()])) }).parse(await req.json());
    await saveAnswer(await db(), id, b.gapId, b.answer, actorFrom(req, "doctor"));
    return { ok: true };
  });
}

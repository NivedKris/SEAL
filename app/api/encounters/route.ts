import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";

export const dynamic = "force-dynamic";

/** Encounters by status (?status=open), newest first, with patient and provider names. */
export async function GET(req: Request) {
  return handle(async () => {
    const status = new URL(req.url).searchParams.get("status") ?? "open";
    const d = await db();
    const encs = await d.collection(C.encounters).find({ status, evalSet: false }, { projection: { noteVersions: 0 } }).sort({ start: -1 }).limit(50).toArray();
    const [pats, provs] = await Promise.all([
      d.collection(C.patients).find({ _id: { $in: encs.map((e) => e.patientId) } }, { projection: { name: 1 } }).toArray(),
      d.collection(C.providers).find({ _id: { $in: encs.map((e) => e.providerId) } }, { projection: { name: 1, specialty: 1 } }).toArray(),
    ]);
    return { encounters: encs.map((e) => ({ ...e, patientName: pats.find((p) => p._id === e.patientId)?.name, providerName: provs.find((p) => p._id === e.providerId)?.name })) };
  });
}

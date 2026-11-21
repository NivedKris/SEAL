import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";

export const dynamic = "force-dynamic";

/** Encounters by status (?status=open), newest first, with patient and provider names. */
export async function GET(req: Request) {
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    const status = q.get("status") ?? "open";
    const providerId = q.get("providerId");
    const d = await db();
    const filter: Record<string, unknown> = { status, evalSet: false, ...(providerId ? { providerId } : {}) };
    // Today's clinics are shown in appointment order; other lists newest first.
    const encs = await d.collection(C.encounters).find(filter, { projection: { noteVersions: 0 } }).sort(status === "open" ? { start: 1 } : { start: -1 }).limit(status === "open" ? 300 : 50).toArray();
    const [pats, provs] = await Promise.all([
      d.collection(C.patients).find({ _id: { $in: encs.map((e) => e.patientId) } }, { projection: { name: 1 } }).toArray(),
      d.collection(C.providers).find({ _id: { $in: encs.map((e) => e.providerId) } }, { projection: { name: 1, specialty: 1, displaySpecialty: 1 } }).toArray(),
    ]);
    return {
      encounters: encs.map((e) => {
        const prov = provs.find((p) => p._id === e.providerId);
        return { ...e, patientName: pats.find((p) => p._id === e.patientId)?.name, providerName: prov?.name, providerSpecialty: prov?.displaySpecialty ?? prov?.specialty };
      }),
    };
  });
}

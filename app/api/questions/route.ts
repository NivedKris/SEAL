import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";

export const dynamic = "force-dynamic";

/** Doctor inbox: question sets (?status=open, ?providerId=…) with patient initials, visit time and count. */
export async function GET(req: Request) {
  return handle(async () => {
    const u = new URL(req.url);
    const status = u.searchParams.get("status") ?? "open";
    const providerId = u.searchParams.get("providerId");
    const d = await db();
    const sets = await d.collection(C.questionSets).find({ status, ...(providerId ? { providerId } : {}) }).sort({ writtenAt: -1 }).limit(50).toArray();
    const encs = await d.collection(C.encounters).find({ _id: { $in: sets.map((s) => s.encounterId) } }, { projection: { patientId: 1, start: 1, theme: 1, scenario: 1 } }).toArray();
    const pats = await d.collection(C.patients).find({ _id: { $in: encs.map((e) => e.patientId) } }, { projection: { name: 1 } }).toArray();
    const provs = await d.collection(C.providers).find({}, { projection: { name: 1 } }).toArray();
    return {
      sets: sets.map((s) => {
        const e = encs.find((x) => x._id === s.encounterId);
        return { ...s, patientName: pats.find((p) => p._id === e?.patientId)?.name, visitAt: e?.start, theme: e?.theme, scenario: e?.scenario, providerName: provs.find((p) => p._id === s.providerId)?.name };
      }),
      providers: provs,
    };
  });
}

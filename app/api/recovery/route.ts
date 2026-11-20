import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";

export const dynamic = "force-dynamic";

/** Refused queue (plan §5 stage 6): refused lines still open, by claim, sorted by deadline then value. */
export async function GET() {
  return handle(async () => {
    const d = await db();
    const dens = await d.collection(C.denials).find({ status: { $in: ["queued", "drafted", "resubmitted"] }, deadline: { $gte: new Date().toISOString() } }).toArray();
    const claimIds = [...new Set(dens.map((x) => x.claimId))];
    const [claims, drafts, payers] = await Promise.all([
      d.collection(C.claims).find({ _id: { $in: claimIds as never[] } }, { projection: { claimNo: 1, patientId: 1, payerId: 1, status: 1, net: 1, scenario: 1, versions: { $slice: -1 } } }).toArray(),
      d.collection(C.recoveryDrafts).find({ claimId: { $in: claimIds } }).sort({ writtenAt: -1 }).toArray(),
      d.collection(C.payers).find({}, { projection: { name: 1 } }).toArray(),
    ]);
    const pats = await d.collection(C.patients).find({ _id: { $in: claims.map((c) => c.patientId) } }, { projection: { name: 1 } }).toArray();
    const rows = claimIds.map((id) => {
      const c = claims.find((x) => x._id === id)!;
      const ds = dens.filter((x) => x.claimId === id);
      return {
        claimId: id,
        claimNo: c?.claimNo,
        scenario: c?.scenario,
        status: c?.status,
        patientName: pats.find((p) => p._id === c?.patientId)?.name,
        payerName: payers.find((p) => p._id === c?.payerId)?.name,
        deadline: ds.map((x) => x.deadline).sort()[0],
        amount: Math.round(ds.reduce((s, x) => s + x.amount, 0) * 100) / 100,
        resubmissionsUsed: Math.max(0, (c?.versions?.at(-1)?.version ?? 1) - 1),
        denials: ds,
        draft: drafts.find((x) => x.claimId === id) ?? null,
      };
    });
    rows.sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : b.amount - a.amount));
    return { rows };
  });
}

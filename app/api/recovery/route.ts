import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";

export const dynamic = "force-dynamic";

const OPEN = ["queued", "drafted", "resubmitted"];

/**
 * Refused queue (plan §5 stage 6): refused lines still open, by claim, sorted by deadline then value.
 * Grouped in the database and sent a page at a time (?limit=60&offset=0); `limit=0` returns only
 * the totals. A claim's full refusal lines and draft come from /api/recovery/:claimId when opened.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    const limit = Math.min(200, Math.max(0, Number(q.get("limit") ?? 60) || 0));
    const offset = Math.max(0, Number(q.get("offset") ?? 0) || 0);
    const d = await db();
    const [res] = await d
      .collection(C.denials)
      .aggregate([
        { $match: { status: { $in: OPEN }, deadline: { $gte: new Date().toISOString() } } },
        { $group: { _id: "$claimId", deadline: { $min: "$deadline" }, amount: { $sum: "$amount" }, lines: { $push: { denialCode: "$denialCode", code: "$code" } } } },
        {
          $facet: {
            totals: [{ $group: { _id: null, claims: { $sum: 1 }, amount: { $sum: "$amount" } } }],
            rows: [{ $sort: { deadline: 1, amount: -1, _id: 1 } }, { $skip: offset }, { $limit: Math.max(1, limit) }],
          },
        },
      ])
      .toArray();
    const total = { claims: (res?.totals[0]?.claims as number) ?? 0, amount: Math.round(((res?.totals[0]?.amount as number) ?? 0) * 100) / 100 };
    const page = (limit ? (res?.rows ?? []) : []) as { _id: string; deadline: string; amount: number; lines: { denialCode: string; code: string }[] }[];
    if (!page.length) return { total, rows: [] };

    const ids = page.map((x) => x._id);
    const [claims, drafts, payers] = await Promise.all([
      d.collection(C.claims).find({ _id: { $in: ids as never[] } }, { projection: { claimNo: 1, patientId: 1, payerId: 1, status: 1, scenario: 1, versionCount: { $size: "$versions" } } }).toArray(),
      d.collection(C.recoveryDrafts).find({ claimId: { $in: ids } }, { projection: { claimId: 1, sentAt: 1, writtenAt: 1 } }).sort({ writtenAt: -1 }).toArray(),
      d.collection(C.payers).find({}, { projection: { name: 1 } }).toArray(),
    ]);
    const pats = await d.collection(C.patients).find({ _id: { $in: claims.map((c) => c.patientId) } }, { projection: { name: 1 } }).toArray();
    const byId = new Map(claims.map((c) => [String(c._id), c]));
    const patName = new Map(pats.map((p) => [String(p._id), p.name as string]));
    const payerName = new Map(payers.map((p) => [String(p._id), p.name as string]));
    return {
      total,
      rows: page.map((x) => {
        const c = byId.get(x._id);
        const dr = drafts.find((y) => y.claimId === x._id);
        return {
          claimId: x._id,
          claimNo: c?.claimNo,
          scenario: c?.scenario,
          status: c?.status,
          patientName: patName.get(String(c?.patientId)),
          payerName: payerName.get(String(c?.payerId)),
          deadline: x.deadline,
          amount: Math.round(x.amount * 100) / 100,
          resubmissionsUsed: Math.max(0, ((c?.versionCount as number) ?? 1) - 1),
          lines: x.lines,
          draft: dr ? { sentAt: (dr.sentAt as string | null) ?? null } : null,
        };
      }),
    };
  });
}

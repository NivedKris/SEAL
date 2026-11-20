import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { cptKind } from "@/lib/codes";

/** CFO dashboard (plan §9.4), computed from remittances, denials, claims and the outcome ledger. */
export async function clinicMetrics(d: Db) {
  const evalIds = (((await d.collection(C.evalSets).findOne({}))?.claimIds ?? []) as string[]) as never[];
  const now = new Date().toISOString();
  const [byMonth, lines, reasons, atRiskHold, atRiskDenials, recovered, days, payers] = await Promise.all([
    d.collection(C.remittances).aggregate([
      { $match: { claimVersion: 1, claimId: { $nin: evalIds }, readyAt: { $lte: now } } },
      { $project: { m: { $substrCP: ["$readyAt", 0, 7] }, refused: { $gt: [{ $size: { $filter: { input: "$lines", cond: { $ifNull: ["$$this.denialCode", false] } } } }, 0] } } },
      { $group: { _id: "$m", n: { $sum: 1 }, refused: { $sum: { $cond: ["$refused", 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
    d.collection(C.remittances).aggregate([
      { $match: { claimVersion: 1, claimId: { $nin: evalIds }, readyAt: { $lte: now } } },
      { $unwind: "$lines" },
      { $group: { _id: "$lines.code", n: { $sum: 1 }, refused: { $sum: { $cond: [{ $ifNull: ["$lines.denialCode", false] }, 1, 0] } }, net: { $sum: "$lines.net" }, lost: { $sum: { $subtract: ["$lines.net", "$lines.paymentAmount"] } } } },
    ]).toArray(),
    d.collection(C.remittances).aggregate([
      { $match: { claimVersion: 1, claimId: { $nin: evalIds }, readyAt: { $lte: now } } },
      { $unwind: "$lines" },
      { $match: { "lines.denialCode": { $exists: true } } },
      { $group: { _id: { p: "$payerId", c: "$lines.denialCode" }, n: { $sum: 1 }, amount: { $sum: { $subtract: ["$lines.net", "$lines.paymentAmount"] } } } },
    ]).toArray(),
    d.collection(C.claims).aggregate([{ $match: { status: { $in: ["hold", "checking"] } } }, { $group: { _id: null, n: { $sum: 1 }, net: { $sum: "$net" } } }]).toArray(),
    d.collection(C.denials).aggregate([{ $match: { status: { $in: ["queued", "drafted", "resubmitted"] }, deadline: { $gte: now } } }, { $group: { _id: null, n: { $sum: 1 }, amount: { $sum: "$amount" } } }]).toArray(),
    d.collection(C.denials).aggregate([{ $match: { status: "won" } }, { $group: { _id: { $cond: [{ $eq: ["$writtenBy.kind", "seed"] }, "history", "seal"] }, n: { $sum: 1 }, amount: { $sum: "$amount" } } }]).toArray(),
    d.collection(C.outcomes).find({ daysToCash: { $ne: null } }, { projection: { daysToCash: 1 } }).toArray(),
    d.collection(C.payers).find({}, { projection: { name: 1 } }).toArray(),
  ]);
  const kinds: Record<string, { n: number; refused: number; lost: number }> = {};
  for (const l of lines) {
    const k = cptKind(l._id as string) ?? (String(l._id).startsWith("992") ? "visit" : "procedure");
    const x = (kinds[k] ??= { n: 0, refused: 0, lost: 0 });
    x.n += l.n;
    x.refused += l.refused;
    x.lost += l.lost;
  }
  const dts = days.map((x) => x.daysToCash as number).sort((a, b) => a - b);
  const total = byMonth.reduce((s, m) => s + m.n, 0);
  const refusedTotal = byMonth.reduce((s, m) => s + m.refused, 0);
  const byPayer = payers.map((p) => {
    const rs = reasons.filter((r) => r._id.p === p._id).sort((a, b) => b.amount - a.amount);
    return { payerId: String(p._id), name: p.name as string, top: rs.slice(0, 5).map((r) => ({ code: r._id.c as string, n: r.n as number, amount: Math.round(r.amount) })), lost: Math.round(rs.reduce((s, r) => s + r.amount, 0)) };
  });
  return {
    firstPass: { rate: total ? 1 - refusedTotal / total : null, claims: total, byMonth: byMonth.map((m) => ({ month: m._id as string, n: m.n as number, rate: 1 - m.refused / m.n })) },
    cashAtRisk: { held: { claims: atRiskHold[0]?.n ?? 0, amount: atRiskHold[0]?.net ?? 0 }, refusedOpen: { lines: atRiskDenials[0]?.n ?? 0, amount: atRiskDenials[0]?.amount ?? 0 } },
    recovered: Object.fromEntries(recovered.map((r) => [r._id, { lines: r.n, amount: r.amount }])) as Record<"history" | "seal", { lines: number; amount: number } | undefined>,
    daysToCash: { median: dts.length ? dts[Math.floor(dts.length / 2)] : null, p90: dts.length ? dts[Math.floor(dts.length * 0.9)] : null },
    byOrderType: Object.entries(kinds).map(([kind, x]) => ({ kind, lines: x.n, refusalRate: x.refused / x.n, lost: Math.round(x.lost) })).sort((a, b) => b.refusalRate - a.refusalRate),
    byPayer,
  };
}

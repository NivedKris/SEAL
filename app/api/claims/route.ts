import { after } from "next/server";
import { z } from "zod";
import { runClaimCheck } from "@/lib/check/run";
import { handle, actorFrom } from "@/lib/api/respond";
import { createClaimForEncounter } from "@/lib/claims/builder";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C, ClaimStatus } from "@/lib/db/schemas";
import { cptLabel } from "@/lib/codes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Claims list with counts per status (billing queues). ?status=hold|ready|submitted|refused…&limit=50 */
export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
    const d = await db();
    const statuses = status ? status.split(",").map((s) => ClaimStatus.parse(s)) : null;
    const live = url.searchParams.get("scope") === "live";
    // ?ids=a,b,c: exactly these claims, in this order (a list SEAL's assistant put together).
    const ids = url.searchParams.get("ids")?.split(",").filter((x) => /^[A-Za-z0-9._-]{1,64}$/.test(x)).slice(0, 50) ?? null;
    const filter = ids ? { _id: { $in: ids as never[] } } : { evalSet: false, ...(statuses ? { status: { $in: statuses } } : {}), ...(live ? { claimNo: /-L\d+$/ } : {}) };
    const [found, counts] = await Promise.all([
      d.collection(C.claims).find(filter, { projection: { "versions.xml": 0 } }).sort({ createdAt: -1, _id: -1 }).limit(ids ? 50 : limit).toArray(),
      d.collection(C.claims).aggregate([{ $match: { evalSet: false, claimNo: /-L\d+$/ } }, { $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
    ]);
    const claims = ids ? [...found].sort((a, b) => ids.indexOf(String(a._id)) - ids.indexOf(String(b._id))) : found;
    // Names, plus when the insurer's answer is due (mock post office) and what was paid, for the journey view.
    const [pats, payers, provs, files, rems] = await Promise.all([
      d.collection(C.patients).find({ _id: { $in: claims.map((c) => c.patientId) } }, { projection: { name: 1 } }).toArray(),
      d.collection(C.payers).find({}, { projection: { name: 1 } }).toArray(),
      d.collection(C.providers).find({}, { projection: { name: 1 } }).toArray(),
      d.collection(C.mockDhpo).find({ kind: "Claim.Submission", claimIds: { $in: claims.map((c) => c.claimNo) } }, { projection: { claimIds: 1, readyAt: 1, uploadedAt: 1 } }).sort({ uploadedAt: -1 }).toArray(),
      d.collection(C.remittances).find({ claimId: { $in: claims.map((c) => c._id) } }, { projection: { claimId: 1, receivedAt: 1, lines: 1 } }).sort({ receivedAt: -1 }).toArray(),
    ]);
    const rows = claims.map((c) => ({
      readyAt: files.find((f) => f.claimIds.includes(c.claimNo))?.readyAt,
      sentAt: c.versions.at(-1)?.sentAt,
      paidAmount: (() => {
        const r = rems.find((x) => x.claimId === c._id);
        return r ? Math.round(r.lines.reduce((s: number, l: { paymentAmount: number }) => s + l.paymentAmount, 0) * 100) / 100 : undefined;
      })(),
      paidAt: rems.find((x) => x.claimId === c._id)?.receivedAt,
      ...c,
      patientName: pats.find((p) => p._id === c.patientId)?.name,
      payerName: payers.find((p) => p._id === c.payerId)?.name,
      providerName: provs.find((p) => p._id === c.providerId)?.name,
      versions: c.versions.map((v: { lines: { code: string }[] }) => ({ ...v, lines: v.lines.map((l) => ({ ...l, label: cptLabel(l.code) })) })),
    }));
    return { counts: Object.fromEntries(counts.map((c) => [c._id, c.n])), claims: rows };
  });
}

/** Build the claim for a signed encounter. Body: { encounterId } */
export async function POST(req: Request) {
  return handle(async () => {
    const { encounterId } = z.object({ encounterId: z.string().min(1) }).parse(await req.json());
    const claim = await createClaimForEncounter(encounterId, actorFrom(req, "coder"));
    const d = await db();
    after(() => runClaimCheck(claim._id, { database: d }).catch(() => null));
    return { claim };
  });
}

import "server-only";
import type { Db } from "mongodb";
import { db as getDb } from "@/lib/db/mongo";
import { emit } from "@/lib/db/events";
import { COLLECTIONS as C, type ClaimDoc, type DenialDoc, type EventDoc, type RemittanceDoc } from "@/lib/db/schemas";
import { parseTransaction } from "./xml";
import { denialInfo } from "./denial-codes";
import { FACILITY, MAX_RESUBMISSIONS, RESUBMISSION_WINDOW_DAYS } from "./facility";
import { dhpo } from "./dhpo-client";
import { recordOutcome } from "@/lib/learning/ledger";
import { DAY, dubaiIso } from "@/lib/util/time";

type Actor = EventDoc["actor"];
const SYSTEM: Actor = { kind: "system", id: "remittance-ingest" };
const round2 = (n: number) => Math.round(n * 100) / 100;

export type IngestResult = { claimId: string; claimNo: string; version: number; paid: number; refused: number; status: ClaimDoc["status"] };

/**
 * Collect new remittance files from the post office and record them: remittance, one denial per
 * refused line (with its deadline), and the claim's status. Idempotent per remittance.
 * Called by the views' poll; the post office runs the insurer lazily on the same call.
 */
export async function pollRemittances(opts: { database?: Db; actor?: Actor } = {}): Promise<IngestResult[]> {
  const d = opts.database ?? (await getDb());
  const actor = opts.actor ?? SYSTEM;
  const out: IngestResult[] = [];
  for (const t of await dhpo.getNewTransactions(FACILITY.id, { database: d })) {
    if (t.kind !== "Remittance.Advice") continue;
    const xml = await dhpo.downloadTransactionFile(t._id, FACILITY.id, { database: d });
    if (!xml) continue;
    const tx = parseTransaction(xml);
    if (tx.kind !== "Remittance.Advice") continue;
    const replyTo = t.replyTo;
    for (const rc of tx.data.Claim) {
      const claim = (await d.collection(C.claims).findOne({ claimNo: rc.ID })) as ClaimDoc | null;
      if (!claim) continue; // not ours
      const v = claim.versions.find((x) => replyTo && x.transactionId === replyTo) ?? [...claim.versions].reverse().find((x) => x.sentAt)!;
      const now = Date.now();
      const remId = `${claim._id}-ra${v.version}`;
      const rem: RemittanceDoc = {
        _id: remId,
        claimId: claim._id,
        claimVersion: v.version,
        payerId: claim.payerId,
        idPayer: rc.IDPayer,
        paymentReference: rc.PaymentReference,
        readyAt: t.uploadedAt,
        receivedAt: dubaiIso(now),
        lines: rc.Activity.map((a) => ({
          activityId: a.ID,
          code: a.Code,
          net: a.Net,
          paymentAmount: a.PaymentAmount,
          ...(a.DenialCode ? { denialCode: a.DenialCode, payerComment: denialInfo(a.DenialCode).description } : {}),
        })),
        xml,
        writtenBy: { kind: "mock_dhpo", id: t._id },
        writtenAt: dubaiIso(now),
      };
      const inserted = await d.collection(C.remittances).updateOne({ _id: remId as never }, { $setOnInsert: rem }, { upsert: true });
      if (!inserted.upsertedCount) continue; // already recorded

      // Denials: queue refused lines; close earlier denials that this remittance settles.
      const queued: DenialDoc[] = [];
      for (const l of rem.lines) {
        const denId = `${claim._id}-den${l.activityId}`;
        if (!l.denialCode) {
          await d.collection(C.denials).updateOne({ _id: denId as never, status: { $in: ["queued", "drafted", "resubmitted"] } }, { $set: { status: "won", writtenBy: actor, writtenAt: dubaiIso(now) } });
          continue;
        }
        const outOfTries = v.version - 1 >= MAX_RESUBMISSIONS;
        const den: DenialDoc = {
          _id: denId,
          remittanceId: remId,
          claimId: claim._id,
          activityId: l.activityId,
          code: l.code,
          denialCode: l.denialCode,
          family: denialInfo(l.denialCode).family,
          amount: round2(l.net - l.paymentAmount),
          payerComment: l.payerComment,
          deadline: dubaiIso(now + RESUBMISSION_WINDOW_DAYS * DAY),
          status: outOfTries ? "lost" : "queued",
          writtenBy: actor,
          writtenAt: dubaiIso(now),
        };
        await d.collection(C.denials).replaceOne({ _id: denId as never }, den, { upsert: true });
        if (!outOfTries) queued.push(den);
      }

      // Claim status from the latest decision on every activity across all remittances.
      const all = (await d.collection(C.remittances).find({ claimId: claim._id }).sort({ claimVersion: 1 }).toArray()) as unknown as RemittanceDoc[];
      const final = new Map<string, { net: number; paid: number; denied: boolean }>();
      for (const r of all) for (const l of r.lines) final.set(l.activityId, { net: l.net, paid: l.paymentAmount, denied: !!l.denialCode });
      const states = [...final.values()];
      const status: ClaimDoc["status"] = states.every((s) => !s.denied) ? "paid" : states.every((s) => s.denied && s.paid === 0) ? "refused" : "partially_paid";
      await d.collection(C.claims).updateOne({ _id: claim._id as never }, { $set: { status } });

      const paid = round2(rem.lines.reduce((s, l) => s + l.paymentAmount, 0));
      const refused = rem.lines.filter((l) => l.denialCode).length;
      await emit("remittance.received", { claimId: claim._id, claimNo: claim.claimNo, version: v.version, remittanceId: remId, paid, refusedLines: refused, status }, actor);
      for (const den of queued) await emit("denial.queued", { claimId: claim._id, denialId: den._id, activityId: den.activityId, code: den.code, denialCode: den.denialCode, amount: den.amount, deadline: den.deadline }, actor);
      await recordOutcome(d, claim._id).catch(() => null);
      out.push({ claimId: claim._id, claimNo: claim.claimNo, version: v.version, paid, refused, status });
    }
    await dhpo.setTransactionDownloaded(t._id, FACILITY.id, { database: d });
  }
  return out;
}

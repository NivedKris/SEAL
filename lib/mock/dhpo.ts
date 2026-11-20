import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { ZodError } from "zod";
import { db as getDb } from "@/lib/db/mongo";
import { COLLECTIONS as C, type MockDhpoTxDoc } from "@/lib/db/schemas";
import { parseTransaction } from "@/lib/claims/xml";
import { dubaiIso } from "@/lib/util/time";
import { adjudicateFile } from "./insurer";

/**
 * MOCK DHPO post office (plan §6). Logically outside SEAL: it only speaks eClaimLink XML.
 * Operation names follow the real DHPO web service (UploadTransaction, GetNewTransactions,
 * DownloadTransactionFile, SetTransactionDownloaded); result codes are simplified.
 *
 * Lazy delay (no workers on Vercel): a claim file gets `readyAt = upload + insurer delay`.
 * The first GetNewTransactions after that runs the mock insurer and posts its remittance.
 */

export type UploadResult = { result: 0; transactionId: string; readyAt: string } | { result: -3; errors: string[] };

async function insurerDelaySeconds(d: Db): Promise<number> {
  const s = await d.collection(C.settings).findOne({ _id: "settings" as never });
  return (s?.insurerDelaySeconds as number | undefined) ?? 20;
}

/** UploadTransaction: validate the file against the R1 field rules and queue it for the insurer. */
export async function uploadTransaction(xml: string, opts: { database?: Db; delaySeconds?: number; fileName?: string } = {}): Promise<UploadResult> {
  const d = opts.database ?? (await getDb());
  let tx;
  try {
    tx = parseTransaction(xml);
  } catch (e) {
    const errors = e instanceof ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) : [(e as Error).message];
    return { result: -3, errors };
  }
  if (tx.kind !== "Claim.Submission") return { result: -3, errors: ["only Claim.Submission files can be uploaded by a provider"] };
  const now = Date.now();
  const delay = opts.delaySeconds ?? (await insurerDelaySeconds(d));
  const doc: MockDhpoTxDoc = {
    _id: `tx-${randomUUID()}`,
    kind: "Claim.Submission",
    senderId: tx.data.Header.SenderID,
    receiverId: tx.data.Header.ReceiverID,
    fileName: opts.fileName ?? `${tx.data.Header.SenderID}_${tx.data.Claim[0].ID}_${now}.xml`,
    xml,
    claimIds: tx.data.Claim.map((c) => c.ID),
    uploadedAt: dubaiIso(now),
    readyAt: dubaiIso(now + delay * 1000),
    status: "pending_adjudication",
  };
  await d.collection<MockDhpoTxDoc>(C.mockDhpo).insertOne(doc);
  return { result: 0, transactionId: doc._id, readyAt: doc.readyAt! };
}

/** Run the insurer on every claim file whose delay has passed. Safe to call from many instances at once. */
export async function adjudicateDue(d: Db, now = Date.now()): Promise<number> {
  const col = d.collection<MockDhpoTxDoc>(C.mockDhpo);
  let n = 0;
  for (;;) {
    // Claim one due file atomically so two instances never adjudicate the same file.
    const due = await col.findOneAndUpdate(
      { kind: "Claim.Submission", status: "pending_adjudication", readyAt: { $lte: dubaiIso(now) } },
      { $set: { status: "adjudicating" } },
      { sort: { readyAt: 1 }, returnDocument: "after" },
    );
    if (!due) return n;
    try {
      const { xml, claimIds } = await adjudicateFile(due.xml, d, new Date(due.uploadedAt).getTime(), now);
      const reply: MockDhpoTxDoc = {
        _id: `tx-${randomUUID()}`,
        kind: "Remittance.Advice",
        senderId: due.receiverId,
        receiverId: due.senderId,
        fileName: `${due.receiverId}_RA_${claimIds[0]}_${now}.xml`,
        xml,
        claimIds,
        uploadedAt: dubaiIso(now),
        status: "available",
        replyTo: due._id,
      };
      await col.insertOne(reply);
      await col.updateOne({ _id: due._id }, { $set: { status: "adjudicated", replyId: reply._id } });
      n++;
    } catch (e) {
      // Put it back so a later poll retries; surface the error to the caller.
      await col.updateOne({ _id: due._id }, { $set: { status: "pending_adjudication" } });
      throw e;
    }
  }
}

export type TransactionInfo = Pick<MockDhpoTxDoc, "_id" | "kind" | "senderId" | "fileName" | "claimIds" | "uploadedAt" | "replyTo">;

/** GetNewTransactions: files waiting for this receiver (adjudicating anything that is due first). */
export async function getNewTransactions(receiverId: string, opts: { database?: Db } = {}): Promise<TransactionInfo[]> {
  const d = opts.database ?? (await getDb());
  await adjudicateDue(d);
  return (await d
    .collection<MockDhpoTxDoc>(C.mockDhpo)
    .find({ receiverId, status: "available" }, { projection: { xml: 0 } })
    .sort({ uploadedAt: 1 })
    .limit(100)
    .toArray()) as TransactionInfo[];
}

/** DownloadTransactionFile. */
export async function downloadTransactionFile(id: string, receiverId: string, opts: { database?: Db } = {}): Promise<string | null> {
  const d = opts.database ?? (await getDb());
  const t = await d.collection<MockDhpoTxDoc>(C.mockDhpo).findOne({ _id: id, receiverId });
  return t?.xml ?? null;
}

/** SetTransactionDownloaded: the receiver confirms it has stored the file. */
export async function setTransactionDownloaded(id: string, receiverId: string, opts: { database?: Db } = {}): Promise<boolean> {
  const d = opts.database ?? (await getDb());
  const r = await d.collection<MockDhpoTxDoc>(C.mockDhpo).updateOne({ _id: id, receiverId, status: "available" }, { $set: { status: "downloaded", downloadedAt: dubaiIso() } });
  return r.modifiedCount === 1;
}

/** Insurer queue for /admin and the System Map: files waiting for their ready time. */
export async function insurerQueue(opts: { database?: Db } = {}) {
  const d = opts.database ?? (await getDb());
  return d
    .collection<MockDhpoTxDoc>(C.mockDhpo)
    .find({ kind: "Claim.Submission", status: { $in: ["pending_adjudication", "adjudicating"] } }, { projection: { xml: 0 } })
    .sort({ readyAt: 1 })
    .toArray();
}

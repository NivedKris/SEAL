import "server-only";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { parseTransaction } from "@/lib/claims/xml";
import type { ClaimSubmission, RemittanceAdvice } from "@/lib/claims/schema";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { cptLabel, icdLabel } from "@/lib/codes";
import { embedTexts, toVector } from "@/lib/ai/embed";
import { dubaiIso } from "@/lib/util/time";

/**
 * Past years from the post office (DHPO for Dubai, Shafafiya for Abu Dhabi), turned into SEAL's
 * memory. Both offices give a facility its own Claim.Submission and Remittance.Advice files
 * (SearchTransactions + DownloadTransactionFile, about 100 days per search window). This pairs each
 * claim with what the insurer answered and writes one outcome per claim to the ledger the
 * "Past claims" step searches. No patient identifiers are kept: codes, money, refusals and fixes only.
 */
export const HISTORY_PREFIX = "hx-";

type SubClaim = ClaimSubmission["Claim"][number];
type RemClaim = RemittanceAdvice["Claim"][number];

/** eClaimLink "dd/mm/yyyy HH:MM" → epoch ms (Dubai time). */
function when(s: string): number {
  const [d, m, y, hh = "0", mm = "0"] = s.split(/[/ :]/);
  return Date.parse(`${y}-${m}-${d}T${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:00+04:00`);
}

/** Split a span into the post office's search windows (≤100 days each), oldest first. */
export function searchWindows(from: Date, to: Date, days = 100): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  const f = (t: number) => {
    const d = new Date(t + 4 * 3600_000);
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()} 00:00`;
  };
  for (let t = from.getTime(); t < to.getTime(); t += days * 86_400_000) out.push({ from: f(t), to: f(Math.min(to.getTime(), t + days * 86_400_000)) });
  return out;
}

export type ImportReport = { files: number; badFiles: { name: string; error: string }[]; submissions: number; remittances: number; claims: number; written: number; skippedNoAnswer: number; firstPassRefused: number; embedded: number };

export async function importHistory(files: { name: string; xml: string }[], d: Db, opts: { dryRun?: boolean; embed?: boolean } = {}): Promise<ImportReport> {
  const subs = new Map<string, { at: number; c: SubClaim; sender: string }[]>();
  const rems = new Map<string, { at: number; c: RemClaim }[]>();
  const report: ImportReport = { files: files.length, badFiles: [], submissions: 0, remittances: 0, claims: 0, written: 0, skippedNoAnswer: 0, firstPassRefused: 0, embedded: 0 };

  for (const f of files) {
    try {
      const tx = parseTransaction(f.xml);
      const at = when(tx.data.Header.TransactionDate);
      if (tx.kind === "Claim.Submission") {
        for (const c of tx.data.Claim) push(subs, key(c.ProviderID, c.ID), { at, c, sender: tx.data.Header.SenderID });
        report.submissions += tx.data.Claim.length;
      } else {
        for (const c of tx.data.Claim) push(rems, key(c.ProviderID ?? tx.data.Header.ReceiverID, c.ID), { at, c });
        report.remittances += tx.data.Claim.length;
      }
    } catch (e) {
      report.badFiles.push({ name: f.name, error: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    }
  }

  const payers = await d.collection(C.payers).find({}, { projection: { name: 1, eclaimLinkId: 1 } }).toArray();
  const payerBy = new Map(payers.map((p) => [String(p.eclaimLinkId), { id: String(p._id), name: String(p.name) }]));
  const docs: Record<string, unknown>[] = [];

  for (const [k, versions] of subs) {
    report.claims++;
    const answers = (rems.get(k) ?? []).sort((a, b) => a.at - b.at);
    if (!answers.length) {
      report.skippedNoAnswer++;
      continue;
    }
    versions.sort((a, b) => a.at - b.at);
    const first = versions[0].c;
    const payer = payerBy.get(first.PayerID) ?? { id: first.PayerID, name: `Insurer ${first.PayerID}` };
    const net = new Map(first.Activity.map((a) => [a.ID, a.Net]));
    const firstAnswer = answers[0].c.Activity;
    const final = new Map<string, RemClaim["Activity"][number]>();
    for (const r of answers) for (const a of r.c.Activity) final.set(a.ID, a);
    const refusedFirst = firstAnswer.filter((a) => a.DenialCode || a.PaymentAmount < (net.get(a.ID) ?? a.Net) - 0.01);
    const paid = Math.round([...final.values()].reduce((s, a) => s + a.PaymentAmount, 0) * 100) / 100;
    const gross = first.Net;
    const lost = [...final.values()].filter((a) => a.DenialCode);
    const fixes = versions.slice(1).flatMap((v) => (v.c.Resubmission ? [v.c.Resubmission.Comment] : []));
    if (refusedFirst.length) report.firstPassRefused++;
    const er = first.Encounter.Type === 2 || first.Encounter.Type === 4;
    const refusedTxt = refusedFirst.map((a) => `${a.DenialCode ?? "partial"} on ${a.Code} ${cptLabel(a.Code)}`);

    docs.push({
      _id: HISTORY_PREFIX + createHash("sha1").update(k).digest("hex").slice(0, 16),
      claimId: HISTORY_PREFIX + createHash("sha1").update(k).digest("hex").slice(0, 16),
      payerId: payer.id,
      specialty: "Imported history",
      theme: "post-office-history",
      codes: first.Activity.map((a) => a.Code),
      diagnoses: first.Diagnosis.map((x) => x.Code),
      finalStatus: !lost.length ? "paid" : paid > 0 ? "partially_paid" : "refused",
      gross,
      paid,
      firstPassRefused: refusedFirst.length > 0,
      refusedCodes: [...new Set(refusedFirst.flatMap((a) => (a.DenialCode ? [a.DenialCode] : [])))],
      refusedLines: refusedFirst.map((a) => ({ code: a.Code, denialCode: a.DenialCode ?? "PARTIAL", amount: Math.round(((net.get(a.ID) ?? a.Net) - a.PaymentAmount) * 100) / 100, recovered: !final.get(a.ID)?.DenialCode })),
      fixesApplied: fixes,
      daysToCash: Math.round((answers.at(-1)!.at - versions[0].at) / 86_400_000),
      predictedProbability: null,
      summary: [
        `Insurer: ${payer.name}. Specialty: unknown. Visit type: ${er ? "emergency" : "outpatient"}.`,
        `Diagnoses: ${first.Diagnosis.map((x) => `${x.Code} ${icdLabel(x.Code)}`).join("; ")}.`,
        `Services: ${first.Activity.map((a) => `${a.Code} ${cptLabel(a.Code)}${a.Quantity > 1 ? ` x${a.Quantity}` : ""}`).join("; ")}.`,
        refusedFirst.length ? `Refused: ${refusedTxt.join("; ")}.` : "Paid on first submission.",
        fixes.length ? `Resubmitted: ${fixes[0]}. Result: ${lost.length ? "partly lost" : "recovered"}.` : "",
      ].filter(Boolean).join(" "),
      closedAt: dubaiIso(answers.at(-1)!.at),
      writtenBy: { kind: "system", id: "history-import" },
      writtenAt: dubaiIso(Date.now()),
    });
  }

  if (opts.dryRun) {
    report.written = docs.length;
    return report;
  }
  const outcomes = d.collection(C.outcomes);
  for (let i = 0; i < docs.length; i += 500) {
    const batch = docs.slice(i, i + 500);
    // Re-importing the same files is safe: same claim → same id; a changed outcome clears its old vector.
    await outcomes.bulkWrite(batch.map((doc) => ({ replaceOne: { filter: { _id: doc._id as never }, replacement: doc, upsert: true } })), { ordered: false });
    report.written += batch.length;
  }
  if (opts.embed !== false) {
    const todo = await outcomes.find({ _id: { $regex: `^${HISTORY_PREFIX}` } as never, embedding: { $exists: false } }, { projection: { summary: 1 } }).toArray();
    for (let i = 0; i < todo.length; i += 64) {
      const batch = todo.slice(i, i + 64);
      const vecs = await embedTexts(batch.map((x) => String(x.summary)));
      await outcomes.bulkWrite(batch.map((x, j) => ({ updateOne: { filter: { _id: x._id }, update: { $set: { embedding: toVector(vecs[j]) } } } })), { ordered: false });
      report.embedded += batch.length;
    }
  }
  return report;
}

const key = (provider: string, id: string) => `${provider}|${id}`;
function push<T>(m: Map<string, T[]>, k: string, v: T) {
  const xs = m.get(k);
  if (xs) xs.push(v);
  else m.set(k, [v]);
}

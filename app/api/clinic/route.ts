import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { clinicMetrics } from "@/lib/clinic/metrics";
import { hospitalProfile } from "@/lib/hospital/profile";
import { insurerName } from "@/lib/hospital/names";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const FAMILY: Record<string, string> = { MNEC: "Medical necessity", COPY: "Co-pay not collected", PRCE: "Pricing", TIME: "Time limits", CLAI: "Claim format", DUPL: "Duplicates", AUTH: "Prior approval", CODE: "Coding", ELIG: "Eligibility", BENX: "Not covered", NCOV: "Not covered" };

/** Finance. For a hospital with its own history, its real numbers replace the simulated history. */
export async function GET() {
  return handle(async () => {
    const d = await db();
    const [m, hp] = await Promise.all([clinicMetrics(d), hospitalProfile(d)]);
    if (!hp) return { ...m, hospital: null };
    const refused = hp.byFamily.reduce((s, f) => s + f.amount, 0) || 1;
    return {
      ...m,
      hospital: { name: hp.hospital, claims: hp.totals.claims, from: hp.totals.from, to: hp.totals.to, submitted: hp.totals.submitted, rejected: hp.totals.rejected, unsettled: hp.totals.unsettled },
      firstPass: { rate: hp.firstTime.rate, claims: hp.firstTime.claims, byMonth: hp.firstTime.byMonth },
      recovered: { ...m.recovered, history: { lines: hp.resubmission.claims, amount: hp.resubmission.resubmitted - hp.resubmission.stillRejected } },
      daysToCash: { median: hp.timing.settleDaysMedian, p90: hp.timing.settleDaysP90 },
      // No order types in a remittance export: show where the money is lost, by refusal reason.
      byOrderType: hp.byFamily.slice(0, 6).map((f) => ({ kind: FAMILY[f.family] ?? f.family, lines: f.n, refusalRate: f.amount / refused, lost: f.amount })),
      byPayer: hp.byInsurer.slice(0, 4).map((x) => ({ payerId: x.payerId ?? x.code, name: insurerName(x.insurer), top: x.topCodes, lost: x.rejected })),
    };
  });
}

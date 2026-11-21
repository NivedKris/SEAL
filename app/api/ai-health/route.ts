import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { healthMetrics } from "@/lib/health/metrics";
import { hospitalProfile } from "@/lib/hospital/profile";
import { insurerName } from "@/lib/hospital/names";
import { currentTenant } from "@/lib/tenant-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** AI Health panels, computed from aiCalls, the ledger, evaluation runs, question sets and events. */
export async function GET() {
  return handle(async () => {
    const d = await db();
    const [h, hp] = await Promise.all([healthMetrics(d), hospitalProfile(d)]);
    const mnec = hp?.byFamily.find((f) => f.family === "MNEC");
    const tenant = await currentTenant();
    return {
      ...h,
      hospital: hp
        ? {
            name: hp.hospital,
            claims: hp.totals.claims,
            clinicians: hp.totals.clinicians,
            insurers: hp.totals.insurers,
            firstTime: hp.firstTime.rate,
            medicalNecessityShare: mnec ? mnec.amount / Math.max(1, hp.totals.rejected) : null,
            resubmissionRecovers: hp.resubmission.recoveredShare,
            deployment: tenant.deployment ?? null,
            toughest: ((t) => (t ? { insurer: insurerName(t.insurer), refusedClaimsRate: t.refusedClaimsRate } : null))(hp.byInsurer.filter((x) => x.claims >= 500).sort((a, b) => b.refusedClaimsRate - a.refusedClaimsRate)[0]),
          }
        : null,
    };
  });
}

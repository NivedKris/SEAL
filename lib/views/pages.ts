import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { clinicMetrics } from "@/lib/clinic/metrics";
import { healthMetrics } from "@/lib/health/metrics";
import { hospitalProfile } from "@/lib/hospital/profile";
import { insurerName } from "@/lib/hospital/names";
import { loadEncounterBundle } from "@/lib/claims/bundle";
import { currentTenant } from "@/lib/tenant-server";
import { ageAt } from "@/lib/util/time";
import { keepClinicToday } from "@/lib/admin/clinics";

/**
 * What each screen shows, in one place: the API routes return these, and the pages start them on
 * the server while the page is sent, so a first visit doesn't wait for a second round trip.
 */

/** Plain JSON (dates as strings), exactly as the API would send it. */
export const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const FAMILY: Record<string, string> = { MNEC: "Medical necessity", COPY: "Co-pay not collected", PRCE: "Pricing", TIME: "Time limits", CLAI: "Claim format", DUPL: "Duplicates", AUTH: "Prior approval", CODE: "Coding", ELIG: "Eligibility", BENX: "Not covered", NCOV: "Not covered" };

/** Finance. For a hospital with its own history, its real numbers replace the simulated history. */
export async function clinicView(d: Db) {
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
}

/** Insights (AI Health panels), with the hospital's own history when it has one. */
export async function aiHealthView(d: Db) {
  const [h, hp, tenant] = await Promise.all([healthMetrics(d), hospitalProfile(d), currentTenant()]);
  const mnec = hp?.byFamily.find((f) => f.family === "MNEC");
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
}

/** Only what the patient lists show; the full visit comes from encounterView. */
const LIST = { patientId: 1, providerId: 1, start: 1, status: 1, scenario: 1, theme: 1, complaint: 1, claimId: 1 };

/** Encounters by status, with patient and doctor names. Today's clinics in appointment order; other lists newest first. */
export async function encounterList(d: Db, status = "open", providerId?: string | null) {
  await keepClinicToday(d);
  const filter: Record<string, unknown> = { status, evalSet: false, ...(providerId ? { providerId } : {}) };
  const [encs, provs] = await Promise.all([
    d.collection(C.encounters).find(filter, { projection: LIST }).sort(status === "open" ? { start: 1 } : { start: -1 }).limit(status === "open" ? 300 : 50).toArray(),
    d.collection(C.providers).find({}, { projection: { name: 1, specialty: 1, displaySpecialty: 1 } }).toArray(),
  ]);
  const pats = await d.collection(C.patients).find({ _id: { $in: encs.map((e) => e.patientId) } }, { projection: { name: 1 } }).toArray();
  const patName = new Map(pats.map((p) => [String(p._id), p.name as string]));
  const prov = new Map(provs.map((p) => [String(p._id), p]));
  return {
    encounters: encs.map((e) => {
      const p = prov.get(String(e.providerId));
      return { ...e, patientName: patName.get(String(e.patientId)), providerName: p?.name, providerSpecialty: p?.displaySpecialty ?? p?.specialty };
    }),
  };
}

/** EMR simulator: one encounter with patient banner data, orders (incl. removed) and diagnoses. */
export async function encounterView(d: Db, id: string) {
  const [b, allOrders, claim] = await Promise.all([
    loadEncounterBundle(id, d),
    d.collection(C.orders).find({ encounterId: id }).sort({ orderedAt: 1, _id: 1 }).toArray(),
    d.collection(C.claims).findOne({ encounterId: id }, { projection: { _id: 1, claimNo: 1, status: 1 } }),
  ]);
  return {
    encounter: b.encounter,
    patient: { name: b.patient.name, sex: b.patient.sex, age: ageAt(b.patient.dob, new Date(b.encounter.start).getTime()), maskedId: b.patient.maskedId, nationality: b.patient.nationality },
    insurance: { payer: b.payer.name, plan: b.plan.name, memberNo: b.member.memberNo, validTo: b.member.validTo, copayPct: b.plan.copayPct },
    provider: { name: b.provider.name, specialty: (b.provider as { displaySpecialty?: string }).displaySpecialty ?? b.provider.specialty },
    orders: allOrders,
    diagnoses: b.diagnoses,
    priorAuths: b.priorAuths.filter((p) => p.status === "approved").map((p) => ({ authNo: p.authNo, codes: p.codes, approvedQty: p.approvedQty, validTo: p.validTo })),
    claim,
  };
}

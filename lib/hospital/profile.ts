import "server-only";
import type { Db } from "mongodb";

/**
 * A hospital's own claim history (from its DHPO / Shafafiya remittance exports, de-identified):
 * one row per claim with amounts, insurer, clinician, refusal codes and timings. The profile is the
 * summary SEAL uses to tune its screens and its risk for that hospital.
 */
export const HOSPITAL_CLAIMS = "hospitalClaims";
export const HOSPITAL_PROFILE = "hospitalProfile";

export type HospitalClaim = {
  claim: string;
  patient: string;
  activityDate: string | null;
  submittedOn: string | null;
  settledOn: string | null;
  insurerCode: string;
  insurer: string;
  tpa: string;
  clinicianId: string;
  clinician: string;
  providerId?: string;
  payerId?: string;
  deductible: number;
  submitted: number;
  remitted: number;
  rejected: number;
  resubmitted: number;
  unsettled: number;
  resubCount: number;
  denialCodes: string[];
  paymentStatus: string;
  ageingBucket: string;
};

type Rate = { claims: number; submitted: number; rejected: number; refusedClaims: number };
export type HospitalProfile = {
  _id: "profile";
  hospital: string;
  builtAt: string;
  totals: { claims: number; patients: number; clinicians: number; insurers: number; submitted: number; remitted: number; rejected: number; unsettled: number; deductible: number; from: string; to: string };
  /** Claims old enough to be settled: share paid in full on the first submission. */
  firstTime: { rate: number; claims: number; byMonth: { month: string; n: number; rate: number }[] };
  byInsurer: { insurer: string; code: string; payerId?: string; claims: number; submitted: number; rejected: number; refusedClaimsRate: number; rejectedShare: number; topCodes: { code: string; n: number; amount: number }[] }[];
  byClinician: { clinicianId: string; name: string; providerId?: string; claims: number; refusedClaimsRate: number; firstTime: number }[];
  byCode: { code: string; n: number; amount: number }[];
  byFamily: { family: string; n: number; amount: number }[];
  resubmission: { claims: number; resubmitted: number; stillRejected: number; recoveredShare: number };
  timing: { submitDaysMedian: number | null; settleDaysMedian: number | null; settleDaysP90: number | null };
  ageing: { bucket: string; claims: number; unsettled: number }[];
};

const days = (a: string | null, b: string | null) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) : null);
const pct = (xs: number[], q: number) => (xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length * q)] : null);
const round = (n: number) => Math.round(n);

const realCode = (c: string) => !!c && !["nan", "none", "null"].includes(c.trim().toLowerCase());

export function buildProfile(hospital: string, input: HospitalClaim[]): Omit<HospitalProfile, "builtAt"> {
  const rows = input.map((r) => ({ ...r, denialCodes: r.denialCodes.filter(realCode) }));
  const dates = rows.map((r) => r.activityDate).filter(Boolean).sort() as string[];
  const cutoff = new Date(Date.parse(dates.at(-1)!) - 90 * 86_400_000).toISOString().slice(0, 10); // settled claims only
  const mature = rows.filter((r) => r.activityDate && r.activityDate < cutoff);
  const clean = (r: HospitalClaim) => r.rejected <= 0.005 && r.resubCount === 0;
  const refused = (r: HospitalClaim) => r.rejected > 0.005 || r.resubCount > 0;

  const months = new Map<string, { n: number; clean: number }>();
  for (const r of mature) {
    const m = r.activityDate!.slice(0, 7);
    const x = months.get(m) ?? { n: 0, clean: 0 };
    x.n++;
    if (clean(r)) x.clean++;
    months.set(m, x);
  }

  const group = <K extends string>(key: (r: HospitalClaim) => K) => {
    const g = new Map<K, HospitalClaim[]>();
    for (const r of rows) g.set(key(r), [...(g.get(key(r)) ?? []), r]);
    return g;
  };
  const codesOf = (rs: HospitalClaim[]) => {
    const m = new Map<string, { n: number; amount: number }>();
    for (const r of rs) for (const c of r.denialCodes) {
      const x = m.get(c) ?? { n: 0, amount: 0 };
      x.n++;
      x.amount += r.rejected / r.denialCodes.length;
      m.set(c, x);
    }
    return [...m.entries()].map(([code, x]) => ({ code, n: x.n, amount: round(x.amount) })).sort((a, b) => b.amount - a.amount);
  };
  const rate = (rs: HospitalClaim[]): Rate => ({ claims: rs.length, submitted: rs.reduce((s, r) => s + r.submitted, 0), rejected: rs.reduce((s, r) => s + r.rejected, 0), refusedClaims: rs.filter(refused).length });

  const byInsurer = [...group((r) => r.insurer)].map(([insurer, rs]) => {
    const x = rate(rs);
    return { insurer, code: rs[0].insurerCode, payerId: rs.find((r) => r.payerId)?.payerId, claims: x.claims, submitted: round(x.submitted), rejected: round(x.rejected), refusedClaimsRate: x.refusedClaims / x.claims, rejectedShare: x.submitted ? x.rejected / x.submitted : 0, topCodes: codesOf(rs).slice(0, 4) };
  }).sort((a, b) => b.submitted - a.submitted);

  const byClinician = [...group((r) => r.clinicianId)].map(([clinicianId, rs]) => {
    const m = rs.filter((r) => r.activityDate && r.activityDate < cutoff);
    return { clinicianId, name: rs[0].clinician, providerId: rs.find((r) => r.providerId)?.providerId, claims: rs.length, refusedClaimsRate: rs.filter(refused).length / rs.length, firstTime: m.length ? m.filter(clean).length / m.length : 0 };
  }).sort((a, b) => b.claims - a.claims);

  const byCode = codesOf(rows);
  const fam = new Map<string, { n: number; amount: number }>();
  for (const c of byCode) {
    const f = c.code.split("-")[0];
    const x = fam.get(f) ?? { n: 0, amount: 0 };
    x.n += c.n;
    x.amount += c.amount;
    fam.set(f, x);
  }
  const resub = mature.filter((r) => r.resubCount > 0);
  const resubAmt = resub.reduce((s, r) => s + r.resubmitted, 0);
  const stillRej = resub.reduce((s, r) => s + r.rejected, 0);
  const ageing = [...group((r) => r.ageingBucket ?? "unknown")].map(([bucket, rs]) => ({ bucket, claims: rs.length, unsettled: round(rs.reduce((s, r) => s + r.unsettled, 0)) }));
  const order = ["0-45", "46-90", "91-120", "121-365", "365+"];
  ageing.sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket));

  return {
    _id: "profile",
    hospital,
    totals: {
      claims: rows.length,
      patients: new Set(rows.map((r) => r.patient)).size,
      clinicians: new Set(rows.map((r) => r.clinicianId)).size,
      insurers: new Set(rows.map((r) => r.insurer)).size,
      submitted: round(rows.reduce((s, r) => s + r.submitted, 0)),
      remitted: round(rows.reduce((s, r) => s + r.remitted, 0)),
      rejected: round(rows.reduce((s, r) => s + r.rejected, 0)),
      unsettled: round(rows.reduce((s, r) => s + r.unsettled, 0)),
      deductible: round(rows.reduce((s, r) => s + r.deductible, 0)),
      from: dates[0],
      to: dates.at(-1)!,
    },
    firstTime: { rate: mature.filter(clean).length / mature.length, claims: mature.length, byMonth: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, x]) => ({ month, n: x.n, rate: x.clean / x.n })) },
    byInsurer,
    byClinician,
    byCode: byCode.slice(0, 25),
    byFamily: [...fam].map(([family, x]) => ({ family, n: x.n, amount: round(x.amount) })).sort((a, b) => b.amount - a.amount),
    resubmission: { claims: resub.length, resubmitted: round(resubAmt), stillRejected: round(stillRej), recoveredShare: resubAmt ? 1 - stillRej / resubAmt : 0 },
    timing: {
      submitDaysMedian: pct(rows.map((r) => days(r.activityDate, r.submittedOn)).filter((x): x is number => x != null), 0.5),
      settleDaysMedian: pct(rows.map((r) => days(r.activityDate, r.settledOn)).filter((x): x is number => x != null && x >= 0), 0.5),
      settleDaysP90: pct(rows.map((r) => days(r.activityDate, r.settledOn)).filter((x): x is number => x != null && x >= 0), 0.9),
    },
    ageing,
  };
}

/** The hospital's profile in this database, or null for hospitals without their own history (Basic). */
export async function hospitalProfile(d: Db): Promise<HospitalProfile | null> {
  // It only changes when the hospital's history is imported again, so keep it in memory for a minute.
  const hit = profileCache.get(d.databaseName);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const value = (await d.collection<HospitalProfile>(HOSPITAL_PROFILE).findOne({ _id: "profile" })) ?? null;
  profileCache.set(d.databaseName, { at: Date.now(), value });
  return value;
}
const profileCache = new Map<string, { at: number; value: HospitalProfile | null }>();

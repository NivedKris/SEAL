import "server-only";
import { sharedDb } from "@/lib/db/mongo";
import type { Db } from "mongodb";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { hospitalProfile } from "./profile";
import { insurerName } from "./names";

/**
 * How this hospital's own history should move a claim's risk. For the claim's insurer, compare how
 * often it refused *this hospital's* claims with how often it refuses claims across the regional
 * memory. A hospital that this insurer refuses twice as often gets a higher risk, and the reason is
 * shown in the trace. Hospitals without their own history (Basic) get no adjustment.
 */
export type HospitalPrior = {
  hospital: string;
  insurer: string;
  hospitalClaims: number;
  hospitalRate: number;
  regionalRate: number;
  /** Insurer factor × doctor factor. */
  factor: number;
  insurerFactor: number;
  doctor?: { name: string; claims: number; rate: number; clinicRate: number; factor: number };
  topCodes: { code: string; n: number; amount: number }[];
};

const regionalCache = new Map<string, { at: number; rates: Map<string, number> }>();
async function regionalRates() {
  const d = await sharedDb();
  const c = regionalCache.get(d.databaseName);
  if (c && Date.now() - c.at < 30 * 60_000) return c.rates;
  const rows = await d.collection(C.outcomes).aggregate([{ $group: { _id: "$payerId", n: { $sum: 1 }, refused: { $sum: { $cond: ["$firstPassRefused", 1, 0] } } } }]).toArray();
  const rates = new Map(rows.map((r) => [String(r._id), (r.refused as number) / Math.max(1, r.n as number)]));
  regionalCache.set(d.databaseName, { at: Date.now(), rates });
  return rates;
}

export async function hospitalPrior(d: Db, payerId: string, providerId?: string): Promise<HospitalPrior | null> {
  const hp = await hospitalProfile(d);
  if (!hp) return null;
  const ins = hp.byInsurer.find((x) => x.payerId === payerId);
  if (!ins || ins.claims < 200) return null;
  const regional = (await regionalRates()).get(payerId);
  if (!regional) return null;
  const insurerFactor = Math.min(1.8, Math.max(0.6, ins.refusedClaimsRate / regional));
  // The doctor: how often their claims are refused against the clinic average.
  const doc = providerId ? hp.byClinician.find((c) => c.providerId === providerId) : undefined;
  const clinicRate = hp.byClinician.reduce((s, c) => s + c.refusedClaimsRate * c.claims, 0) / Math.max(1, hp.byClinician.reduce((s, c) => s + c.claims, 0));
  const doctor = doc && doc.claims >= 150 ? { name: doc.name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()), claims: doc.claims, rate: doc.refusedClaimsRate, clinicRate, factor: Math.round(Math.min(1.4, Math.max(0.75, doc.refusedClaimsRate / clinicRate)) * 100) / 100 } : undefined;
  const factor = insurerFactor * (doctor?.factor ?? 1);
  return { hospital: hp.hospital, insurer: insurerName(ins.insurer), hospitalClaims: ins.claims, hospitalRate: ins.refusedClaimsRate, regionalRate: regional, factor: Math.round(factor * 100) / 100, insurerFactor: Math.round(insurerFactor * 100) / 100, doctor, topCodes: ins.topCodes.slice(0, 3) };
}

/** Apply the hospital factor to one line's refusal probability (gently, and never past 0.97). */
export const adjust = (p: number, factor: number) => Math.min(0.97, Math.max(0.005, p * Math.pow(factor, 0.8)));

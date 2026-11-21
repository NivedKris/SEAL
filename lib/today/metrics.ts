import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { clinicMetrics } from "@/lib/clinic/metrics";
import { dubaiIso, DAY } from "@/lib/util/time";
import { hospitalProfile } from "@/lib/hospital/profile";
import { insurerName } from "@/lib/hospital/names";

/**
 * The Today dashboard in one call: the day's claims as a thread of stages, the money, every
 * doctor's day, what needs someone now, and how each insurer is treating the hospital.
 */
const LIVE = /-L\d+$/;

// Per-doctor first-time acceptance from the history is costly (20k claims): cache for 10 minutes.
const doctorRateCache = new Map<string, { at: number; rates: Map<string, { claims: number; rate: number }> }>();
async function firstTimeByDoctor(d: Db) {
  const doctorRates = doctorRateCache.get(d.databaseName);
  if (doctorRates && Date.now() - doctorRates.at < 10 * 60_000) return doctorRates.rates;
  const rows = await d
    .collection(C.outcomes)
    .aggregate([
      { $project: { firstPassRefused: 1 } },
      { $lookup: { from: C.claims, localField: "_id", foreignField: "_id", as: "c", pipeline: [{ $project: { providerId: 1 } }] } },
      { $unwind: "$c" },
      { $group: { _id: "$c.providerId", n: { $sum: 1 }, refused: { $sum: { $cond: ["$firstPassRefused", 1, 0] } } } },
    ])
    .toArray();
  const rates = new Map(rows.map((r) => [String(r._id), { claims: r.n as number, rate: 1 - (r.refused as number) / (r.n as number) }]));
  doctorRateCache.set(d.databaseName, { at: Date.now(), rates });
  return rates;
}

export async function todayMetrics(d: Db) {
  const now = Date.now();
  const todayStart = `${dubaiIso(now).slice(0, 10)}T00:00:00+04:00`;
  const since90 = new Date(now - 90 * DAY).toISOString();

  const [encToday, openQs, live, providers, payers, denialsDue, rates, money, payerRows, learnReady] = await Promise.all([
    d.collection(C.encounters).find({ start: { $gte: todayStart }, evalSet: false }, { projection: { providerId: 1, status: 1 } }).toArray(),
    d.collection(C.questionSets).find({ status: "open" }, { projection: { providerId: 1, claimId: 1, questions: 1 } }).toArray(),
    d.collection(C.claims).find({ claimNo: LIVE }, { projection: { status: 1, net: 1, payerId: 1, providerId: 1, patientId: 1, claimNo: 1, riskScore: 1 } }).toArray(),
    d.collection(C.providers).find({}, { projection: { name: 1, specialty: 1, displaySpecialty: 1, hospitalClinicianId: 1 } }).toArray(),
    d.collection(C.payers).find({}, { projection: { name: 1 } }).toArray(),
    d.collection(C.denials).find({ status: { $in: ["queued", "drafted"] }, deadline: { $gte: new Date(now).toISOString() } }, { projection: { claimId: 1, amount: 1, deadline: 1, denialCode: 1 } }).sort({ deadline: 1 }).limit(20).toArray(),
    firstTimeByDoctor(d),
    clinicMetrics(d),
    d
      .collection(C.remittances)
      .aggregate([
        { $match: { claimVersion: 1, readyAt: { $gte: since90, $lte: new Date(now).toISOString() } } },
        { $project: { payerId: 1, refused: { $gt: [{ $size: { $filter: { input: "$lines", cond: { $ifNull: ["$$this.denialCode", false] } } } }, 0] } } },
        { $group: { _id: "$payerId", n: { $sum: 1 }, refused: { $sum: { $cond: ["$refused", 1, 0] } } } },
      ])
      .toArray(),
    // Same measure as Insights: finished claims since SEAL last learned.
    d
      .collection(C.learningCycles)
      .find({}, { projection: { at: 1 } })
      .sort({ at: -1 })
      .limit(1)
      .toArray()
      .then(async (c) => {
        const since = (c[0]?.at as string | undefined) ?? null;
        return { ready: await d.collection(C.outcomes).countDocuments(since ? { writtenAt: { $gt: since } } : {}), since };
      }),
  ]);

  // A hospital with its own history (e.g. Apollo): its real numbers replace the simulated ones.
  const hp = await hospitalProfile(d);
  const liveIds = live.map((c) => String(c._id));
  const paidRems = await d.collection(C.remittances).find({ claimId: { $in: liveIds } }, { projection: { claimId: 1, lines: 1 } }).toArray();
  const paidAmount = paidRems.reduce((s, r) => s + (r.lines as { paymentAmount: number }[]).reduce((t, l) => t + l.paymentAmount, 0), 0);
  const count = (...st: string[]) => live.filter((c) => st.includes(c.status as string)).length;
  const sum = (...st: string[]) => live.filter((c) => st.includes(c.status as string)).reduce((s, c) => s + (c.net as number), 0);

  const thread = [
    { key: "seen", label: "Seen", n: encToday.length, href: "/emr" },
    { key: "signed", label: "Signed", n: encToday.filter((e) => e.status !== "open").length + count("ready", "hold", "submitted", "paid", "partially_paid", "refused", "resubmitted"), href: "/emr" },
    { key: "questions", label: "Questions", n: openQs.length, href: "/doctor", note: "for doctors" },
    { key: "attention", label: "Needs attention", n: count("hold", "checking"), href: "/billing", note: "for billing" },
    { key: "ready", label: "Ready to send", n: count("ready"), href: "/billing?tab=ready" },
    { key: "insurer", label: "With the insurer", n: count("submitted", "resubmitted"), href: "/billing?tab=sent" },
    { key: "accepted", label: "Accepted", n: count("paid", "partially_paid", "closed"), href: "/billing?tab=paid", declined: count("refused") },
  ];

  const payerName = new Map(payers.map((p) => [String(p._id), String(p.name)]));
  const provName = new Map(providers.map((p) => [String(p._id), String(p.name)]));
  const doctors = providers
    .map((p) => {
      const id = String(p._id);
      const mine = encToday.filter((e) => e.providerId === id);
      const real = hp?.byClinician.find((c) => c.providerId === id);
      const r = real ? { rate: real.firstTime, claims: real.claims } : rates.get(id);
      return {
        id,
        name: String(p.name),
        specialty: String(p.displaySpecialty ?? p.specialty).replace(/_/g, " "),
        patientsToday: mine.length,
        stillWriting: mine.filter((e) => e.status === "open").length,
        openQuestions: openQs.filter((q) => q.providerId === id).length,
        firstTime: r?.rate ?? null,
        historyClaims: r?.claims ?? 0,
      };
    })
    .sort((a, b) => b.patientsToday - a.patientsToday || a.name.localeCompare(b.name));

  // Needs you: ranked by money × urgency
  type Item = { kind: "question" | "claim" | "appeal"; title: string; detail: string; href: string; amount: number; score: number };
  const items: Item[] = [];
  const qByDoc = new Map<string, number>();
  for (const q of openQs) qByDoc.set(String(q.providerId), (qByDoc.get(String(q.providerId)) ?? 0) + 1);
  for (const [pid, n] of qByDoc) {
    const amount = live.filter((c) => c.providerId === pid && c.status === "hold").reduce((s, c) => s + (c.net as number), 0);
    items.push({ kind: "question", title: `${provName.get(pid) ?? "A doctor"}`, detail: `${n} question${n > 1 ? "s" : ""} waiting`, href: `/doctor?providerId=${pid}`, amount, score: amount * 1.5 + n * 200 });
  }
  for (const c of live.filter((x) => x.status === "hold").sort((a, b) => (b.net as number) - (a.net as number)).slice(0, 4))
    items.push({ kind: "claim", title: `Claim ${String(c.claimNo).split("-").at(-1)}`, detail: `${payerName.get(String(c.payerId)) ?? "Insurer"} · held before sending`, href: `/billing/claims/${c._id}`, amount: c.net as number, score: (c.net as number) * (1 + ((c.riskScore as number) ?? 0)) });
  for (const x of denialsDue.slice(0, 6)) {
    const days = Math.max(1, Math.ceil((Date.parse(x.deadline as string) - now) / DAY));
    items.push({ kind: "appeal", title: `Appeal due in ${days} day${days > 1 ? "s" : ""}`, detail: `${x.denialCode} · declined line`, href: "/billing?tab=refused", amount: x.amount as number, score: ((x.amount as number) * 10) / days });
  }

  const hour = Number(dubaiIso(now).slice(11, 13));
  return {
    greeting: hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening",
    date: new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dubai" }),
    watching: live.length + encToday.filter((e) => e.status === "open").length,
    thread,
    money: {
      acceptedToday: Math.round(paidAmount),
      atRisk: Math.round(sum("hold", "checking")),
      recoveredMonth: Math.round(money.recovered.seal?.amount ?? money.recovered.history?.amount ?? 0),
      firstTime: hp ? hp.firstTime.rate : money.firstPass.rate,
      trend: (hp ? hp.firstTime.byMonth : money.firstPass.byMonth).slice(-8).map((m) => m.rate),
    },
    doctors,
    needsYou: items.sort((a, b) => b.score - a.score).slice(0, 6),
    hospital: hp ? { name: hp.hospital, claims: hp.totals.claims, from: hp.totals.from, to: hp.totals.to } : null,
    insurers: hp
      ? hp.byInsurer.slice(0, 6).map((x) => ({ id: x.code, name: insurerName(x.insurer), claims: x.claims, accepted: 1 - x.refusedClaimsRate }))
      : payerRows
      .map((r) => ({ id: String(r._id), name: payerName.get(String(r._id)) ?? String(r._id), claims: r.n as number, accepted: 1 - (r.refused as number) / (r.n as number) }))
      .sort((a, b) => b.accepted - a.accepted),
    learning: learnReady,
  };
}
export type TodayMetrics = Awaited<ReturnType<typeof todayMetrics>>;

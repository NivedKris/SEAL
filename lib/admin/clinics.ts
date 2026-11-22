import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { dubaiIso } from "@/lib/util/time";

/**
 * Today's clinics: every doctor (and physiotherapist) gets their own list of patients for today,
 * copied from that clinician's own earlier visits in the history, so the complaint, examination,
 * diagnoses and orders are real for their specialty. The visits are open: the doctor is still
 * writing, and SEAL checks as they go. Ids start with "enc-T-" so a reset can clear them.
 */
export const CLINIC_PREFIX = "enc-T";

/** Deterministic per-day shuffle so the same day gives the same clinic. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * Keep the clinic on today. The clinic is created when the demo is set up; on a later day, the
 * visits still open (not yet signed) move to today at the same times, so Today, Patients and the
 * doctors' cards always show a live clinic. Runs once a day per hospital (cheap afterwards).
 */
const rolled = new Map<string, string>();
export async function keepClinicToday(d: Db) {
  const today = dubaiIso().slice(0, 10);
  if (rolled.get(d.databaseName) === today) return;
  const stale = { _id: { $regex: `^${CLINIC_PREFIX}-` }, status: "open", start: { $lt: today } } as never;
  const ids = (await d.collection(C.encounters).find(stale, { projection: { _id: 1 } }).toArray()).map((e) => String(e._id));
  if (ids.length) {
    // same time of day, today's date ("2026-11-21T10:05:00+04:00" → today + "T10:05:00+04:00")
    const move = (field: string) => [{ $set: { [field]: { $concat: [today, { $substrCP: [`$${field}`, 10, 20] }] } } }];
    await d.collection(C.encounters).updateMany({ _id: { $in: ids as never[] } }, move("start"));
    await d.collection(C.orders).updateMany({ encounterId: { $in: ids }, orderedAt: { $lt: today } }, move("orderedAt"));
  }
  rolled.set(d.databaseName, today);
}

export async function clearClinics(d: Db) {
  const ids = (await d.collection(C.encounters).find({ _id: { $regex: `^${CLINIC_PREFIX}-` } as never }, { projection: { _id: 1 } }).toArray()).map((e) => String(e._id));
  if (!ids.length) return 0;
  await d.collection(C.orders).deleteMany({ encounterId: { $in: ids } });
  await d.collection(C.diagnoses).deleteMany({ encounterId: { $in: ids } });
  return (await d.collection(C.encounters).deleteMany({ _id: { $in: ids as never[] } })).deletedCount;
}

export async function seedClinics(d: Db, opts: { min?: number; max?: number } = {}) {
  const min = opts.min ?? 3;
  const max = opts.max ?? 6;
  await clearClinics(d);
  const now = Date.now();
  const dayKey = Number(dubaiIso(now).slice(0, 10).replace(/-/g, ""));
  const rnd = seeded(dayKey);
  const today = dubaiIso(now).slice(0, 10);
  const providers = await d.collection(C.providers).find({}, { projection: { name: 1, specialty: 1 } }).toArray();
  const summary: { providerId: string; name: string; patients: number }[] = [];

  for (const [pi, prov] of providers.entries()) {
    const want = min + Math.floor(rnd() * (max - min + 1));
    // Older, fully documented visits by this clinician (not scenario, not held-out evaluation).
    const pool = await d
      .collection(C.encounters)
      .aggregate([{ $match: { providerId: prov._id, evalSet: false, scenario: { $exists: false }, status: "claimed", _id: { $not: /^enc-[WT]-/ } } }, { $sample: { size: want * 4 } }, { $project: { noteVersions: 0 } }])
      .toArray();
    const seen = new Set<string>();
    const picks = pool.filter((e) => !seen.has(e.patientId) && seen.add(e.patientId)).slice(0, want);
    let slot = 0;
    for (const src of picks) {
      const id = `${CLINIC_PREFIX}-${String(pi + 1).padStart(2, "0")}${String(slot + 1).padStart(2, "0")}`;
      // 08:00 onwards, one patient every 20–30 minutes
      const start = `${today}T${String(8 + Math.floor((slot * 25) / 60)).padStart(2, "0")}:${String((slot * 25) % 60).padStart(2, "0")}:00+04:00`;
      slot++;
      await d.collection(C.encounters).insertOne({ ...src, _id: id as never, start, end: undefined, status: "open", noteVersions: [], addenda: [], sealHold: false, writtenAt: dubaiIso(now) });
      for (const col of [C.orders, C.diagnoses]) {
        const docs = await d.collection(col).find({ encounterId: src._id }).toArray();
        if (docs.length) await d.collection(col).insertMany(docs.map((x, j) => ({ ...x, _id: `${id}-${col === C.orders ? "o" : "dx"}${j + 1}` as never, encounterId: id, ...(col === C.orders ? { justificationStatus: "unchecked", orderedAt: start } : {}) })));
      }
    }
    summary.push({ providerId: String(prov._id), name: String(prov.name), patients: picks.length });
  }
  return { clinicians: summary.length, patients: summary.reduce((n, s) => n + s.patients, 0), summary };
}

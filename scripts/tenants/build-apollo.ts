/**
 * Build Apollo Clinic's SEAL (database seal_apollo):
 *   1. Copy SEAL Basic's shared knowledge and demo clinic (rules, regional claim memory, cases).
 *   2. Put Apollo's own doctors and insurers in place of the simulated ones.
 *   3. Load Apollo's de-identified claim history and build its profile.
 *
 *   npm run tenant:apollo -- <apollo-deid.jsonl.gz>
 *
 * The input is the output of the de-identification step (no Emirates IDs, card numbers or patient
 * IDs; patients and invoices are pseudonyms). Re-running rebuilds seal_apollo from scratch.
 */
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { env } from "@/lib/env";
import { mongoClient, tenantDb } from "@/lib/db/mongo";
import { ensureIndexes } from "@/lib/db/indexes";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { TENANTS } from "@/lib/tenant";
import { buildProfile, HOSPITAL_CLAIMS, HOSPITAL_PROFILE, type HospitalClaim } from "@/lib/hospital/profile";
import { importHospitalMemory } from "@/lib/hospital/memory";
import { dubaiIso } from "@/lib/util/time";

const file = process.argv[2];
if (!file) throw new Error("usage: npm run tenant:apollo -- <apollo-deid.jsonl.gz>");
const APOLLO = TENANTS.apollo;

/** Simulated insurer → Apollo's real insurer (by Apollo volume; Sukoon kept for its high refusal rate). */
const INSURER_FOR: Record<string, { sheet: string; name: string }> = {
  falcon: { sheet: "QAT INS", name: "Qatar Insurance" },
  crescent: { sheet: "ORIENT INS", name: "Orient Insurance" },
  gulfshield: { sheet: "NLGI", name: "National Life & General" },
  palm: { sheet: "Sukoon Ins", name: "Sukoon Insurance" },
};
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, " ").trim();

async function main() {
  const client = await mongoClient();
  const src = await tenantDb(env.MONGODB_DB);
  const dst = await tenantDb(APOLLO.db);
  if (src.databaseName === dst.databaseName) throw new Error("source and target are the same database");

  // 1. Shared knowledge and the demo clinic
  console.log(`dropping ${dst.databaseName}`);
  await dst.dropDatabase();
  for (const { name } of await src.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith("system.")) continue;
    // The regional memory of past claims is shared: hospitals read it from the Basic database.
    if (name === C.outcomes) continue;
    const from = src.collection(name);
    const to = dst.collection(name);
    let n = 0;
    let batch: Record<string, unknown>[] = [];
    for await (const doc of from.find({})) {
      batch.push(doc);
      if (batch.length === 2000) {
        await to.insertMany(batch as never[], { ordered: false });
        n += batch.length;
        batch = [];
      }
    }
    if (batch.length) await to.insertMany(batch as never[], { ordered: false });
    n += batch.length;
    console.log(`  copied ${name}: ${n}`);
  }
  await ensureIndexes(dst, (s) => console.log("  " + s));

  // 2. Apollo's history
  const rows: HospitalClaim[] = [];
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()) });
  for await (const line of rl) if (line.trim()) rows.push(JSON.parse(line));
  console.log(`read ${rows.length} de-identified Apollo claims`);

  // 3. Apollo's doctors in place of the simulated clinicians (busiest with busiest)
  const providers = await dst.collection(C.providers).find({}).toArray();
  const encCount = new Map((await dst.collection(C.encounters).aggregate([{ $group: { _id: "$providerId", n: { $sum: 1 } } }]).toArray()).map((x) => [String(x._id), x.n as number]));
  providers.sort((a, b) => (encCount.get(String(b._id)) ?? 0) - (encCount.get(String(a._id)) ?? 0));
  const clinVolume = new Map<string, { name: string; n: number }>();
  for (const r of rows) clinVolume.set(r.clinicianId, { name: r.clinician, n: (clinVolume.get(r.clinicianId)?.n ?? 0) + 1 });
  const clinicians = [...clinVolume].sort((a, b) => b[1].n - a[1].n);
  const providerFor = new Map<string, string>();
  for (const [i, p] of providers.entries()) {
    const c = clinicians[i];
    if (!c) break;
    providerFor.set(c[0], String(p._id));
    await dst.collection(C.providers).updateOne({ _id: p._id }, { $set: { name: title(c[1].name), displaySpecialty: APOLLO.hospital, hospitalClinicianId: c[0] } });
  }
  console.log(`mapped ${providerFor.size} Apollo clinicians onto the clinic's doctors`);

  // 4. Apollo's insurers in place of the simulated ones
  const payerFor = new Map<string, string>();
  for (const [payerId, m] of Object.entries(INSURER_FOR)) {
    const sample = rows.find((r) => r.insurer === m.sheet);
    if (!sample) continue;
    const old = await dst.collection(C.payers).findOne({ _id: payerId as never });
    if (!old) continue;
    payerFor.set(m.sheet, payerId);
    await dst.collection(C.payers).updateOne({ _id: payerId as never }, { $set: { name: m.name, eclaimLinkId: sample.insurerCode, hospitalInsurer: m.sheet } });
    const plans = await dst.collection(C.plans).find({ payerId }).toArray();
    for (const pl of plans) await dst.collection(C.plans).updateOne({ _id: pl._id }, { $set: { name: String(pl.name).replace(String(old.name), m.name) } });
  }
  console.log(`mapped insurers: ${[...payerFor].map(([s, p]) => `${s}→${p}`).join(", ")}`);

  // 5. History layer and profile
  for (const r of rows) {
    r.providerId = providerFor.get(r.clinicianId);
    r.payerId = payerFor.get(r.insurer);
  }
  // The profile is built from every claim; the raw rows are not stored (the de-identified file is the source).
  void HOSPITAL_CLAIMS;
  const profile = { ...buildProfile(APOLLO.hospital, rows), builtAt: dubaiIso() };
  await dst.collection(HOSPITAL_PROFILE).replaceOne({ _id: "profile" as never }, profile as never, { upsert: true });
  console.log(`profile: first time ${(profile.firstTime.rate * 100).toFixed(1)}%, ${profile.byInsurer.length} insurers, ${profile.byClinician.length} clinicians, resubmission recovers ${(profile.resubmission.recoveredShare * 100).toFixed(0)}%`);

  // 6. Apollo's own claims in its memory of past claims (those to insurers on live claims), embedded.
  const mem = await importHospitalMemory(dst, APOLLO.hospital, rows, (s) => console.log(s));
  console.log(`memory: ${mem.added} added, ${mem.embedded} embedded`);

  const s = await dst.command({ dbStats: 1, scale: 1024 * 1024 });
  console.log(`done: ${dst.databaseName} ${s.storageSize.toFixed(0)} MB stored`);
  await client.close();
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await (await mongoClient()).close();
});

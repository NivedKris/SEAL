/**
 * Add Apollo's de-identified claims to Apollo's SEAL memory of past claims (and embed them).
 *   npm run tenant:apollo:memory -- <apollo-deid.jsonl.gz>
 */
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { mongoClient, tenantDb } from "@/lib/db/mongo";
import { TENANTS } from "@/lib/tenant";
import type { HospitalClaim } from "@/lib/hospital/profile";
import { importHospitalMemory } from "@/lib/hospital/memory";

async function main() {
  const d = await tenantDb(TENANTS.apollo.db);
  // Map clinicians and insurers the same way the build did (from the providers and payers it renamed).
  const rows: HospitalClaim[] = [];
  const rl = createInterface({ input: createReadStream(process.argv[2]).pipe(createGunzip()) });
  for await (const line of rl) if (line.trim()) rows.push(JSON.parse(line));
  const [provs, payers] = await Promise.all([d.collection("providers").find({}).toArray(), d.collection("payers").find({}).toArray()]);
  const prov = new Map(provs.filter((p) => p.hospitalClinicianId).map((p) => [String(p.hospitalClinicianId), String(p._id)]));
  const pay = new Map(payers.filter((p) => p.hospitalInsurer).map((p) => [String(p.hospitalInsurer), String(p._id)]));
  for (const r of rows) {
    r.providerId = prov.get(r.clinicianId);
    r.payerId = pay.get(r.insurer);
  }
  console.log(`importing ${rows.length} claims`);
  const r = await importHospitalMemory(d, TENANTS.apollo.hospital, rows, console.log);
  console.log("done", r);
  await (await mongoClient()).close();
}
main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await (await mongoClient()).close();
});

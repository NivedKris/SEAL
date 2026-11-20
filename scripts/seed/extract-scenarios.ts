/**
 * Extract the seeded scenario documents (S1–S8) and the data assumptions into a small committed
 * file, so /admin can reset the demo without reading the full seed in a serverless function.
 *   node node_modules/.bin/tsx scripts/seed/extract-scenarios.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { ASSUMPTIONS } from "./world";

const ROOT = join(__dirname, "../..");
const seed = JSON.parse(gunzipSync(readFileSync(join(ROOT, "scripts/seed/output/seed.json.gz"))).toString()) as { meta: Record<string, unknown>; collections: Record<string, { _id: string; scenario?: string; encounterId?: string; claimId?: string }[]> };
const c = seed.collections;
const encIds = new Set(c.encounters.filter((e) => e.scenario && e._id.startsWith("enc-S")).map((e) => e._id));
const claimIds = new Set(c.claims.filter((x) => x.scenario && x._id.startsWith("clm-S")).map((x) => x._id));
const out = {
  meta: seed.meta,
  assumptions: ASSUMPTIONS,
  encounters: c.encounters.filter((e) => encIds.has(e._id)),
  orders: c.orders.filter((o) => encIds.has(o.encounterId!)),
  diagnoses: c.diagnoses.filter((x) => encIds.has(x.encounterId!)),
  claims: c.claims.filter((x) => claimIds.has(x._id)),
  remittances: c.remittances.filter((x) => claimIds.has(x.claimId!)),
  denials: c.denials.filter((x) => claimIds.has(x.claimId!)),
  counts: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.length])),
};
writeFileSync(join(ROOT, "lib/admin/scenario-seed.json"), JSON.stringify(out));
console.log(`encounters ${out.encounters.length}, orders ${out.orders.length}, diagnoses ${out.diagnoses.length}, claims ${out.claims.length}, remittances ${out.remittances.length}, denials ${out.denials.length}, assumptions ${Array.isArray(ASSUMPTIONS) ? ASSUMPTIONS.length : Object.keys(ASSUMPTIONS).length}`);

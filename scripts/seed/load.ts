/**
 * Load the committed seed into MongoDB Atlas (the "Seed" and "Reset" actions use the same code).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed/load.ts [--reset] [--no-embed] [--embed-only] [--reembed]
 *
 * Safety: only ever writes to the SEAL database (MONGODB_DB, default "seal"); refuses any
 * other name. --reset drops only the collections SEAL owns in that database.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { MongoClient, type AnyBulkWriteOperation, type Document } from "mongodb";
import * as S from "@/lib/db/schemas";
import { COLLECTIONS } from "@/lib/db/schemas";
import type { z } from "zod";

/** Schema per collection; every seeded document is validated before insert. */
const SCHEMAS: Partial<Record<string, z.ZodTypeAny>> = {
  patients: S.Patient, members: S.Member, payers: S.Payer, plans: S.Plan, contracts: S.Contract, providers: S.Provider,
  encounters: S.Encounter, orders: S.Order, diagnoses: S.Diagnosis, priorAuths: S.PriorAuth, claims: S.Claim,
  remittances: S.Remittance, denials: S.Denial, outcomes: S.Outcome, rules: S.RuleDoc, evalSets: S.EvalSet,
  judges: S.JudgeConfig, settings: S.Settings, groundTruth: S.GroundTruth,
};
/** Refuse to load if the cluster would pass this (MB, data + indexes). M0 clusters block ALL writes at 512 MB. */
const CLUSTER_BUDGET_MB = 440;
import { ensureIndexes } from "@/lib/db/indexes";
import { embedTexts, toVector } from "@/lib/ai/embed";

const ROOT = join(__dirname, "../..");
const DB_NAME = process.env.MONGODB_DB ?? "seal";
const args = new Set(process.argv.slice(2));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!/^seal(-[a-z0-9]+)?$/.test(DB_NAME)) throw new Error(`refusing to write to database "${DB_NAME}": SEAL only writes to "seal" or "seal-*"`);
  const client = new MongoClient(process.env.MONGODB_URI!, { appName: "seal-seed" });
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`database: ${DB_NAME}`);

  if (!args.has("--embed-only")) {
    const seed = JSON.parse(gunzipSync(readFileSync(join(ROOT, "scripts/seed/output/seed.json.gz"))).toString()) as { meta: Record<string, unknown>; collections: Record<string, Document[]> };
    console.log(`seed ${seed.meta.seedVersion} as of ${seed.meta.asOf}`);
    // Validate everything first.
    let checked = 0;
    for (const [name, docs] of Object.entries(seed.collections)) {
      const schema = SCHEMAS[name];
      if (!schema) continue;
      for (const d of docs) {
        const r = schema.safeParse(d);
        if (!r.success) throw new Error(`${name} ${String(d._id)}: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
        checked++;
      }
    }
    console.log(`validated ${checked} documents against lib/db/schemas.ts`);

    // Storage guard across the whole cluster.
    let usedMb = 0;
    let sealMb = 0;
    for (const d of (await client.db("admin").admin().listDatabases()).databases) {
      if (["admin", "local", "config"].includes(d.name)) continue;
      const st = await client.db(d.name).command({ dbStats: 1, scale: 1024 * 1024 });
      usedMb += st.dataSize + st.indexSize;
      if (d.name === DB_NAME) sealMb = st.dataSize + st.indexSize;
    }
    const seedMb = Object.values(seed.collections).reduce((n, docs) => n + Buffer.byteLength(JSON.stringify(docs)), 0) / 1024 / 1024;
    const projected = usedMb - (args.has("--reset") ? sealMb : 0) + seedMb * 1.1 + 25; // + indexes/embeddings headroom
    console.log(`cluster: ${usedMb.toFixed(0)} MB used now; projected after load ≈ ${projected.toFixed(0)} MB (budget ${CLUSTER_BUDGET_MB} MB)`);
    if (projected > CLUSTER_BUDGET_MB && !args.has("--force")) throw new Error("projected size exceeds the storage budget — not loading (use --force only on a paid cluster)");

    if (args.has("--reset")) {
      const owned = new Set<string>(Object.values(COLLECTIONS));
      for (const c of await db.listCollections({}, { nameOnly: true }).toArray()) {
        if (owned.has(c.name)) {
          await db.collection(c.name).drop();
          console.log(`  dropped ${c.name}`);
        }
      }
    }
    for (const [name, docs] of Object.entries(seed.collections)) {
      if (!(Object.values(COLLECTIONS) as string[]).includes(name)) throw new Error(`unknown collection ${name}`);
      const col = db.collection(name);
      // After --reset the collections are empty: plain inserts. Otherwise upsert so re-runs never duplicate.
      // Four batches in flight at once to hide the round trip to Atlas.
      const batches: Document[][] = [];
      for (let i = 0; i < docs.length; i += 1000) batches.push(docs.slice(i, i + 1000));
      const write = (b: Document[]) =>
        args.has("--reset")
          ? col.insertMany(b, { ordered: false })
          : col.bulkWrite(b.map((d): AnyBulkWriteOperation => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })), { ordered: false });
      for (let i = 0; i < batches.length; i += 4) await Promise.all(batches.slice(i, i + 4).map(write));
      console.log(`  ${name}: ${docs.length}`);
    }
    await db.collection(COLLECTIONS.counters).updateOne({ _id: "events" as unknown as Document["_id"] }, { $setOnInsert: { seq: 0 } }, { upsert: true });
    try {
      await ensureIndexes(db, (s) => console.log(`  ${s}`));
    } catch (e) {
      // Don't lose the embeddings step if the search index can't be created (e.g. M0 slot limit).
      console.log(`  ! index step failed: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  if (!args.has("--no-embed")) {
    // Embed outcomes that have no vector yet (resumable; 100 per call). --reembed clears old vectors first
    // (needed after changing the embedding model). The vector index is brought to the current dims either way.
    const outcomes = db.collection(COLLECTIONS.outcomes);
    if (args.has("--embed-only")) await ensureIndexes(db, (s) => s.startsWith("search") && console.log(`  ${s}`));
    if (args.has("--reembed")) console.log(`  cleared ${(await outcomes.updateMany({}, { $unset: { embedding: "" } })).modifiedCount} old vectors`);
    const todo = await outcomes.find({ embedding: { $exists: false } }, { projection: { summary: 1 } }).toArray();
    console.log(`embedding ${todo.length} outcomes`);
    let done = 0;
    for (let i = 0; i < todo.length; i += 100) {
      const batch = todo.slice(i, i + 100);
      for (let attempt = 0; ; attempt++) {
        try {
          const vecs = await embedTexts(batch.map((d) => String(d.summary)));
          await outcomes.bulkWrite(batch.map((d, j) => ({ updateOne: { filter: { _id: d._id }, update: { $set: { embedding: toVector(vecs[j]) } } } })), { ordered: false });
          done += batch.length;
          if (done % 5000 < 100) console.log(`  ${done}/${todo.length}`);
          break;
        } catch (e) {
          const msg = (e as Error).message;
          if (attempt < 6 && /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|quota/i.test(msg)) {
            await sleep(15_000 * (attempt + 1));
            continue;
          }
          console.log(`  embedding stopped at ${done}: ${msg.slice(0, 200)} — re-run with --embed-only to resume`);
          i = todo.length;
          break;
        }
      }
    }
  }

  const stats = await db.command({ dbStats: 1, scale: 1024 * 1024 });
  console.log(`storage: data ${stats.dataSize.toFixed(1)} MB, indexes ${stats.indexSize.toFixed(1)} MB, on disk ${stats.storageSize.toFixed(1)} MB`);
  await client.close();
}

main();

/** Dev check (read-only): run a real Atlas $vectorSearch over outcomes with a locally embedded query. */
import { MongoClient } from "mongodb";
import { embedTexts, toVector } from "@/lib/ai/embed";

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!);
  await c.connect();
  const q = process.argv[2] ?? "HbA1c repeated too soon for a diabetic patient, refused as not medically necessary";
  const [v] = await embedTexts([q]);
  const hits = await c.db("seal").collection("outcomes").aggregate([
    { $vectorSearch: { index: "outcomes_embedding", path: "embedding", queryVector: toVector(v), numCandidates: 200, limit: 5, filter: { firstPassRefused: true } } },
    { $project: { _id: 0, payerId: 1, summary: 1, score: { $meta: "vectorSearchScore" } } },
  ]).toArray();
  console.log(`query: ${q}`);
  for (const h of hits) console.log(`${h.score.toFixed(3)} ${h.payerId} · ${String(h.summary).slice(0, 140)}`);
  await c.close();
}
main();

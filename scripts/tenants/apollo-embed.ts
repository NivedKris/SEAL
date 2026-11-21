/** Finish embedding Apollo's memory records and record the import as a learning step. Resumable. */
import { mongoClient, tenantDb } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { TENANTS } from "@/lib/tenant";
import { embedTexts, toVector } from "@/lib/ai/embed";
import { dubaiIso } from "@/lib/util/time";

(async () => {
  const d = await tenantDb(TENANTS.apollo.db);
  const o = d.collection(C.outcomes);
  const todo = await o.find({ _id: { $regex: "^hx-" } as never, embedding: { $exists: false } }, { projection: { summary: 1 } }).toArray();
  console.log("to embed", todo.length);
  for (let i = 0; i < todo.length; i += 128) {
    const b = todo.slice(i, i + 128);
    const v = await embedTexts(b.map((x) => String(x.summary)));
    await o.bulkWrite(b.map((x, j) => ({ updateOne: { filter: { _id: x._id }, update: { $set: { embedding: toVector(v[j]) } } } })), { ordered: false });
  }
  const total = await o.countDocuments({ _id: { $regex: "^hx-" } as never });
  if (!(await d.collection(C.learningCycles).findOne({ kind: "hospital_history" })))
    await d.collection(C.learningCycles).insertOne({ _id: `cycle-hospital-${Date.now()}`, at: dubaiIso(), kind: "hospital_history", newOutcomes: 57140, embedded: total, clusters: 0, proposals: [], note: "Apollo Clinic's own claim history: profile from all 57,140 claims; 28,232 claims to the insurers on live claims added to the memory of past claims" } as never);
  const s = await d.command({ dbStats: 1, scale: 1048576 });
  console.log("embedded total", total, "| seal_apollo data", s.dataSize.toFixed(0), "MB");
  await (await mongoClient()).close();
})();

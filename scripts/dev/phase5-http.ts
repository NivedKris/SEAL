/**
 * Phase 5 acceptance over HTTP (needs `next start`): on a COPY of S5c, enter an unjustified test
 * (vitamin D without a qualifying condition) and time the risk card. Cleans up.
 *   NODE_OPTIONS=--conditions=react-server node --env-file=.env node_modules/.bin/tsx scripts/dev/phase5-http.ts http://localhost:3199
 */
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";

const base = process.argv[2] ?? "http://localhost:3199";
const post = (u: string, b: unknown) => fetch(base + u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());

async function main() {
  const d = await db();
  const id = "enc-T5-S5c";
  const e = await d.collection(C.encounters).findOne({ _id: "enc-S5c" as never });
  await d.collection(C.encounters).insertOne({ ...e!, _id: id as never, status: "open", scenario: "T5-S5c" });
  for (const col of [C.orders, C.diagnoses]) {
    const docs = await d.collection(col).find({ encounterId: "enc-S5c" }).toArray();
    if (docs.length) await d.collection(col).insertMany(docs.map((x) => ({ ...x, _id: String(x._id).replace("enc-S5c", id) as never, encounterId: id })));
  }
  let ok = true;
  try {
    for (let round = 0; round < 3; round++) {
      const t0 = Date.now();
      const added = await post(`/api/emr/encounters/${id}/orders`, { code: "82306" });
      const rules = await post(`/api/encounters/${id}/check`, { mode: "rules" });
      const tRules = Date.now() - t0;
      const card = rules.orders.find((o: { code: string }) => o.code === "82306")?.cards[0];
      const live = await post(`/api/encounters/${id}/check`, { mode: "live" });
      const tLive = Date.now() - t0;
      const liveCard = live.orders.find((o: { code: string }) => o.code === "82306")?.cards[0];
      const pass = !!card && tRules <= 1000;
      ok &&= pass;
      console.log(`${pass ? "ok  " : "FAIL"} round ${round + 1}: risk card ${card?.ruleId} (${card?.certainty}) ${tRules} ms after entering the order · fast model confirms ${liveCard?.certainty} at ${tLive} ms (${live.model})`);
      await fetch(`${base}/api/emr/encounters/${id}/orders/${added.order._id}`, { method: "DELETE" });
    }
  } finally {
    await d.collection(C.encounters).deleteOne({ _id: id as never });
    await d.collection(C.orders).deleteMany({ encounterId: id });
    await d.collection(C.diagnoses).deleteMany({ encounterId: id });
    await d.collection(C.events).deleteMany({ "payload.encounterId": id });
    await d.collection(C.aiCalls).deleteMany({ "subject.encounterId": id });
  }
  process.exit(ok ? 0 : 1);
}
main();

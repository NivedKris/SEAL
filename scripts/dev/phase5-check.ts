/**
 * Phase 5 check: point-of-care order checks on the scenario encounters (read-only: the note
 * override is passed in, nothing is saved). Prints cards per order and timings per mode.
 *   NODE_OPTIONS=--conditions=react-server node --env-file=.env node_modules/.bin/tsx scripts/dev/phase5-check.ts [S1 S2 S3]
 */
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { checkOrders, type OrderCheck } from "@/lib/check/orders";

const SCEN = process.argv.slice(2).length ? process.argv.slice(2) : ["S1", "S2", "S3"];
const show = (r: OrderCheck) => {
  console.log(`   ${r.mode.padEnd(5)} ${r.ms} ms${r.model ? ` (${r.provider}/${r.model})` : ""}${r.aiError ? ` — ${r.aiError}` : ""}${r.flags.length ? ` flags ${r.flags}` : ""}`);
  for (const o of r.orders) console.log(`      ${o.status.padEnd(9)} ${o.code} ${o.label}: ${o.cards.map((c) => `${c.certainty === "risk" ? "●" : "○"} ${c.ruleId}${c.missing.length ? ` [needs ${c.missing.map((m) => m.concept).join(", ")}]` : ""}${c.evidence.length ? ` «${c.evidence[0].slice(0, 50)}»` : ""}`).join(" · ") || "—"}`);
};
async function main() {
  const d = await db();
  let t = Date.now();
  for (const sc of SCEN) {
    console.log(`${sc}`);
    for (const mode of ["rules", "live", "deep"] as const) show(await checkOrders(`enc-${sc}`, d, mode));
  }
  // S1 after the doctor adds the missing detail through the fix templates (not saved).
  const e = await d.collection(C.encounters).findOne({ _id: "enc-S1" as never });
  console.log("S1 with the doctor's added detail (live, then deep)");
  const note = { findings: `${e!.findings} Low back pain for 8 weeks, persistent despite physiotherapy and ibuprofen for 4 weeks. Neurologic examination: reduced power 4/5 in left ankle dorsiflexion, absent left ankle reflex, SLR positive at 40°.` };
  t = Date.now();
  show(await checkOrders("enc-S1", d, "live", note));
  show(await checkOrders("enc-S1", d, "deep", note));
  console.log(`${Date.now() - t} ms`);
  process.exit(0);
}
main();

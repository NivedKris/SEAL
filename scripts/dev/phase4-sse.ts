/**
 * Phase 4 acceptance over HTTP against a running server (next start): sign a COPY of a scenario
 * encounter, open the claim's SSE stream at once (like the claim view), and time each step from
 * the sign click. Cleans up after itself.
 *
 *   NODE_OPTIONS=--conditions=react-server node --env-file=.env node_modules/.bin/tsx scripts/dev/phase4-sse.ts http://localhost:3199 S1 S5c
 */
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";

const [base = "http://localhost:3199", ...scen] = process.argv.slice(2);
const SCEN = scen.length ? scen : ["S1"];

async function main() {
  const d = await db();
  const claimIds: string[] = [];
  const encIds: string[] = [];
  let ok = true;
  try {
    for (const sc of SCEN) {
      const src = `enc-${sc}`;
      const id = `enc-T4H-${sc}`;
      const e = await d.collection(C.encounters).findOne({ _id: src as never });
      await d.collection(C.encounters).insertOne({ ...e!, _id: id as never, status: "open", scenario: `T4H-${sc}` });
      for (const col of [C.orders, C.diagnoses]) {
        const docs = await d.collection(col).find({ encounterId: src }).toArray();
        if (docs.length) await d.collection(col).insertMany(docs.map((x) => ({ ...x, _id: String(x._id).replace(src, id) as never, encounterId: id })));
      }
      encIds.push(id);

      const t0 = Date.now();
      const signed = await fetch(`${base}/api/encounters/${id}/sign`, { method: "POST" }).then((r) => r.json());
      const tSigned = Date.now() - t0;
      if (signed.error) throw new Error(signed.error);
      claimIds.push(signed.claim._id);
      const res = await fetch(`${base}/api/claims/${signed.claim._id}/check`);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const seen: [string, number][] = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (!ev || !data) continue;
          const p = JSON.parse(data);
          const label = ev === "claim.check.ai_result" || ev === "claim.check.rule_result" ? `${p.stage}` : ev;
          seen.push([label === "rules" ? "rules" : label, Date.now() - t0]);
          if (p.stage === "routed") console.log(`   server timings since check start: ${JSON.stringify(p.timings)}`);
        }
      }
      const at = (k: string) => seen.find(([s]) => s === k)?.[1];
      const rules = at("rules");
      const judge = at("judge");
      console.log(`${sc}: claim built ${tSigned} ms after Sign · streamed: ${seen.map(([s, t]) => `${s}@${t}`).join(" → ")}`);
      const r1 = rules !== undefined && rules - tSigned <= 1000;
      const r2 = judge !== undefined && judge - tSigned <= 5000;
      console.log(`   ${r1 ? "ok  " : "FAIL"} first rule results ${rules! - tSigned} ms after the claim existed (≤ 1000)`);
      console.log(`   ${r2 ? "ok  " : "FAIL"} AI judgement ${judge! - tSigned} ms after the claim existed (≤ 5000)`);
      ok &&= r1 && r2;
    }
  } finally {
    await d.collection(C.claims).deleteMany({ _id: { $in: claimIds as never[] } });
    await d.collection(C.findings).deleteMany({ claimId: { $in: claimIds } });
    await d.collection(C.encounters).deleteMany({ _id: { $in: encIds as never[] } });
    await d.collection(C.orders).deleteMany({ encounterId: { $in: encIds } });
    await d.collection(C.diagnoses).deleteMany({ encounterId: { $in: encIds } });
    await d.collection(C.events).deleteMany({ $or: [{ "payload.claimId": { $in: claimIds } }, { "payload.encounterId": { $in: encIds } }] });
    await d.collection(C.aiCalls).deleteMany({ "subject.claimId": { $in: claimIds } });
  }
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

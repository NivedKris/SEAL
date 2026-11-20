/**
 * Phase 6 acceptance over HTTP (needs `next start`): sign a COPY of S5b, time how fast its questions
 * are visible to /doctor (event feed + inbox), answer + submit, and time the addendum on the claim.
 *   NODE_OPTIONS=--conditions=react-server node --env-file=.env node_modules/.bin/tsx scripts/dev/phase6-http.ts http://localhost:3199
 */
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";

const base = process.argv[2] ?? "http://localhost:3199";
const j = (u: string, init?: RequestInit) => fetch(base + u, { ...init, headers: { "content-type": "application/json" } }).then((r) => r.json());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const d = await db();
  const id = "enc-T6H-S5b";
  const e = await d.collection(C.encounters).findOne({ _id: "enc-S5b" as never });
  await d.collection(C.encounters).insertOne({ ...e!, _id: id as never, status: "open", scenario: "T6H-S5b" });
  for (const col of [C.orders, C.diagnoses]) {
    const docs = await d.collection(col).find({ encounterId: "enc-S5b" }).toArray();
    if (docs.length) await d.collection(col).insertMany(docs.map((x) => ({ ...x, _id: String(x._id).replace("enc-S5b", id) as never, encounterId: id })));
  }
  let claimId = "";
  let ok = true;
  try {
    const signed = await j(`/api/encounters/${id}/sign`, { method: "POST" });
    claimId = signed.claim._id;
    // Wait for the questions.created event, then measure until the doctor's inbox returns the set.
    let ev: { at: string; payload: { questionSetId: string } } | undefined;
    for (let i = 0; i < 300 && !ev; i++) {
      ev = await d.collection(C.events).findOne({ type: "questions.created", "payload.claimId": claimId }) as never;
      if (!ev) await sleep(100);
    }
    const created = new Date(ev!.at).getTime();
    // /doctor polls the event feed every 1.5 s; worst case = one full poll interval + feed + inbox fetch.
    const t = Date.now();
    await j(`/api/events?since=1`);
    const inbox = await j(`/api/questions?status=open`);
    const fetchMs = Date.now() - t;
    const seen = inbox.sets.some((s: { _id: string }) => s._id === ev!.payload.questionSetId);
    const worst = 1500 + fetchMs;
    const pass1 = seen && worst <= 2000;
    console.log(`${pass1 ? "ok  " : "FAIL"} questions visible to /doctor: feed + inbox fetch ${fetchMs} ms → worst case with the 1.5 s poll ${worst} ms (≤ 2000) · event written ${Date.now() - created} ms ago`);
    const set = inbox.sets.find((s: { _id: string }) => s._id === ev!.payload.questionSetId);
    for (const q of set.questions) await j(`/api/questions/${set._id}`, { method: "PATCH", body: JSON.stringify({ gapId: q.gapId, answer: { indication: "osteopenia on DEXA 2025, on calcium" } }) });
    const t0 = Date.now();
    const sub = await j(`/api/questions/${set._id}/submit`, { method: "POST" });
    let onClaim = 0;
    for (let i = 0; i < 60 && !onClaim; i++) {
      const c = await j(`/api/claims/${claimId}`);
      if (c.encounter.addenda?.length && c.claim.versions.at(-1).observations?.length) onClaim = Date.now() - t0;
      else await sleep(100);
    }
    const pass2 = onClaim > 0 && onClaim <= 3000;
    console.log(`${pass2 ? "ok  " : "FAIL"} addendum on the claim ${onClaim} ms after Submit (≤ 3000) · ${sub.addendumId}`);
    ok = pass1 && pass2;
    // Let the re-check finish so cleanup is complete.
    for (let i = 0; i < 120; i++) {
      const c = await d.collection(C.claims).findOne({ _id: claimId as never });
      if (c?.liveCheckState === "done" && (c.check?.run ?? 0) >= 2) {
        console.log(`     re-check after the addendum: ${c.status} · ${c.check.holdReasons.join(" | ") || "no hold reasons"}`);
        break;
      }
      await sleep(500);
    }
  } finally {
    await d.collection(C.claims).deleteMany({ encounterId: id });
    for (const col of [C.findings, C.questionSets]) await d.collection(col).deleteMany({ claimId });
    await d.collection(C.encounters).deleteOne({ _id: id as never });
    for (const col of [C.orders, C.diagnoses]) await d.collection(col).deleteMany({ encounterId: id });
    await d.collection(C.events).deleteMany({ $or: [{ "payload.claimId": claimId }, { "payload.encounterId": id }] });
    await d.collection(C.aiCalls).deleteMany({ $or: [{ "subject.claimId": claimId }, { "subject.encounterId": id }] });
  }
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

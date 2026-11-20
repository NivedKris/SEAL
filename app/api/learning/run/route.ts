import { db } from "@/lib/db/mongo";
import { runLearningCycle } from "@/lib/learning/cycle";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Run a learning cycle, streaming each step as a line of JSON (plan §6: long jobs stream progress). */
export async function POST() {
  const d = await db();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (x: unknown) => ctrl.enqueue(enc.encode(JSON.stringify(x) + "\n"));
      try {
        const r = await runLearningCycle(d, (s) => send(s));
        send({ step: "done", detail: { cycleId: r.cycle._id, proposals: r.proposals.length, before: r.before?._id ?? null, after: r.after._id } });
      } catch (e) {
        send({ step: "error", detail: { error: (e as Error).message } });
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" } });
}

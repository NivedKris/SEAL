import { after } from "next/server";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C, type ClaimDoc, type EventDoc } from "@/lib/db/schemas";
import { runClaimCheck, warmEmbeddings } from "@/lib/check/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BUSY = new Set(["rules", "judge", "critic"]);

/**
 * Live claim check, streamed with Server-Sent Events (plan §6). Starts the check if nobody has,
 * then streams this claim's check events from MongoDB as they are written — so it works whether
 * the check runs in this request, in the sign request's after() hook, or on another instance.
 * ?since=<event seq> resumes after a reconnect.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0) || 0;
  const d = await db();
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(ctrl) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (open) ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      req.signal.addEventListener("abort", () => (open = false));
      const claim = (await d.collection(C.claims).findOne({ _id: id as never }, { projection: { liveCheckState: 1, status: 1 } })) as Pick<ClaimDoc, "liveCheckState" | "status"> | null;
      if (!claim) {
        send("error", { error: `claim ${id} not found` });
        ctrl.close();
        return;
      }
      let runner: Promise<unknown> | null = null;
      let runnerDone = true;
      if (claim.liveCheckState === "idle" && ["draft", "ready", "checking"].includes(claim.status)) {
        runnerDone = false;
        runner = runClaimCheck(id, { database: d })
          .catch((e) => send("error", { error: (e as Error).message }))
          .finally(() => (runnerDone = true));
      }
      let cursor = since;
      const deadline = Date.now() + 55_000;
      let lastBeat = Date.now();
      for (;;) {
        const evs = (await d.collection(C.events).find({ "payload.claimId": id, seq: { $gt: cursor } }).sort({ seq: 1 }).toArray()) as unknown as EventDoc[];
        for (const e of evs) {
          cursor = e.seq;
          send(e.type, { seq: e.seq, at: e.at, ...e.payload });
        }
        const now = (await d.collection(C.claims).findOne({ _id: id as never }, { projection: { liveCheckState: 1 } })) as Pick<ClaimDoc, "liveCheckState"> | null;
        const busy = BUSY.has(now?.liveCheckState ?? "") || !runnerDone;
        if (!busy || !open || Date.now() > deadline) {
          // Final flush of anything written just before the state changed.
          const tail = (await d.collection(C.events).find({ "payload.claimId": id, seq: { $gt: cursor } }).sort({ seq: 1 }).toArray()) as unknown as EventDoc[];
          for (const e of tail) {
            cursor = e.seq;
            send(e.type, { seq: e.seq, at: e.at, ...e.payload });
          }
          break;
        }
        if (Date.now() - lastBeat > 10_000) {
          if (open) ctrl.enqueue(enc.encode(`: keep-alive\n\n`));
          lastBeat = Date.now();
        }
        await sleep(120);
      }
      if (runner) await runner;
      send("end", { cursor, state: ((await d.collection(C.claims).findOne({ _id: id as never }, { projection: { liveCheckState: 1 } })) as Pick<ClaimDoc, "liveCheckState"> | null)?.liveCheckState });
      if (open) ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}

/** Re-run the check (e.g. after an addendum or a fix). The claim view then reconnects to the stream. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  void warmEmbeddings();
  const d = await db();
  after(() => runClaimCheck(id, { database: d, force: true }).catch(() => null));
  return Response.json({ started: true });
}

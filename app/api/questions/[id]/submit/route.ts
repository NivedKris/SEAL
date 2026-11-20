import { after } from "next/server";
import { handle, actorFrom } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { integrateAnswers, submitAnswers } from "@/lib/questions/answers";
import { runClaimCheck } from "@/lib/check/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Doctor signs and submits: addendum attached at once; integrator + claim re-check run afterwards. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const d = await db();
    const r = await submitAnswers(d, id, actorFrom(req, "doctor"));
    const set = await d.collection(C.questionSets).findOne({ _id: id as never }, { projection: { claimId: 1 } });
    after(async () => {
      await integrateAnswers(d, id);
      if (set) await runClaimCheck(set.claimId as string, { database: d, force: true }).catch(() => null);
    });
    return r;
  });
}

import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";

export const dynamic = "force-dynamic";

/** Rule library (with source and verified badge) and the miner's proposals. */
export async function GET() {
  return handle(async () => {
    const d = await db();
    const [rules, proposals, cycles] = await Promise.all([
      d.collection(C.rules).find({ scope: "seal" }).sort({ _id: 1 }).toArray(),
      d.collection(C.ruleProposals).find({}).sort({ writtenAt: -1 }).limit(30).toArray(),
      d.collection(C.learningCycles).find({}).sort({ at: -1 }).limit(1).toArray(),
    ]);
    return { rules, proposals, lastCycle: cycles[0] ?? null };
  });
}

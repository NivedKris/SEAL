import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";

export const dynamic = "force-dynamic";

/** One refused claim in the Refused queue: its open refusal lines and SEAL's latest draft. */
export async function GET(_req: Request, { params }: { params: Promise<{ claimId: string }> }) {
  return handle(async () => {
    const { claimId } = await params;
    const d = await db();
    const [denials, draft] = await Promise.all([
      d.collection(C.denials).find({ claimId, status: { $in: ["queued", "drafted", "resubmitted"] }, deadline: { $gte: new Date().toISOString() } }).toArray(),
      d.collection(C.recoveryDrafts).find({ claimId }).sort({ writtenAt: -1 }).limit(1).toArray(),
    ]);
    return { denials, draft: draft[0] ?? null };
  });
}

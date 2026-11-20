import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { draftRecovery, readDenials } from "@/lib/recovery/recovery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Draft the recovery (correction or appeal) for a claim's refused lines. */
export async function POST(_req: Request, { params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  return handle(async () => {
    const d = await db();
    await readDenials(d, claimId).catch(() => null);
    return { draft: await draftRecovery(d, claimId) };
  });
}

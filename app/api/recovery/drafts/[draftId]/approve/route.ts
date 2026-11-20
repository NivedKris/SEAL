import { handle, actorFrom } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { Approval, approveRecovery } from "@/lib/recovery/recovery";

export const dynamic = "force-dynamic";

/** Approve and resubmit (the biller's edited draft). Body: { type, letter, diagnoses?, lineEdits? } */
export async function POST(req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  return handle(async () => ({ claim: await approveRecovery(await db(), draftId, Approval.parse(await req.json()), actorFrom(req, "biller")) }));
}

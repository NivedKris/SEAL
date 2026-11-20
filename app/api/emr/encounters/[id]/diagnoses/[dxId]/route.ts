import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { removeDiagnosis } from "@/lib/emr/store";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; dxId: string }> }) {
  const { id, dxId } = await params;
  return handle(async () => {
    await removeDiagnosis(await db(), id, dxId);
    return { ok: true };
  });
}

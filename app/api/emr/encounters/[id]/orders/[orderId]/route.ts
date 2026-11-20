import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { removeOrder } from "@/lib/emr/store";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; orderId: string }> }) {
  const { id, orderId } = await params;
  return handle(async () => {
    await removeOrder(await db(), id, orderId);
    return { ok: true };
  });
}

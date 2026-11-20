import { z } from "zod";
import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { requestPriorAuth } from "@/lib/emr/store";

export const dynamic = "force-dynamic";

/** Request prior approval for an order (mock insurer approves at once). Body: { orderId } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const { orderId } = z.object({ orderId: z.string() }).parse(await req.json());
    return await requestPriorAuth(await db(), id, orderId);
  });
}

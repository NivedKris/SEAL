import { z } from "zod";
import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { addOrder } from "@/lib/emr/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const { code, quantity } = z.object({ code: z.string().min(3), quantity: z.number().int().positive().max(30).optional() }).parse(await req.json());
    return { order: await addOrder(await db(), id, code, quantity) };
  });
}

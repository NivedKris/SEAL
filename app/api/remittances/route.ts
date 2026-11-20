import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";

export const dynamic = "force-dynamic";

/** Most recently received remittances (live ones first). */
export async function GET(req: Request) {
  const limit = Math.min(200, Number(new URL(req.url).searchParams.get("limit") ?? 50));
  return handle(async () => ({
    remittances: await (await db()).collection(C.remittances).find({}, { projection: { xml: 0 } }).sort({ receivedAt: -1 }).limit(limit).toArray(),
  }));
}

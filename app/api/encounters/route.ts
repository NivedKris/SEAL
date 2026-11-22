import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { encounterList } from "@/lib/views/pages";

export const dynamic = "force-dynamic";

/** Encounters by status (?status=open), with patient and provider names. */
export async function GET(req: Request) {
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    return encounterList(await db(), q.get("status") ?? "open", q.get("providerId"));
  });
}

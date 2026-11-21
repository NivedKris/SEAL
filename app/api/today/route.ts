import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { todayMetrics } from "@/lib/today/metrics";

export const dynamic = "force-dynamic";

/** Everything the Today dashboard shows, in one call. */
export async function GET() {
  return handle(async () => todayMetrics(await db()));
}

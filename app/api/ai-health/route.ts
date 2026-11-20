import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { healthMetrics } from "@/lib/health/metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** AI Health panels, computed from aiCalls, the ledger, evaluation runs, question sets and events. */
export async function GET() {
  return handle(async () => healthMetrics(await db()));
}

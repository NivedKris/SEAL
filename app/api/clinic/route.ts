import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { clinicMetrics } from "@/lib/clinic/metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  return handle(async () => clinicMetrics(await db()));
}

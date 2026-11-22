import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { clinicView } from "@/lib/views/pages";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Finance. For a hospital with its own history, its real numbers replace the simulated history. */
export async function GET() {
  return handle(async () => clinicView(await db()));
}

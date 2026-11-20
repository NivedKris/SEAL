import { insurerQueue } from "@/lib/mock/dhpo";

export const dynamic = "force-dynamic";

/** MOCK INSURER: claim files waiting for their ready time (for /admin and the System Map). */
export async function GET() {
  return Response.json({ queue: await insurerQueue() });
}

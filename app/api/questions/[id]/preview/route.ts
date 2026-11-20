import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { previewAddendum } from "@/lib/questions/answers";

export const dynamic = "force-dynamic";

/** The addendum exactly as it will be attached. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => previewAddendum(await db(), id));
}
